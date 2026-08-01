import { NextResponse } from "next/server";

import {
  getOpenAiTtsModel,
  getOpenAiTtsVoice,
  isOpenAiTtsConfigured,
  speakRequestSchema,
  synthesizeOpenAiSpeech,
} from "@/lib/speech/openai-tts";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Status: whether OpenAI TTS is available for Speak. */
export async function GET() {
  return NextResponse.json({
    configured: isOpenAiTtsConfigured(),
    model: getOpenAiTtsModel(),
    voice: getOpenAiTtsVoice(),
  });
}

/** Synthesize speech via OpenAI TTS; returns audio/mpeg. */
export async function POST(request: Request) {
  if (!isOpenAiTtsConfigured()) {
    return NextResponse.json(
      {
        error:
          "OPENAI_API_KEY is not configured. Set it to enable OpenAI TTS (browser speech remains as fallback).",
      },
      { status: 503 },
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = speakRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid speak request", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const audio = await synthesizeOpenAiSpeech({
      text: parsed.data.text,
      voice: parsed.data.voice,
    });
    return new NextResponse(audio, {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "no-store",
        "X-Jarvis-TTS": "openai",
        "X-Jarvis-TTS-Model": getOpenAiTtsModel(),
        "X-Jarvis-TTS-Voice": parsed.data.voice ?? getOpenAiTtsVoice(),
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "OpenAI TTS failed";
    console.error("[speak] OpenAI TTS failed", error);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
