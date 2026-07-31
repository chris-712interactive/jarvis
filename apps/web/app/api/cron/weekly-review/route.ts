import { NextResponse } from "next/server";

import {
  generateWeeklyReview,
  getLatestWeeklyReview,
} from "@/lib/briefing/weekly-review";
import { seedIfEmpty } from "@/lib/db/queries";
import { authorizeCron, cronUnauthorized } from "@/lib/jobs/cron-auth";

export const runtime = "nodejs";
export const maxDuration = 120;

async function run(request: Request) {
  if (!authorizeCron(request)) return cronUnauthorized();
  await seedIfEmpty();

  const { searchParams } = new URL(request.url);
  if (
    searchParams.get("latest") === "1" ||
    searchParams.get("latest") === "true"
  ) {
    const latest = await getLatestWeeklyReview();
    return NextResponse.json({ ok: true, latest });
  }

  const force =
    searchParams.get("force") === "1" || searchParams.get("force") === "true";
  const projectId = searchParams.get("projectId")?.trim() || undefined;
  const result = await generateWeeklyReview({ force, projectId });
  return NextResponse.json({ ok: true, ...result });
}

/** Generate (or fetch latest) weekly review + memory compaction. */
export async function POST(request: Request) {
  return run(request);
}

export async function GET(request: Request) {
  return run(request);
}
