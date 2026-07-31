import {
  createJob,
  getJobByEmailMessageId,
  listProjects,
} from "@/lib/db/queries";
import { createNotification } from "@/lib/db/notifications";
import { kickJob } from "@/lib/jobs/runner";
import {
  classifyEmailIntent,
  draftQuestionReply,
} from "@/lib/jobs/email-intent";
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
import {
  canIngestEmailCodeJobs,
  normalizeTrustLevel,
  trustDenialMessage,
} from "@/lib/trust/policy";

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

function buildCodeBrief(message: GmailMessage, project: Project) {
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

function buildQuestionBrief(message: GmailMessage, project: Project) {
  return [
    `Inbound QUESTION email for lane "${project.name}".`,
    `From: ${message.from}`,
    `Subject: ${message.subject}`,
    message.date ? `Date: ${message.date}` : null,
    "",
    "This was classified as a question (not a code change).",
    "A draft reply is attached for operator approval.",
    "",
    "—— Email body ——",
    message.bodyText.slice(0, 6000) || message.snippet || "(empty body)",
  ]
    .filter(Boolean)
    .join("\n");
}

function buildAmbiguousBrief(message: GmailMessage, project: Project, reason: string) {
  return [
    `Inbound email for lane "${project.name}" needs triage.`,
    `From: ${message.from}`,
    `Subject: ${message.subject}`,
    `Classifier: ${reason}`,
    "",
    "Decide whether this is a code change or a question, then start the right job or edit a reply draft.",
    "",
    "—— Email body ——",
    message.bodyText.slice(0, 6000) || message.snippet || "(empty body)",
  ]
    .filter(Boolean)
    .join("\n");
}

function jobTitleFromSubject(prefix: string, subject: string) {
  const cleaned = subject.replace(/\s+/g, " ").trim() || "email request";
  return `${prefix}: ${cleaned}`.slice(0, 200);
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
    intent: string;
  }>;
  skipped: Array<{ messageId: string; reason: string; from?: string }>;
  errors: Array<{ messageId?: string; error: string }>;
};

/** Poll Gmail for allowlisted senders and route by intent. */
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
      const trust = normalizeTrustLevel(project.trustLevel);
      if (trust === "observer") {
        result.skipped.push({
          messageId: entry.id,
          from: message.fromEmail,
          reason: trustDenialMessage(
            trust,
            `email ingest on lane "${project.name}"`,
          ),
        });
        continue;
      }

      const classified = await classifyEmailIntent(message, project);
      const interruptLevel =
        project.interruptLevel === "silent" ? "nudge" : project.interruptLevel;

      if (classified.intent === "code") {
        if (!canIngestEmailCodeJobs(project.trustLevel)) {
          result.skipped.push({
            messageId: entry.id,
            from: message.fromEmail,
            reason: trustDenialMessage(
              trust,
              `email→code on lane "${project.name}"`,
            ),
          });
          continue;
        }
        if (!project.repoUrl?.trim()) {
          result.skipped.push({
            messageId: entry.id,
            from: message.fromEmail,
            reason: `Code intent, but lane "${project.name}" has no GitHub repo URL`,
          });
          continue;
        }

        const job = await createJob({
          projectId: project.id,
          title: jobTitleFromSubject("Email code", message.subject),
          kind: "code",
          status: "queued",
          brief: buildCodeBrief(message, project),
          summary: `Queued code job from email (${message.fromEmail}). ${classified.reason}`,
          emailMessageId: message.id,
          emailThreadId: message.threadId,
          emailFrom: message.fromEmail,
          emailSubject: message.subject,
          interruptLevel,
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
          intent: "code",
        });
        continue;
      }

      if (classified.intent === "question") {
        const draft = await draftQuestionReply(message, project);
        const job = await createJob({
          projectId: project.id,
          title: jobTitleFromSubject("Email Q", message.subject),
          kind: "ops",
          status: "needs_you",
          brief: buildQuestionBrief(message, project),
          summary: `Question email — draft reply ready. Approve & reply to send. (${classified.reason})`,
          emailMessageId: message.id,
          emailThreadId: message.threadId,
          emailFrom: message.fromEmail,
          emailSubject: message.subject,
          emailReplyDraft: draft,
          interruptLevel,
        });

        await markMessageProcessed(message.id);
        await createNotification({
          title: `Email question: ${project.name}`,
          body: `From ${message.fromEmail}: ${message.subject}. Draft reply waiting for Approve.`,
          level: "nudge",
          projectId: project.id,
          jobId: job.id,
        });

        result.queued.push({
          jobId: job.id,
          projectId: project.id,
          projectName: project.name,
          from: message.fromEmail,
          subject: message.subject,
          intent: "question",
        });
        continue;
      }

      // ambiguous — park for human triage; do not auto-reply or launch agents
      const job = await createJob({
        projectId: project.id,
        title: jobTitleFromSubject("Email triage", message.subject),
        kind: "ops",
        status: "needs_you",
        brief: buildAmbiguousBrief(message, project, classified.reason),
        summary: `Ambiguous email — decide if this is a question or a code change. (${classified.reason})`,
        emailMessageId: message.id,
        emailThreadId: message.threadId,
        emailFrom: message.fromEmail,
        emailSubject: message.subject,
        interruptLevel,
      });

      await markMessageProcessed(message.id);
      await createNotification({
        title: `Email triage: ${project.name}`,
        body: `From ${message.fromEmail}: ${message.subject}`,
        level: "nudge",
        projectId: project.id,
        jobId: job.id,
      });

      result.queued.push({
        jobId: job.id,
        projectId: project.id,
        projectName: project.name,
        from: message.fromEmail,
        subject: message.subject,
        intent: "ambiguous",
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
