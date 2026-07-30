import { generateText } from "ai";

import { getChatModel, isChatConfigured } from "@/lib/chat/model";
import {
  createNotification,
  getUnreadNotificationCount,
  listNotifications,
} from "@/lib/db/notifications";
import { getDashboardData, listProjects } from "@/lib/db/queries";
import {
  getLocalHourParts,
  getOperatorTimeZone,
  localDayKey,
} from "@/lib/jobs/cron-auth";
import { writeVaultNote, VaultError } from "@/lib/vault/notes";

export type BriefingKind = "morning" | "evening";

function titleFor(kind: BriefingKind, key: string) {
  return kind === "morning" ? `Morning briefing ${key}` : `Evening briefing ${key}`;
}

async function alreadySent(kind: BriefingKind, key: string) {
  const title = titleFor(kind, key);
  const rows = await listNotifications({ limit: 80 });
  return rows.some((row) => row.title === title);
}

function toDate(value: Date | string | number) {
  return value instanceof Date ? value : new Date(value);
}

function fallbackBriefing(
  kind: BriefingKind,
  snapshot: Awaited<ReturnType<typeof getDashboardData>>,
  unread: number,
  doneToday: number,
) {
  const lines = [
    kind === "morning"
      ? "Good morning. Here's your command center snapshot."
      : "Evening wrap. Here's where things stand.",
    "",
    `Needs you: ${snapshot.counts.needsYou}`,
    `In flight: ${snapshot.counts.inFlight}`,
    `Done today (local): ${doneToday}`,
    `Unread alerts: ${unread}`,
    "",
  ];

  const jobNeeds = snapshot.needsYou.jobs.slice(0, 5);
  const projectNeeds = snapshot.needsYou.projects.slice(0, 3);
  if (jobNeeds.length || projectNeeds.length) {
    lines.push("Top needs-you:");
    for (const item of jobNeeds) {
      lines.push(
        `- [${item.project?.name ?? "General"}] ${item.title} (${item.status})`,
      );
    }
    for (const project of projectNeeds) {
      lines.push(`- [${project.name}] ${project.needsYou}`);
    }
    lines.push("");
  }

  if (kind === "evening" && snapshot.recent.length) {
    lines.push("Recent outcomes:");
    for (const item of snapshot.recent.slice(0, 6)) {
      lines.push(`- [${item.project?.name ?? "General"}] ${item.title}`);
    }
    lines.push("");
  }

  if (snapshot.inFlight.length) {
    lines.push("Still in flight:");
    for (const item of snapshot.inFlight.slice(0, 5)) {
      lines.push(`- [${item.project?.name ?? "General"}] ${item.title}`);
    }
    lines.push("");
  }

  lines.push(
    kind === "morning"
      ? "Suggested focus: clear Needs you first, then keep one In flight item moving."
      : "Suggested close-out: approve or park anything still blocking, then pick tomorrow's first move.",
  );

  return lines.join("\n");
}

async function llmPolish(kind: BriefingKind, facts: string) {
  if (!isChatConfigured()) return facts;
  try {
    const { text } = await generateText({
      model: getChatModel(),
      temperature: 0.4,
      prompt: [
        "You write short operator briefings for Jarvis. Be direct, calm, and actionable. No fluff. Keep under 180 words. Use short paragraphs or bullets.",
        "",
        `Write a ${kind} briefing from these facts:`,
        "",
        facts,
      ].join("\n"),
    });
    return text.trim() || facts;
  } catch (error) {
    console.error("[briefing] llm polish failed", error);
    return facts;
  }
}

async function writeBriefingVaultNote(
  title: string,
  body: string,
  kind: BriefingKind,
  key: string,
) {
  const projects = await listProjects("active");
  const hub =
    projects.find((p) => p.slug === "command-hub" && p.vaultPath) ||
    projects.find((p) => p.vaultPath);
  if (!hub?.vaultPath) {
    return { written: false as const, path: null as string | null };
  }

  const relativePath = `Jarvis Jobs/briefings/${key}-${kind}.md`;
  const markdown = `# ${title}\n\n${body}\n`;
  try {
    const note = writeVaultNote(hub.vaultPath, relativePath, markdown, {
      overwrite: true,
    });
    return { written: true as const, path: note.path, projectId: hub.id };
  } catch (error) {
    if (!(error instanceof VaultError)) {
      console.error("[briefing] vault write failed", error);
    }
    return { written: false as const, path: null as string | null };
  }
}

export async function generateBriefing(options?: {
  kind?: BriefingKind;
  force?: boolean;
  now?: Date;
}) {
  const now = options?.now ?? new Date();
  const timeZone = getOperatorTimeZone();
  const parts = getLocalHourParts(now, timeZone);
  const kind: BriefingKind =
    options?.kind ?? (parts.hour < 15 ? "morning" : "evening");
  const key = localDayKey(now, timeZone);

  if (!options?.force && (await alreadySent(kind, key))) {
    return {
      skipped: true as const,
      kind,
      dayKey: key,
      reason: "already_sent",
    };
  }

  const snapshot = await getDashboardData();
  const unread = await getUnreadNotificationCount();
  const doneToday = snapshot.recent.filter((job) => {
    const updated = toDate(job.updatedAt);
    return localDayKey(updated, timeZone) === key;
  }).length;

  const facts = fallbackBriefing(kind, snapshot, unread, doneToday);
  const body = await llmPolish(kind, facts);
  const title = titleFor(kind, key);

  const notification = await createNotification({
    title,
    body,
    level: "nudge",
  });

  const vault = await writeBriefingVaultNote(title, body, kind, key);

  return {
    skipped: false as const,
    kind,
    dayKey: key,
    title,
    body,
    notificationId: notification.id,
    vaultPath: vault.path,
  };
}

export async function getLatestBriefing(kind?: BriefingKind) {
  const rows = await listNotifications({ limit: 40 });
  const filtered = rows.filter((row) => {
    if (kind === "morning") return row.title.startsWith("Morning briefing");
    if (kind === "evening") return row.title.startsWith("Evening briefing");
    return (
      row.title.startsWith("Morning briefing") ||
      row.title.startsWith("Evening briefing")
    );
  });
  const latest = filtered[0];
  if (!latest) return null;
  return {
    id: latest.id,
    title: latest.title,
    body: latest.body,
    createdAt: toDate(latest.createdAt).toISOString(),
    read: latest.read,
  };
}

export function shouldRunMorningBriefing(now = new Date()) {
  const hour = Number(process.env.BRIEFING_MORNING_HOUR ?? "7");
  if (!Number.isFinite(hour)) return false;
  return getLocalHourParts(now).hour === hour;
}

export function shouldRunEveningBriefing(now = new Date()) {
  const hour = Number(process.env.BRIEFING_EVENING_HOUR ?? "18");
  if (!Number.isFinite(hour)) return false;
  return getLocalHourParts(now).hour === hour;
}
