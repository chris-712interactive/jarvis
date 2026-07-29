import {
  getJob,
  listJobs,
  updateJob,
} from "@/lib/db/queries";
import { createNotification } from "@/lib/db/notifications";
import type { Job, JobKind } from "@/lib/db/schema";

/** Keep jobs visible in "In flight" briefly before completing. */
const MIN_RUNNING_MS = 2500;

function outcomeForKind(job: Job): {
  status: "done" | "needs_you";
  summary: string;
  notifyTitle: string;
} {
  const brief = job.brief.trim() || job.title;
  const kind = job.kind as JobKind;

  switch (kind) {
    case "code":
      return {
        status: "needs_you",
        summary: `Code mission queued for a coding agent (not wired yet). Brief: ${brief}`,
        notifyTitle: `Code job needs you: ${job.title}`,
      };
    case "research":
      return {
        status: "done",
        summary: `Research complete (local stub). Findings drafted from brief: ${brief}`,
        notifyTitle: `Research finished: ${job.title}`,
      };
    case "message":
      return {
        status: "done",
        summary: `Draft message ready (local stub). Not sent externally. Brief: ${brief}`,
        notifyTitle: `Draft ready: ${job.title}`,
      };
    case "ops":
    default:
      return {
        status: "done",
        summary: `Ops task complete (local stub). Handled: ${brief}`,
        notifyTitle: `Ops complete: ${job.title}`,
      };
  }
}

async function finishJob(job: Job) {
  const outcome = outcomeForKind(job);
  const updated = await updateJob(job.id, {
    status: outcome.status,
    summary: outcome.summary,
  });

  await createNotification({
    title: outcome.notifyTitle,
    body: outcome.summary,
    level:
      outcome.status === "needs_you"
        ? job.interruptLevel === "silent"
          ? "nudge"
          : job.interruptLevel
        : job.interruptLevel,
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
 * Safe to call from API routes, chat tools, and a client poller.
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
        : "Worker claimed this mission.",
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
        : "Worker claimed this mission.",
    });
  }
  return job;
}
