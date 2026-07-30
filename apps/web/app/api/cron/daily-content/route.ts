import { NextResponse } from "next/server";
import { seedIfEmpty } from "@/lib/db/queries";
import { queueDailyContentDrafts } from "@/lib/jobs/daily-content";

export const runtime = "nodejs";
export const maxDuration = 60;

function authorize(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    // Local/dev convenience — set CRON_SECRET in production.
    return process.env.NODE_ENV !== "production";
  }
  const header = request.headers.get("authorization")?.trim();
  return header === `Bearer ${secret}`;
}

async function run(request: Request) {
  if (!authorize(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await seedIfEmpty();
  const { searchParams } = new URL(request.url);
  const projectId = searchParams.get("projectId")?.trim() || undefined;
  const force = searchParams.get("force") === "1" || searchParams.get("force") === "true";
  const result = await queueDailyContentDrafts({ projectId, force });
  return NextResponse.json({ ok: true, ...result });
}

/** Queue daily content drafts for lanes with dailyContent enabled. */
export async function POST(request: Request) {
  return run(request);
}

export async function GET(request: Request) {
  return run(request);
}
