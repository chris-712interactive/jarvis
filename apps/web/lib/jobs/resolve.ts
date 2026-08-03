import { getJob, getProject, updateJob } from "@/lib/db/queries";
import { createNotification } from "@/lib/db/notifications";
import { isInstagramChannel } from "@/lib/content/channels";
import {
  GmailError,
  isGmailConfigured,
  sendReply,
} from "@/lib/gmail/client";
import {
  canPublishInstagram,
  getJarvisPublicUrl,
  InstagramError,
  publishInstagramImagePost,
} from "@/lib/instagram/client";
import type { Job } from "@/lib/db/schema";
import {
  canPublishContent,
  canSendEmailReply,
  projectTrust,
  trustDenialMessage,
} from "@/lib/trust/policy";

function buildCompletionReply(job: Job, projectName: string) {
  const artifact = job.artifactUrl?.trim();
  const lines = [
    `Hi,`,
    ``,
    `Thanks for your note about "${job.emailSubject || job.title}".`,
    ``,
    `We've completed the related work on the ${projectName} project.`,
  ];
  if (artifact?.startsWith("http")) {
    lines.push(``, `Details / pull request: ${artifact}`);
  }
  lines.push(
    ``,
    `If anything still looks off, just reply to this email.`,
    ``,
    `— Jarvis (on behalf of the operator)`,
  );
  return lines.join("\n");
}

function resolveReplyBody(job: Job, projectName: string): string | null {
  const draft = job.emailReplyDraft?.trim();
  if (draft) return draft;

  // Code missions get a completion notice when no custom draft exists.
  if (job.kind === "code") {
    return buildCompletionReply(job, projectName);
  }

  // Question/triage items with an empty draft: resolve without emailing.
  return null;
}

export type ResolveJobResult = {
  job: Job;
  emailReply: {
    attempted: boolean;
    sent: boolean;
    skipped: boolean;
    error: string | null;
  };
  contentPublish: {
    attempted: boolean;
    published: boolean;
    skipped: boolean;
    error: string | null;
    mediaId: string | null;
  };
};

async function tryPublishInstagram(
  job: Job,
  summary: string,
): Promise<{
  job: Job;
  contentPublish: ResolveJobResult["contentPublish"];
}> {
  const contentPublish: ResolveJobResult["contentPublish"] = {
    attempted: false,
    published: false,
    skipped: false,
    error: null,
    mediaId: null,
  };

  if (job.contentPublished) {
    contentPublish.skipped = true;
    return { job, contentPublish };
  }

  if (job.kind !== "message") {
    contentPublish.skipped = true;
    return { job, contentPublish };
  }

  const project = await getProject(job.projectId);
  if (!project || !isInstagramChannel(project.contentChannel)) {
    contentPublish.skipped = true;
    return { job, contentPublish };
  }

  // Not fully configured → leave as manual copy/post resolve.
  if (!canPublishInstagram(project)) {
    contentPublish.skipped = true;
    return { job, contentPublish };
  }

  if (!job.mediaPath || !job.mediaToken) {
    contentPublish.skipped = true;
    contentPublish.error =
      "Instagram publish skipped — draft has no generated image yet.";
    job =
      (await updateJob(job.id, {
        summary: `${summary} · ${contentPublish.error}`,
      })) ?? job;
    return { job, contentPublish };
  }

  if (!canPublishContent(project.trustLevel)) {
    contentPublish.skipped = true;
    contentPublish.error = trustDenialMessage(
      projectTrust(project),
      "publish to Instagram — promote lane trust to operator+",
    );
    job =
      (await updateJob(job.id, {
        summary: `${summary} · Publish blocked (${contentPublish.error})`,
      })) ?? job;
    return { job, contentPublish };
  }

  const publicBase = getJarvisPublicUrl();
  const imageUrl = `${publicBase}/api/public/media/${encodeURIComponent(job.id)}?token=${encodeURIComponent(job.mediaToken)}`;
  const caption =
    job.contentCaption?.trim() ||
    job.title.trim() ||
    "Posted via Jarvis";

  contentPublish.attempted = true;
  try {
    const published = await publishInstagramImagePost({
      igUserId: project.instagramUserId!.trim(),
      imageUrl,
      caption,
    });
    contentPublish.published = true;
    contentPublish.mediaId = published.mediaId;
    job =
      (await updateJob(job.id, {
        contentPublished: true,
        summary: `${summary} · Published to Instagram (media ${published.mediaId}).`,
      })) ?? job;
    await createNotification({
      title: `Instagram published: ${job.title}`,
      body: `Media id ${published.mediaId}. Caption from vault note ${job.artifactUrl || ""}.`,
      level: "digest",
      projectId: job.projectId,
      jobId: job.id,
    });
  } catch (error) {
    contentPublish.error =
      error instanceof InstagramError
        ? error.message
        : error instanceof Error
          ? error.message
          : "Instagram publish failed";
    console.error("[resolve] Instagram publish failed", error);
    // Keep in Needs you so the operator can fix credentials and retry.
    job =
      (await updateJob(job.id, {
        status: "needs_you",
        summary: `${summary} · Instagram publish failed: ${contentPublish.error}`,
      })) ?? job;
  }

  return { job, contentPublish };
}

