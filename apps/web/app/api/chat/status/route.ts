import { NextResponse } from "next/server";
import { isChatConfigured } from "@/lib/chat/model";

export const runtime = "nodejs";

export async function GET() {
  const configured = isChatConfigured();
  const model = process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini";
  return NextResponse.json({
    configured,
    model,
    hint: configured
      ? null
      : "Add OPENAI_API_KEY to apps/web/.env.local and restart npm run dev.",
  });
}
