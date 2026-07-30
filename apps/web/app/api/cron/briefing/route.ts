import { NextResponse } from "next/server";

import {
  generateBriefing,
  getLatestBriefing,
  type BriefingKind,
} from "@/lib/briefing/generate";
import { seedIfEmpty } from "@/lib/db/queries";
import { authorizeCron, cronUnauthorized } from "@/lib/jobs/cron-auth";

export const runtime = "nodejs";
export const maxDuration = 60;

function parseKind(raw: string | null): BriefingKind | undefined {
  if (raw === "morning" || raw === "evening") return raw;
  return undefined;
}

async function run(request: Request) {
  if (!authorizeCron(request)) return cronUnauthorized();
  await seedIfEmpty();

  const { searchParams } = new URL(request.url);
  if (searchParams.get("latest") === "1" || searchParams.get("latest") === "true") {
    const kind = parseKind(searchParams.get("kind"));
    const latest = await getLatestBriefing(kind);
    return NextResponse.json({ ok: true, latest });
  }

  const force =
    searchParams.get("force") === "1" || searchParams.get("force") === "true";
  const kind = parseKind(searchParams.get("kind"));
  const result = await generateBriefing({ kind, force });
  return NextResponse.json({ ok: true, ...result });
}

/** Generate (or fetch latest) morning/evening briefing. */
export async function POST(request: Request) {
  return run(request);
}

export async function GET(request: Request) {
  return run(request);
}
