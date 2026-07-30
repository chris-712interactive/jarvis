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

export type ResolveJobResult = {
  job: Job;
  emailReply: {
    attempted: boolean;
    sent: boolean;
    error: string | null;
  };
};

/**
 * Mark a job done and, for email-originated work, send the completion reply.
 */
export async function resolveJobWithSideEffects(
  jobId: string,
  options?: { note?: string | null },
): Promise<ResolveJobResult | null> {
  const existing = await getJob(jobId);
  if (!existing) return null;

  const summary =
    options?.note?.trim() ||
    `Approved / resolved by operator. (${existing.title})`;

  let job =
    (await updateJob(existing.id, {
      status: "done",
      summary,
    })) ?? existing;

  const emailReply = {
    attempted: false,
    sent: false,
    error: null as string | null,
  };

  if (
    job.emailMessageId &&
    job.emailThreadId &&
    job.emailFrom &&
    !job.emailReplySent
  ) {
    emailReply.attempted = true;
    if (!isGmailConfigured()) {
      emailReply.error =
        "Gmail not configured — completion reply was not sent.";
    } else {
      try {
        const project = await getProject(job.projectId);
        await sendReply({
          to: job.emailFrom,
          subject: job.emailSubject || job.title,
          body: buildCompletionReply(job, project?.name || "the project"),
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
          body: `Emailed ${job.emailFrom} that work is complete.`,
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
