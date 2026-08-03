/**
 * OpenAI Images API — generate a square post visual for content packs.
 * https://platform.openai.com/docs/api-reference/images
 */

export function isImageGenConfigured() {
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}

export function getImageModelId() {
  return process.env.OPENAI_IMAGE_MODEL?.trim() || "dall-e-3";
}

export class OpenAiImageError extends Error {
  status: number;

  constructor(message: string, status = 500) {
    super(message);
    this.name = "OpenAiImageError";
    this.status = status;
  }
}

export type GeneratedImage = {
  bytes: Buffer;
  mimeType: "image/png";
  revisedPrompt?: string;
  model: string;
};

/**
 * Generate a 1024×1024 PNG suitable for Instagram feed posts.
 */
export async function generatePostImage(input: {
  prompt: string;
  size?: "1024x1024" | "1024x1792" | "1792x1024";
}): Promise<GeneratedImage> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new OpenAiImageError("OPENAI_API_KEY is not configured", 503);
  }

  const prompt = input.prompt.trim();
  if (!prompt) {
    throw new OpenAiImageError("Image prompt is empty", 400);
  }

  const model = getImageModelId();
  const size = input.size ?? "1024x1024";

  const res = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      prompt: prompt.slice(0, 4000),
      n: 1,
      size,
      response_format: "b64_json",
      quality: model.startsWith("dall-e") ? "standard" : undefined,
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    let message = `OpenAI image generation failed (${res.status})`;
    try {
      const parsed = JSON.parse(detail) as {
        error?: { message?: string };
      };
      if (parsed.error?.message) message = parsed.error.message;
    } catch {
      if (detail.trim()) message = detail.trim().slice(0, 400);
    }
    throw new OpenAiImageError(message, res.status);
  }

  const data = (await res.json()) as {
    data?: Array<{ b64_json?: string; revised_prompt?: string }>;
  };
  const first = data.data?.[0];
  const b64 = first?.b64_json;
  if (!b64) {
    throw new OpenAiImageError("OpenAI returned no image data", 502);
  }

  return {
    bytes: Buffer.from(b64, "base64"),
    mimeType: "image/png",
    revisedPrompt: first.revised_prompt,
    model,
  };
}
