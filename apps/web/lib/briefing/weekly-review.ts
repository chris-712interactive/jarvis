import { generateText } from "ai";

import { getChatModel, isChatConfigured } from "@/lib/chat/model";
import {
  createNotification,
  listNotifications,
} from "@/lib/db/notifications";
import { listJobs, listProjects } from "@/lib/db/queries";
import type { Job, Project } from "@/lib/db/schema";
import {
  getLocalHourParts,
  getOperatorTimeZone,
  localWeekKey,
} from "@/lib/jobs/cron-auth";
import {
  compactedMemoryNotePath,
  listVaultNotes,
  weeklyReviewNotePath,
  writeVaultNote,
  VaultError,
} from "@/lib/vault/notes";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function titleFor(weekKey: string) {
  return `Weekly review ${weekKey}`;
}

function toDate(value: Date | string | number) {
  return value instanceof Date ? value : new Date(value);
}

async function alreadySent(weekKey: string) {
  const title = titleFor(weekKey);
  const rows = await listNotifications({ limit: 80 });
  return rows.some((row) => row.title === title);
}

function parseWeekdayEnv(raw: string | undefined) {
  const value = raw?.trim().toLowerCase();
  if (!value) return 1; // Monday
  const named: Record<string, number> = {
    sun: 0,
    sunday: 0,
    mon: 1,
    monday: 1,
    tue: 2,
    tuesday: 2,
    wed: 3,
    wednesday: 3,
    thu: 4,
    thursday: 4,
    fri: 5,
    friday: 5,
    sat: 6,
    saturday: 6,
  };
  if (value in named) return named[value];
  const num = Number(value);
  if (Number.isFinite(num) && num >= 0 && num <= 6) return num;
  return 1;
}

function jobsInWindow(jobs: Job[], since: Date) {
  return jobs.filter((job) => toDate(job.updatedAt).getTime() >= since.getTime());
}

function summarizeJobs(label: string, jobs: Job[], limit = 6) {
  if (jobs.length === 0) return [`${label}: none`];
  const lines = [`${label} (${jobs.length}):`];
  for (const job of jobs.slice(0, limit)) {
    const bits = [
      job.kind,
      job.status,
      job.summary?.trim() ? job.summary.trim().slice(0, 120) : null,
    ].filter(Boolean);
    lines.push(`- ${job.title} [${bits.join(" · ")}]`);
  }
  if (jobs.length > limit) {
    lines.push(`- …and ${jobs.length - limit} more`);
  }
  return lines;
}

function recentJobNotes(project: Project, since: Date) {
  if (!project.vaultPath) return [] as string[];
  try {
    const notes = listVaultNotes(project.vaultPath)
      .filter((note) => note.path.startsWith("Jarvis Jobs/"))
      .filter((note) => !note.path.startsWith("Jarvis Jobs/reviews/"))
      .filter((note) => !note.path.startsWith("Jarvis Jobs/briefings/"))
      .filter((note) => toDate(note.updatedAt).getTime() >= since.getTime())
      .sort(
        (a, b) =>
          toDate(b.updatedAt).getTime() - toDate(a.updatedAt).getTime(),
      )
      .slice(0, 8);
    return notes.map((note) => `- \`${note.path}\` (${note.title})`);
  } catch {
    return [];
  }
}

function laneFacts(project: Project, weekJobs: Job[], since: Date) {
  const done = weekJobs.filter((j) => j.status === "done");
  const needsYou = weekJobs.filter(
    (j) => j.status === "needs_you" || j.status === "failed",
  );
  const inFlight = weekJobs.filter(
    (j) => j.status === "queued" || j.status === "running",
  );
  const byKind = {
    code: weekJobs.filter((j) => j.kind === "code").length,
    research: weekJobs.filter((j) => j.kind === "research").length,
    ops: weekJobs.filter((j) => j.kind === "ops").length,
    message: weekJobs.filter((j) => j.kind === "message").length,
  };
  const noteLines = recentJobNotes(project, since);

  const lines = [
    `## ${project.name}`,
    "",
    `Slug: ${project.slug}`,
    `Status: ${project.status} · Trust: ${project.trustLevel} · Interrupt: ${project.interruptLevel}`,
    `Goal: ${project.goal?.trim() || "(none)"}`,
    project.needsYou ? `Needs you (project): ${project.needsYou}` : null,
    project.notes?.trim() ? `Hub notes: ${project.notes.trim().slice(0, 240)}` : null,
    project.deployStatus && project.deployStatus !== "unknown"
      ? `Deploy: ${project.deployStatus}${project.deployStatusDetail ? ` — ${project.deployStatusDetail.slice(0, 120)}` : ""}`
      : null,
    project.contentChannel
      ? `Content: ${project.contentChannel}${project.dailyContent ? " (daily on)" : ""}`
      : null,
    `Jobs this week: ${weekJobs.length} (code ${byKind.code} / research ${byKind.research} / ops ${byKind.ops} / message ${byKind.message})`,
    "",
    ...summarizeJobs("Done", done),
    "",
    ...summarizeJobs("Needs you / failed", needsYou),
    "",
    ...summarizeJobs("Still in flight", inFlight, 4),
  ].filter((line) => line !== null) as string[];

  if (noteLines.length) {
    lines.push("", "Recent vault job notes:", ...noteLines);
  }

  return lines.join("\n");
}

