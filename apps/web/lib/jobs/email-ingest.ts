import {
  createJob,
  getJobByEmailMessageId,
  listProjects,
} from "@/lib/db/queries";
import { createNotification } from "@/lib/db/notifications";
import { kickJob } from "@/lib/jobs/runner";
import {
  GmailError,
  getMessage,
  isGmailConfigured,
  listRecentMessageIds,
  markMessageProcessed,
  parseSenderAllowlist,
  type GmailMessage,
} from "@/lib/gmail/client";
import type { Project } from "@/lib/db/schema";

function buildSenderIndex(projects: Project[]) {
  const map = new Map<string, Project[]>();
  for (const project of projects) {
    if (project.status === "archived") continue;
    for (const email of parseSenderAllowlist(project.emailSenders)) {
      const list = map.get(email) ?? [];
      list.push(project);
      map.set(email, list);
    }
  }
  return map;
}

function buildEmailBrief(message: GmailMessage, project: Project) {
  return [
    `Inbound email for lane "${project.name}".`,
    `From: ${message.from}`,
    `Subject: ${message.subject}`,
    message.date ? `Date: ${message.date}` : null,
    "",
    "Implement the request below in this repository.",
    "Open a focused pull request when done.",
    "Do not invent requirements beyond the email.",
    "",
    "—— Email body ——",
    message.bodyText.slice(0, 6000) || message.snippet || "(empty body)",
  ]
    .filter(Boolean)
    .join("\n");
}

function jobTitleFromSubject(subject: string) {
  const cleaned = subject.replace(/\s+/g, " ").trim() || "email request";
  return `Email: ${cleaned}`.slice(0, 200);
}

export type EmailIngestResult = {
  configured: boolean;
  scanned: number;
  queued: Array<{
    jobId: string;
    projectId: string;
    projectName: string;
    from: string;
    subject: string;
  }>;
  skipped: Array<{ messageId: string; reason: string; from?: string }>;
  errors: Array<{ messageId?: string; error: string }>;
};

/** Poll Gmail for allowlisted senders and queue code jobs. */
export async function ingestInboundEmails(
  options?: { maxMessages?: number },
): Promise<EmailIngestResult> {
  const result: EmailIngestResult = {
    configured: isGmailConfigured(),
    scanned: 0,
    queued: [],
    skipped: [],
    errors: [],
  };

  if (!result.configured) {
    result.errors.push({
      error:
        "Gmail is not configured. Set GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, and GMAIL_REFRESH_TOKEN.",
    });
    return result;
  }

  const projects = await listProjects("active");
  const senderIndex = buildSenderIndex(projects);
  if (senderIndex.size === 0) {
    result.skipped.push({
      messageId: "-",
      reason:
        "No lanes have email senders configured. Add addresses on a project edit form.",
    });
    return result;
  }

  const maxMessages = Math.min(Math.max(options?.maxMessages ?? 15, 1), 40);
  // Newer unread mail not yet labeled by Jarvis.
  const ids = await listRecentMessageIds(
    "is:unread -label:Jarvis/Processed",
    maxMessages,
  );
  result.scanned = ids.length;

  for (const entry of ids) {
    try {
      const existing = await getJobByEmailMessageId(entry.id);
      if (existing) {
        await markMessageProcessed(entry.id).catch(() => undefined);
        result.skipped.push({
          messageId: entry.id,
          reason: `Already linked to job ${existing.id}`,
        });
        continue;
      }

      const message = await getMessage(entry.id);
      const matches = senderIndex.get(message.fromEmail) ?? [];
      if (matches.length === 0) {
        result.skipped.push({
          messageId: entry.id,
          from: message.fromEmail,
          reason: "Sender not on any lane allowlist",
        });
        continue;
      }
      if (matches.length > 1) {
        result.skipped.push({
          messageId: entry.id,
          from: message.fromEmail,
          reason: `Sender matches multiple lanes: ${matches.map((p) => p.name).join(", ")}`,
        });
        continue;
      }

      const project = matches[0];
      if (!project.repoUrl?.trim()) {
        result.skipped.push({
          messageId: entry.id,
          from: message.fromEmail,
          reason: `Lane "${project.name}" has no GitHub repo URL`,
        });
        continue;
      }

      const job = await createJob({
        projectId: project.id,
        title: jobTitleFromSubject(message.subject),
        kind: "code",
        status: "queued",
        brief: buildEmailBrief(message, project),
        summary: `Queued from email (${message.fromEmail}).`,
        emailMessageId: message.id,
        emailThreadId: message.threadId,
        emailFrom: message.fromEmail,
        emailSubject: message.subject,
        interruptLevel:
          project.interruptLevel === "silent" ? "nudge" : project.interruptLevel,
      });

      const claimed = await kickJob(job.id);
      await markMessageProcessed(message.id);

      await createNotification({
        title: `Email → code: ${project.name}`,
        body: `From ${message.fromEmail}: ${message.subject}`,
        level: "nudge",
        projectId: project.id,
        jobId: (claimed ?? job).id,
      });

      result.queued.push({
        jobId: (claimed ?? job).id,
        projectId: project.id,
        projectName: project.name,
        from: message.fromEmail,
        subject: message.subject,
      });
    } catch (error) {
      const message =
        error instanceof GmailError
          ? error.message
          : error instanceof Error
            ? error.message
            : "Ingest failed";
      console.error("[email-ingest]", error);
      result.errors.push({ messageId: entry.id, error: message });
    }
  }

  return result;
}
