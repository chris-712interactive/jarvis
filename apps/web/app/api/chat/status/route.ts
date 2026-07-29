import { NextResponse } from "next/server";
import { isChatConfigured } from "@/lib/chat/model";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({
    configured: isChatConfigured(),
    model: process.env.OPENAI_MODEL?.trim() || "gpt-4.1-mini",
  });
}
