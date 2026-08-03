/**
 * Instagram Content Publishing via Meta Graph API.
 *
 * Requires:
 * - INSTAGRAM_ACCESS_TOKEN — long-lived Page token with
 *   instagram_basic, instagram_content_publish, pages_show_list
 * - Per-lane projects.instagramUserId — Instagram Business/Creator account id
 * - JARVIS_PUBLIC_URL — public HTTPS origin so Meta can fetch the image
 *
 * Docs: https://developers.facebook.com/docs/instagram-api/guides/content-publishing
 */

const GRAPH_VERSION = process.env.INSTAGRAM_GRAPH_VERSION?.trim() || "v21.0";
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

export class InstagramError extends Error {
  status: number;

  constructor(message: string, status = 500) {
    super(message);
    this.name = "InstagramError";
    this.status = status;
  }
}

export function getInstagramAccessToken() {
  return (
    process.env.INSTAGRAM_ACCESS_TOKEN?.trim() ||
    process.env.META_ACCESS_TOKEN?.trim() ||
    ""
  );
}

export function isInstagramConfigured() {
  return Boolean(getInstagramAccessToken());
}

export function getJarvisPublicUrl() {
  const raw =
    process.env.JARVIS_PUBLIC_URL?.trim() ||
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    "";
  return raw.replace(/\/+$/, "");
}

export function canPublishInstagram(project: {
  contentChannel?: string | null;
  instagramUserId?: string | null;
}) {
  return (
    isInstagramConfigured() &&
    Boolean(project.instagramUserId?.trim()) &&
    Boolean(getJarvisPublicUrl())
  );
}

async function graphJson<T>(
  url: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(url, init);
  const text = await res.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  if (!res.ok) {
    const errObj = parsed as {
      error?: { message?: string; error_user_msg?: string };
    } | null;
    const message =
      errObj?.error?.error_user_msg ||
      errObj?.error?.message ||
      (text.trim() ? text.trim().slice(0, 400) : `Instagram API ${res.status}`);
    throw new InstagramError(message, res.status);
  }
  return parsed as T;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Create a feed image container, wait until finished, then publish.
 */
export async function publishInstagramImagePost(input: {
  igUserId: string;
  imageUrl: string;
  caption: string;
}): Promise<{ containerId: string; mediaId: string }> {
  const token = getInstagramAccessToken();
  if (!token) {
    throw new InstagramError("INSTAGRAM_ACCESS_TOKEN is not configured", 503);
  }

  const igUserId = input.igUserId.trim();
  if (!igUserId) {
    throw new InstagramError("Instagram user id is missing on this lane", 400);
  }

  const createParams = new URLSearchParams({
    image_url: input.imageUrl,
    caption: input.caption.slice(0, 2200),
    access_token: token,
  });

  const created = await graphJson<{ id?: string }>(
    `${GRAPH_BASE}/${encodeURIComponent(igUserId)}/media?${createParams.toString()}`,
    { method: "POST" },
  );

  const containerId = created.id;
  if (!containerId) {
    throw new InstagramError("Instagram did not return a media container id", 502);
  }

  // Containers need a moment before publish (especially with remote image fetch).
  let ready = false;
  for (let attempt = 0; attempt < 12; attempt++) {
    await sleep(2000);
    const status = await graphJson<{
      status_code?: string;
      status?: string;
    }>(
      `${GRAPH_BASE}/${encodeURIComponent(containerId)}?fields=status_code,status&access_token=${encodeURIComponent(token)}`,
    );
    const code = (status.status_code || status.status || "").toUpperCase();
    if (code === "FINISHED" || code === "PUBLISHED") {
      ready = true;
      break;
    }
    if (code === "ERROR" || code === "EXPIRED") {
      throw new InstagramError(
        `Instagram media container failed (${code}${status.status ? `: ${status.status}` : ""})`,
        502,
      );
    }
  }

  if (!ready) {
    throw new InstagramError(
      "Instagram media container timed out before publish",
      504,
    );
  }

  const publishParams = new URLSearchParams({
    creation_id: containerId,
    access_token: token,
  });

  const published = await graphJson<{ id?: string }>(
    `${GRAPH_BASE}/${encodeURIComponent(igUserId)}/media_publish?${publishParams.toString()}`,
    { method: "POST" },
  );

  const mediaId = published.id;
  if (!mediaId) {
    throw new InstagramError("Instagram publish returned no media id", 502);
  }

  return { containerId, mediaId };
}
