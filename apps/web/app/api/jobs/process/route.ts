import { NextResponse } from "next/server";
import { seedIfEmpty } from "@/lib/db/queries";
import { processQueuedJobs } from "@/lib/jobs/runner";

export const runtime = "nodejs";

async function tick() {
  await seedIfEmpty();
  const result = await processQueuedJobs();
  return NextResponse.json({ ok: true, ...result });
}

/** Advance the local job runner (queued → running → done/needs_you). */
export async function POST() {
  return tick();
}

export async function GET() {
  return tick();
}
