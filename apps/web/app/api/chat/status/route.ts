import { NextResponse } from "next/server";
import {
  getChatModelId,
  getPlanningModelId,
  isChatConfigured,
} from "@/lib/chat/model";

export const runtime = "nodejs";

export async function GET() {
  const configured = isChatConfigured();
  const chatModel = getChatModelId();
  const planningModel = getPlanningModelId();
  return NextResponse.json({
    configured,
    /** @deprecated Prefer `chatModel` — kept for older uplink clients. */
    model: chatModel,
    chatModel,
    planningModel,
    hint: configured
      ? null
      : "Add OPENAI_API_KEY to apps/web/.env.local and restart npm run dev.",
  });
}
