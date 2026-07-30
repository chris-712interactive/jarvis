import {
  createJob,
  listJobs,
  listProjects,
  type CreateJobInput,
} from "@/lib/db/queries";
import type { Project } from "@/lib/db/schema";
import { kickJob } from "@/lib/jobs/runner";

function dayStamp(at = new Date()) {
  return at.toISOString().slice(0, 10);
}

function jobCreatedDay(job: { createdAt: Date | string | number }) {
  const d =
    job.createdAt instanceof Date
      ? job.createdAt
      : new Date(job.createdAt);
  return d.toISOString().slice(0, 10);
}

export function buildDailyContentBrief(project: Project, at = new Date()) {
  const channel = project.contentChannel?.trim() || "content";
  const stamp = dayStamp(at);
  const custom = project.contentBrief?.trim();
  return [
    `Draft today's ${channel} post for lane "${project.name}" (${stamp}).`,
    project.goal?.trim() ? `Lane goal: ${project.goal.trim()}` : null,
    custom
      ? `Standing brief:\n${custom}`
      : "Write one ready-to-publish community post: hook, body, and a clear CTA. Keep the voice on-brand for this lane.",
    "",
    "Output should be easy to copy into the channel. Do not invent engagement metrics.",
  ]
    .filter(Boolean)
    .join("\n");
}

export function dailyContentJobTitle(project: Project, at = new Date()) {
  const channel = project.contentChannel?.trim() || "content";
  const label = channel.charAt(0).toUpperCase() + channel.slice(1);
  return `Daily ${label} post ${dayStamp(at)}`;
}

function alreadyDraftedToday(projectId: string, stamp: string, jobs: Awaited<ReturnType<typeof listJobs>>) {
  return jobs.some((job) => {
    if (job.projectId !== projectId) return false;
    if (job.kind !== "message") return false;
    if (jobCreatedDay(job) === stamp) return true;
    return job.title.includes(stamp) && /daily/i.test(job.title);
  });
}

export type DailyContentQueueResult = {
  date: string;
  queued: Array<{
    projectId: string;
    projectName: string;
    jobId: string;
    title: string;
  }>;
  skipped: Array<{
    projectId: string;
    projectName: string;
    reason: string;
  }>;
};

/** Queue one message draft job per active lane with daily content enabled. */
export async function queueDailyContentDrafts(
  options?: { projectId?: string; force?: boolean },
): Promise<DailyContentQueueResult> {
  const stamp = dayStamp();
  const queued: DailyContentQueueResult["queued"] = [];
  const skipped: DailyContentQueueResult["skipped"] = [];

  const projects = options?.projectId
    ? (await listProjects()).filter((p) => p.id === options.projectId)
    : await listProjects("active");

  for (const project of projects) {
    if (project.status === "archived") {
      skipped.push({
        projectId: project.id,
        projectName: project.name,
        reason: "Lane is archived",
      });
      continue;
    }

    if (!project.dailyContent && !options?.projectId) {
      skipped.push({
        projectId: project.id,
        projectName: project.name,
        reason: "Daily content drafting is off",
      });
      continue;
    }

    if (!project.vaultPath?.trim()) {
      skipped.push({
        projectId: project.id,
        projectName: project.name,
        reason: "No vault path configured",
      });
      continue;
    }

    const existing = await listJobs({ projectId: project.id });
    if (!options?.force && alreadyDraftedToday(project.id, stamp, existing)) {
      skipped.push({
        projectId: project.id,
        projectName: project.name,
        reason: "A daily draft already exists for today",
      });
      continue;
    }

    const input: CreateJobInput = {
      projectId: project.id,
      title: dailyContentJobTitle(project),
      kind: "message",
      status: "queued",
      brief: buildDailyContentBrief(project),
      summary: "Queued daily content draft.",
      interruptLevel: project.interruptLevel === "silent" ? "nudge" : project.interruptLevel,
    };
    const job = await createJob(input);
    const claimed = await kickJob(job.id);
    queued.push({
      projectId: project.id,
      projectName: project.name,
      jobId: (claimed ?? job).id,
      title: (claimed ?? job).title,
    });
  }

  if (options?.projectId && projects.length === 0) {
    skipped.push({
      projectId: options.projectId,
      projectName: "(unknown)",
      reason: "Project not found",
    });
  }

  return { date: stamp, queued, skipped };
}