function fallbackRollup(
  weekKey: string,
  laneBodies: Array<{ name: string; body: string }>,
) {
  const lines = [
    `Weekly operator review for ${weekKey}.`,
    "",
    `Lanes covered: ${laneBodies.length}`,
    "",
  ];
  for (const lane of laneBodies) {
    lines.push(lane.body, "", "---", "");
  }
  lines.push(
    "Suggested focus for next week: clear remaining Needs you items first, then one coding mission and one content/ops draft per priority lane.",
  );
  return lines.join("\n").trim();
}

async function llmPolish(weekKey: string, facts: string) {
  if (!isChatConfigured()) return facts;
  try {
    const { text } = await generateText({
      model: getChatModel(),
      temperature: 0.35,
      prompt: [
        "You write a weekly operator review for Jarvis (personal command center).",
        "Be direct, calm, and useful. No fluff. Keep under 320 words.",
        "Structure: short overall snapshot, then per-lane bullets (what moved, what's blocked, one next move).",
        "Do not invent jobs, PRs, metrics, or vault paths beyond the facts.",
        "",
        `Write the weekly review for ${weekKey} from these facts:`,
        "",
        facts,
      ].join("\n"),
    });
    return text.trim() || facts;
  } catch (error) {
    console.error("[weekly-review] llm polish failed", error);
    return facts;
  }
}

async function llmCompactLane(input: {
  weekKey: string;
  project: Project;
  facts: string;
  polishedRollupExcerpt: string;
}) {
  const fallback = [
    `# ${input.project.name} — current memory`,
    "",
    `> Compacted ${input.weekKey}. Prefer this note over raw chat history.`,
    "",
    `## Goal`,
    "",
    input.project.goal?.trim() || "(none set)",
    "",
    `## Needs you`,
    "",
    input.project.needsYou?.trim() || "None.",
    "",
    `## This week`,
    "",
    input.facts.slice(0, 1800),
    "",
    `## Standing notes`,
    "",
    input.project.notes?.trim() || "(none)",
    "",
  ].join("\n");

  if (!isChatConfigured()) return fallback;

  try {
    const { text } = await generateText({
      model: getChatModel(),
      temperature: 0.3,
      prompt: [
        "Write a compacted Memory/<slug>/Current.md note for one project lane.",
        "Markdown only. Keep under 220 words.",
        "Sections: # Title, ## Goal, ## Now (blockers / needs you), ## Last week (what moved), ## Next (one or two concrete moves), ## Standing facts (repo, deploy, content channel if present).",
        "Do not invent facts. This note replaces dumping full job history into chat.",
        "",
        `Week: ${input.weekKey}`,
        `Lane: ${input.project.name}`,
        "",
        "Lane facts:",
        input.facts,
        "",
        "Rollup excerpt:",
        input.polishedRollupExcerpt.slice(0, 1200),
      ].join("\n"),
    });
    return text.trim() || fallback;
  } catch (error) {
    console.error("[weekly-review] lane compact failed", error);
    return fallback;
  }
}

function writeSafe(
  vaultPath: string,
  relativePath: string,
  markdown: string,
) {
  try {
    const note = writeVaultNote(vaultPath, relativePath, markdown, {
      overwrite: true,
    });
    return { written: true as const, path: note.path };
  } catch (error) {
    if (!(error instanceof VaultError)) {
      console.error("[weekly-review] vault write failed", error);
    }
    return { written: false as const, path: null as string | null };
  }
}

export function shouldRunWeeklyReview(now = new Date()) {
  const weekday = parseWeekdayEnv(process.env.WEEKLY_REVIEW_WEEKDAY);
  const hour = Number(process.env.WEEKLY_REVIEW_HOUR ?? "9");
  if (!Number.isFinite(hour)) return false;
  const parts = getLocalHourParts(now);
  return parts.weekday === weekday && parts.hour === hour;
}

