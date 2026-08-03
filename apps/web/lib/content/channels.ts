/** Content-channel helpers for message drafts. */

const VISUAL_CHANNELS = new Set([
  "instagram",
  "ig",
  "insta",
  "instagram.com",
]);

export function normalizeContentChannel(
  channel: string | null | undefined,
): string {
  return (channel ?? "").trim().toLowerCase();
}

/** Instagram (and aliases) get a generated image + caption pack. */
export function isInstagramChannel(channel: string | null | undefined) {
  return VISUAL_CHANNELS.has(normalizeContentChannel(channel));
}

/** Channels that should generate a visual asset with the caption. */
export function isVisualContentChannel(channel: string | null | undefined) {
  return isInstagramChannel(channel);
}
