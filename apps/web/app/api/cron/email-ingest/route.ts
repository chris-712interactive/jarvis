import { NextResponse } from "next/server";
import { seedIfEmpty } from "@/lib/db/queries";
import { authorizeCron, cronUnauthorized } from "@/lib/jobs/cron-auth";
import { ingestInboundEmails } from "@/lib/jobs/email-ingest";

export const runtime = "nodejs";
export const maxDuration = 60;

async function run(request: Request) {
  if (!authorizeCron(request)) return cronUnauthorized();
  await seedIfEmpty();
  const { searchParams } = new URL(request.url);
  const maxRaw = Number(searchParams.get("max") ?? "15");
  const maxMessages = Number.isFinite(maxRaw) ? maxRaw : 15;
  const result = await ingestInboundEmails({ maxMessages });
  return NextResponse.json({ ok: true, ...result });
}

/** Poll Gmail for allowlisted senders and queue Cloud Agent code jobs. */
export async function POST(request: Request) {
  return run(request);
}

export async function GET(request: Request) {
  return run(request);
}