export async function generateWeeklyReview(options?: {
  force?: boolean;
  projectId?: string;
  now?: Date;
}) {
  const now = options?.now ?? new Date();
  const timeZone = getOperatorTimeZone();
  const weekKey = localWeekKey(now, timeZone);
  const since = new Date(now.getTime() - WEEK_MS);

  if (!options?.force && !options?.projectId && (await alreadySent(weekKey))) {
    return {
      skipped: true as const,
      weekKey,
      reason: "already_sent" as const,
    };
  }

  const allActive = await listProjects("active");
  const projects = options?.projectId
    ? allActive.filter((p) => p.id === options.projectId)
    : allActive;

  if (projects.length === 0) {
    return {
      skipped: true as const,
      weekKey,
      reason: "no_projects" as const,
    };
  }

  const laneBodies: Array<{
    project: Project;
    body: string;
    reviewPath: string | null;
    memoryPath: string | null;
  }> = [];

  for (const project of projects) {
    const jobs = await listJobs({ projectId: project.id });
    const weekJobs = jobsInWindow(jobs, since);
    const facts = laneFacts(project, weekJobs, since);
    laneBodies.push({
      project,
      body: facts,
      reviewPath: null,
      memoryPath: null,
    });
  }

  const rawRollup = fallbackRollup(
    weekKey,
    laneBodies.map((lane) => ({ name: lane.project.name, body: lane.body })),
  );
  const body = await llmPolish(weekKey, rawRollup);
  const title = titleFor(weekKey);

  // Per-lane review + compacted Memory/Current.md
  for (const lane of laneBodies) {
    if (!lane.project.vaultPath) continue;

    const reviewRelative = weeklyReviewNotePath(weekKey, lane.project.slug);
    const reviewMarkdown = [
      `# Weekly review — ${lane.project.name} (${weekKey})`,
      "",
      lane.body,
      "",
      "---",
      `_Generated by Jarvis weekly review · ${now.toISOString()}_`,
      "",
    ].join("\n");
    const review = writeSafe(
      lane.project.vaultPath,
      reviewRelative,
      reviewMarkdown,
    );
    lane.reviewPath = review.path;

    const compactMarkdown = await llmCompactLane({
      weekKey,
      project: lane.project,
      facts: lane.body,
      polishedRollupExcerpt: body,
    });
    const memory = writeSafe(
      lane.project.vaultPath,
      compactedMemoryNotePath(lane.project.slug),
      compactMarkdown.endsWith("\n")
        ? compactMarkdown
        : `${compactMarkdown}\n`,
    );
    lane.memoryPath = memory.path;
  }

  // Hub rollup vault note
  const hub =
    allActive.find((p) => p.slug === "command-hub" && p.vaultPath) ||
    allActive.find((p) => p.vaultPath);
  let hubVaultPath: string | null = null;
  if (hub?.vaultPath) {
    const hubMarkdown = [
      `# ${title}`,
      "",
      body,
      "",
      "## Lane review notes",
      "",
      ...laneBodies.map((lane) =>
        lane.reviewPath
          ? `- **${lane.project.name}**: \`${lane.reviewPath}\`${lane.memoryPath ? ` · memory \`${lane.memoryPath}\`` : ""}`
          : `- **${lane.project.name}**: (no vault)`,
      ),
      "",
      "---",
      `_Generated by Jarvis weekly review · ${now.toISOString()}_`,
      "",
    ].join("\n");
    const written = writeSafe(
      hub.vaultPath,
      weeklyReviewNotePath(weekKey),
      hubMarkdown,
    );
    hubVaultPath = written.path;
  }

  const notification = options?.projectId
    ? null
    : await createNotification({
        title,
        body,
        level: "digest",
      });

  return {
    skipped: false as const,
    weekKey,
    title,
    body,
    notificationId: notification?.id ?? null,
    vaultPath: hubVaultPath,
    lanes: laneBodies.map((lane) => ({
      projectId: lane.project.id,
      projectName: lane.project.name,
      reviewPath: lane.reviewPath,
      memoryPath: lane.memoryPath,
    })),
  };
}

export async function getLatestWeeklyReview() {
  const rows = await listNotifications({ limit: 40 });
  const latest = rows.find((row) => row.title.startsWith("Weekly review "));
  if (!latest) return null;
  return {
    id: latest.id,
    title: latest.title,
    body: latest.body,
    createdAt: toDate(latest.createdAt).toISOString(),
    read: latest.read,
  };
}
