import { z } from "zod";

export const openaiTtsVoices = [
  "alloy",
  "ash",
  "ballad",
  "coral",
  "echo",
  "fable",
  "nova",
  "onyx",
  "sage",
  "shimmer",
] as const;

export type OpenAiTtsVoice = (typeof openaiTtsVoices)[number];

export const speakRequestSchema = z.object({
  text: z.string().trim().min(1).max(4096),
  voice: z.enum(openaiTtsVoices).optional(),
});

export function isOpenAiTtsConfigured() {
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}

export function getOpenAiTtsModel() {
  return process.env.OPENAI_TTS_MODEL?.trim() || "tts-1";
}

export function getOpenAiTtsVoice(): OpenAiTtsVoice {
  const raw = process.env.OPENAI_TTS_VOICE?.trim().toLowerCase();
  if (raw && (openaiTtsVoices as readonly string[]).includes(raw)) {
    return raw as OpenAiTtsVoice;
  }
  // Calm, low aide voice — good default for Jarvis HUD replies.
  return "onyx";
}

/**
 * Call OpenAI Audio Speech API. Returns mp3 bytes.
 * https://platform.openai.com/docs/api-reference/audio/createSpeech
 */
export async function synthesizeOpenAiSpeech(input: {
  text: string;
  voice?: OpenAiTtsVoice;
}): Promise<ArrayBuffer> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured");
  }

  const voice = input.voice ?? getOpenAiTtsVoice();
  const model = getOpenAiTtsModel();
  const res = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      voice,
      input: input.text,
      response_format: "mp3",
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    let message = `OpenAI TTS failed (${res.status})`;
    try {
      const parsed = JSON.parse(detail) as {
        error?: { message?: string };
      };
      if (parsed.error?.message) message = parsed.error.message;
    } catch {
      if (detail.trim()) message = detail.trim().slice(0, 400);
    }
    throw new Error(message);
  }

  return res.arrayBuffer();
}
