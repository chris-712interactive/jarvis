import { generateText } from "ai";
import { getJob, getProject, listJobs, updateJob } from "@/lib/db/queries";
import { createNotification } from "@/lib/db/notifications";
import { getChatModel, isChatConfigured } from "@/lib/chat/model";
import type { Job, JobKind, Project } from "@/lib/db/schema";
import { jobNotePath, writeVaultNote, VaultError } from "@/lib/vault/notes";

/** Keep jobs visible in "In flight" long enough to notice. */
const MIN_RUNNING_MS = 8000;

function stubMarkdown(job: Job, project: Project) {
  return [
    `# ${job.title}`,
    "",
    `> Lane: **${project.name}** · Job \`${job.id}\` · ${job.kind}`,
    "",
    "## Brief",
    "",
    job.brief.trim() || "(no brief)",
    "",
    "## Draft",
    "",
    "Local runner stub — set `OPENAI_API_KEY` for a fuller drafted note.",
    "Edit this file in Obsidian and continue from here.",
    "",
    "---",
    `_Written by Jarvis job runner · ${new Date().toISOString()}_`,
    "",
  ].join("\n");
}

async function draftNoteMarkdown(job: Job, project: Project) {
  if (!isChatConfigured()) {
    return stubMarkdown(job, project);
  }

  try {
    const { text } = await generateText({
      model: getChatModel(),
      temperature: 0.4,
      prompt: [
        `Write an Obsidian markdown note for project lane "${project.name}".`,
        `Job title: ${job.title}`,
        `Job kind: ${job.kind}`,
        `Brief from the operator:`,
        job.brief.trim() || job.title,
        "",
        "Requirements:",
        "- Start with a single # heading matching the title",
        "- Be concrete and useful (plans, bullets, next actions)",
        "- Do not invent external facts you were not given",
        "- Keep it under ~800 words",
        "- Output markdown only, no surrounding commentary",
      ].join("\n"),
    });
    const body = text.trim();
    if (!body) return stubMarkdown(job, project);
    return `${body}\n\n---\n_Written by Jarvis job runner · ${new Date().toISOString()}_\n`;
  } catch (error) {
    console.error("[jobs] draft generation failed", error);
    return stubMarkdown(job, project);
  }
}

async function writeJobArtifact(job: Job, project: Project) {
  if (!project.vaultPath) {
    return {
      ok: false as const,
      reason: `Project "${project.name}" has no vault path configured.`,
    };
  }

  try {
    const content = await draftNoteMarkdown(job, project);
    const notePath = jobNotePath(job.title);
    const note = writeVaultNote(project.vaultPath, notePath, content, {
      overwrite: true,
    });
    return {
      ok: true as const,
      path: note.path,
      title: note.title,
    };
  } catch (error) {
    const message =
      error instanceof VaultError
        ? error.message
        : error instanceof Error
          ? error.message
          : "Vault write failed";
    return { ok: false as const, reason: message };
  }
}

async function finishJob(job: Job) {
  const project = await getProject(job.projectId);
  const kind = job.kind as JobKind;
  const brief = job.brief.trim() || job.title;

  if (kind === "code") {
    const summary = `Code mission queued for a coding agent (not wired yet). Brief: ${brief}`;
    const updated = await updateJob(job.id, {
      status: "needs_you",
      summary,
    });
    await createNotification({
      title: `Code job needs you: ${job.title}`,
      body: summary,
      level:
        job.interruptLevel === "silent" ? "nudge" : job.interruptLevel,
      projectId: job.projectId,
      jobId: job.id,
    });
    return updated;
  }

  if (!project) {
    const summary = `Job finished but project ${job.projectId} is missing.`;
    const updated = await updateJob(job.id, {
      status: "failed",
      summary,
    });
    await createNotification({
      title: `Job failed: ${job.title}`,
      body: summary,
      level: "nudge",
      projectId: job.projectId,
      jobId: job.id,
    });
    return updated;
  }

  const artifact = await writeJobArtifact(job, project);

  if (!artifact.ok) {
    const summary = `Could not write Obsidian note: ${artifact.reason}. Brief was: ${brief}`;
    const updated = await updateJob(job.id, {
      status: "needs_you",
      summary,
    });
    await createNotification({
      title: `Needs vault config: ${job.title}`,
      body: summary,
      level: "nudge",
      projectId: job.projectId,
      jobId: job.id,
    });
    return updated;
  }

  const summary = `Wrote Obsidian note \`${artifact.path}\`. Brief: ${brief}`;
  const updated = await updateJob(job.id, {
    status: "done",
    summary,
    artifactUrl: artifact.path,
  });
  await createNotification({
    title: `Note ready: ${job.title}`,
    body: summary,
    level: job.interruptLevel,
    projectId: job.projectId,
    jobId: job.id,
  });
  return updated;
}

export type ProcessJobsResult = {
  claimed: string[];
  finished: string[];
  skipped: string[];
};

/**
 * Advance queued → running, then finish running jobs after a short dwell.
 * Research/ops/message jobs write a markdown note into the project vault.
 */
export async function processQueuedJobs(limit = 8): Promise<ProcessJobsResult> {
  const claimed: string[] = [];
  const finished: string[] = [];
  const skipped: string[] = [];

  const queued = await listJobs({ status: "queued" });
  for (const job of queued.slice(0, limit)) {
    await updateJob(job.id, {
      status: "running",
      summary: job.summary?.trim()
        ? job.summary
        : "Worker claimed this mission — drafting into Obsidian…",
    });
    claimed.push(job.id);
  }

  const running = await listJobs({ status: "running" });
  const now = Date.now();
  for (const job of running) {
    const updatedAt =
      job.updatedAt instanceof Date
        ? job.updatedAt.getTime()
        : new Date(job.updatedAt).getTime();
    if (now - updatedAt < MIN_RUNNING_MS) {
      skipped.push(job.id);
      continue;
    }
    await finishJob(job);
    finished.push(job.id);
  }

  return { claimed, finished, skipped };
}

/** Claim one job immediately (used right after create). */
export async function kickJob(jobId: string) {
  const job = await getJob(jobId);
  if (!job) return null;
  if (job.status === "queued") {
    return updateJob(job.id, {
      status: "running",
      summary: job.summary?.trim()
        ? job.summary
        : "Worker claimed this mission — drafting into Obsidian…",
    });
  }
  return job;
}
