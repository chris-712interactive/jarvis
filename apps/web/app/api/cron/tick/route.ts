import { NextResponse } from "next/server";

import {
  generateBriefing,
  shouldRunEveningBriefing,
  shouldRunMorningBriefing,
} from "@/lib/briefing/generate";
import { seedIfEmpty } from "@/lib/db/queries";
import { isGmailConfigured } from "@/lib/gmail/client";
import { authorizeCron, cronUnauthorized } from "@/lib/jobs/cron-auth";
import { queueDailyContentDrafts } from "@/lib/jobs/daily-content";
import { ingestInboundEmails } from "@/lib/jobs/email-ingest";
import { runPrWatchdog } from "@/lib/jobs/pr-watchdog";
import { processQueuedJobs } from "@/lib/jobs/runner";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Unified scheduler tick — call every 5–15 minutes from host cron.
 * Advances jobs, ingests email, queues daily content, sends briefings in-window,
 * and watches open PR CI.
 */
async function run(request: Request) {
  if (!authorizeCron(request)) return cronUnauthorized();

  await seedIfEmpty();
  const { searchParams } = new URL(request.url);
  const forceBriefing =
    searchParams.get("forceBriefing") === "1" ||
    searchParams.get("forceBriefing") === "true";
  const forceContent =
    searchParams.get("forceContent") === "1" ||
    searchParams.get("forceContent") === "true";
  const skipWatchdog =
    searchParams.get("skipWatchdog") === "1" ||
    searchParams.get("skipWatchdog") === "true";

  const jobs = await processQueuedJobs();

  let email: Awaited<ReturnType<typeof ingestInboundEmails>> | { skipped: true; reason: string };
  if (isGmailConfigured()) {
    email = await ingestInboundEmails({ maxMessages: 15 });
  } else {
    email = { skipped: true, reason: "gmail_not_configured" };
  }

  const dailyContent = await queueDailyContentDrafts({ force: forceContent });

  const briefings: Array<Awaited<ReturnType<typeof generateBriefing>>> = [];
  if (forceBriefing) {
    briefings.push(await generateBriefing({ force: true }));
  } else {
    if (shouldRunMorningBriefing()) {
      briefings.push(await generateBriefing({ kind: "morning" }));
    }
    if (shouldRunEveningBriefing()) {
      briefings.push(await generateBriefing({ kind: "evening" }));
    }
  }

  const watchdog = skipWatchdog
    ? { skipped: true as const }
    : await runPrWatchdog();

  return NextResponse.json({
    ok: true,
    at: new Date().toISOString(),
    jobs,
    email,
    dailyContent,
    briefings,
    watchdog,
  });
}

export async function POST(request: Request) {
  return run(request);
}

export async function GET(request: Request) {
  return run(request);
}