/**
 * Mark a job done and, for email-originated work with a reply body, send it.
 * Instagram message jobs with API credentials publish on Approve.
 */
export async function resolveJobWithSideEffects(
  jobId: string,
  options?: { note?: string | null; replyDraft?: string | null },
): Promise<ResolveJobResult | null> {
  const existing = await getJob(jobId);
  if (!existing) return null;

  // Persist an edited draft before resolving so the sent body matches the UI.
  if (options?.replyDraft !== undefined) {
    await updateJob(existing.id, {
      emailReplyDraft: options.replyDraft,
    });
  }

  const fresh = (await getJob(jobId)) ?? existing;

  const summary =
    options?.note?.trim() ||
    `Approved / resolved by operator. (${fresh.title})`;

  let job =
    (await updateJob(fresh.id, {
      status: "done",
      summary,
    })) ?? fresh;

  const emailReply = {
    attempted: false,
    sent: false,
    skipped: false,
    error: null as string | null,
  };

  if (
    job.emailMessageId &&
    job.emailThreadId &&
    job.emailFrom &&
    !job.emailReplySent
  ) {
    const project = await getProject(job.projectId);
    const body = resolveReplyBody(job, project?.name || "the project");

    if (!body) {
      emailReply.skipped = true;
      job =
        (await updateJob(job.id, {
          summary: `${summary} · No email reply sent (triage/clear only).`,
        })) ?? job;
      return {
        job,
        emailReply,
        contentPublish: {
          attempted: false,
          published: false,
          skipped: true,
          error: null,
          mediaId: null,
        },
      };
    }

    if (!canSendEmailReply(project?.trustLevel)) {
      emailReply.skipped = true;
      emailReply.error = trustDenialMessage(
        projectTrust(project),
        "send email reply — promote lane trust to operator+",
      );
      job =
        (await updateJob(job.id, {
          summary: `${summary} · Reply not sent (${emailReply.error})`,
        })) ?? job;
      return {
        job,
        emailReply,
        contentPublish: {
          attempted: false,
          published: false,
          skipped: true,
          error: null,
          mediaId: null,
        },
      };
    }

    emailReply.attempted = true;
    if (!isGmailConfigured()) {
      emailReply.error =
        "Gmail not configured — reply was not sent.";
    } else {
      try {
        await sendReply({
          to: job.emailFrom,
          subject: job.emailSubject || job.title,
          body,
          threadId: job.emailThreadId,
          inReplyToMessageId: job.emailMessageId,
        });
        job =
          (await updateJob(job.id, {
            emailReplySent: true,
            summary: `${summary} · Reply emailed to ${job.emailFrom}.`,
          })) ?? job;
        emailReply.sent = true;
        await createNotification({
          title: `Reply sent: ${job.title}`,
          body: `Emailed ${job.emailFrom}.`,
          level: "digest",
          projectId: job.projectId,
          jobId: job.id,
        });
      } catch (error) {
        emailReply.error =
          error instanceof GmailError
            ? error.message
            : error instanceof Error
              ? error.message
              : "Failed to send reply";
        console.error("[resolve] email reply failed", error);
        job =
          (await updateJob(job.id, {
            summary: `${summary} · Reply failed: ${emailReply.error}`,
          })) ?? job;
      }
    }

    return {
      job,
      emailReply,
      contentPublish: {
        attempted: false,
        published: false,
        skipped: true,
        error: null,
        mediaId: null,
      },
    };
  }

  const published = await tryPublishInstagram(job, summary);
  return {
    job: published.job,
    emailReply,
    contentPublish: published.contentPublish,
  };
}
