import { NextResponse } from "next/server";

import {
  generateBriefing,
  shouldRunEveningBriefing,
  shouldRunMorningBriefing,
} from "@/lib/briefing/generate";
import {
  generateWeeklyReview,
  shouldRunWeeklyReview,
} from "@/lib/briefing/weekly-review";
import { seedIfEmpty } from "@/lib/db/queries";
import { isGmailConfigured } from "@/lib/gmail/client";
import { authorizeCron, cronUnauthorized } from "@/lib/jobs/cron-auth";
import { queueDailyContentDrafts } from "@/lib/jobs/daily-content";
import { ingestInboundEmails } from "@/lib/jobs/email-ingest";
import { runPrWatchdog } from "@/lib/jobs/pr-watchdog";
import { runDeployWatchdog } from "@/lib/jobs/deploy-watchdog";
import { processQueuedJobs } from "@/lib/jobs/runner";

export const runtime = "nodejs";
export const maxDuration = 120;

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return String(error);
}

async function step<T>(
  name: string,
  fn: () => Promise<T>,
): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    return { ok: true, data: await fn() };
  } catch (error) {
    console.error(`[cron/tick] ${name} failed`, error);
    return { ok: false, error: errorMessage(error) };
  }
}

/**
 * Unified scheduler tick — call every 5–15 minutes from host cron.
 * Advances jobs, ingests email, queues daily content, sends briefings in-window,
 * weekly reviews on schedule, and watches open PR CI + production deploy/health.
 *
 * Each step is isolated so one failure returns JSON details instead of a bare 500.
 */
async function run(request: Request) {
  if (!authorizeCron(request)) return cronUnauthorized();

  try {
    await seedIfEmpty();
  } catch (error) {
    console.error("[cron/tick] seedIfEmpty failed", error);
    return NextResponse.json(
      {
        ok: false,
        at: new Date().toISOString(),
        error: `seedIfEmpty: ${errorMessage(error)}`,
      },
      { status: 500 },
    );
  }

  const { searchParams } = new URL(request.url);
  const forceBriefing =
    searchParams.get("forceBriefing") === "1" ||
    searchParams.get("forceBriefing") === "true";
  const forceWeekly =
    searchParams.get("forceWeekly") === "1" ||
    searchParams.get("forceWeekly") === "true";
  const forceContent =
    searchParams.get("forceContent") === "1" ||
    searchParams.get("forceContent") === "true";
  const skipWatchdog =
    searchParams.get("skipWatchdog") === "1" ||
    searchParams.get("skipWatchdog") === "true";

  const jobsResult = await step("jobs", () => processQueuedJobs());
  const emailResult = await step("email", async () => {
    if (!isGmailConfigured()) {
      return { skipped: true as const, reason: "gmail_not_configured" };
    }
    return ingestInboundEmails({ maxMessages: 15 });
  });
  const dailyContentResult = await step("dailyContent", () =>
    queueDailyContentDrafts({ force: forceContent }),
  );

  const briefingsResult = await step("briefings", async () => {
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
    return briefings;
  });

  const weeklyReviewsResult = await step("weeklyReviews", async () => {
    if (forceWeekly) {
      return generateWeeklyReview({ force: true });
    }
    if (shouldRunWeeklyReview()) {
      return generateWeeklyReview();
    }
    return { skipped: true as const, reason: "outside_window" as const };
  });

  const watchdogResult = skipWatchdog
    ? {
        ok: true as const,
        data: { skipped: true as const },
      }
    : await step("watchdog", () => runPrWatchdog());

  const deployResult = skipWatchdog
    ? {
        ok: true as const,
        data: { skipped: true as const },
      }
    : await step("deployHealth", () => runDeployWatchdog());

  const errors = [
    !jobsResult.ok ? `jobs: ${jobsResult.error}` : null,
    !emailResult.ok ? `email: ${emailResult.error}` : null,
    !dailyContentResult.ok ? `dailyContent: ${dailyContentResult.error}` : null,
    !briefingsResult.ok ? `briefings: ${briefingsResult.error}` : null,
    !weeklyReviewsResult.ok
      ? `weeklyReviews: ${weeklyReviewsResult.error}`
      : null,
    !watchdogResult.ok ? `watchdog: ${watchdogResult.error}` : null,
    !deployResult.ok ? `deployHealth: ${deployResult.error}` : null,
  ].filter(Boolean) as string[];

  return NextResponse.json({
    ok: errors.length === 0,
    at: new Date().toISOString(),
    jobs: jobsResult.ok ? jobsResult.data : { error: jobsResult.error },
    email: emailResult.ok ? emailResult.data : { error: emailResult.error },
    dailyContent: dailyContentResult.ok
      ? dailyContentResult.data
      : { error: dailyContentResult.error },
    briefings: briefingsResult.ok
      ? briefingsResult.data
      : { error: briefingsResult.error },
    weeklyReviews: weeklyReviewsResult.ok
      ? weeklyReviewsResult.data
      : { error: weeklyReviewsResult.error },
    watchdog: watchdogResult.ok
      ? watchdogResult.data
      : { error: watchdogResult.error },
    deployHealth: deployResult.ok
      ? deployResult.data
      : { error: deployResult.error },
    errors,
  });
}

export async function POST(request: Request) {
  return run(request);
}

export async function GET(request: Request) {
  return run(request);
}
