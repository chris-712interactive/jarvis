import { getJob, getProject, updateJob } from "@/lib/db/queries";
import { createNotification } from "@/lib/db/notifications";
import {
  GmailError,
  isGmailConfigured,
  sendReply,
} from "@/lib/gmail/client";
import type { Job } from "@/lib/db/schema";

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
};

/**
 * Mark a job done and, for email-originated work with a reply body, send it.
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
      return { job, emailReply };
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
  }

  return { job, emailReply };
}
