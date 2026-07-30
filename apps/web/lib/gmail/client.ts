/**
 * Gmail API client (OAuth refresh-token flow).
 * Docs: https://developers.google.com/gmail/api
 */

export class GmailError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "GmailError";
    this.status = status;
  }
}

export type GmailMessage = {
  id: string;
  threadId: string;
  from: string;
  fromEmail: string;
  to: string;
  subject: string;
  snippet: string;
  bodyText: string;
  date: string | null;
  labelIds: string[];
};

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1";
const OAUTH_TOKEN = "https://oauth2.googleapis.com/token";
const OAUTH_AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const PROCESSED_LABEL = "Jarvis/Processed";

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/gmail.send",
].join(" ");

export function isGmailConfigured() {
  return Boolean(
    process.env.GMAIL_CLIENT_ID?.trim() &&
      process.env.GMAIL_CLIENT_SECRET?.trim() &&
      process.env.GMAIL_REFRESH_TOKEN?.trim(),
  );
}

export function isGmailOAuthAppConfigured() {
  return Boolean(
    process.env.GMAIL_CLIENT_ID?.trim() &&
      process.env.GMAIL_CLIENT_SECRET?.trim(),
  );
}

function requireEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new GmailError(`${name} is not set`, 503);
  }
  return value;
}

export function buildGmailAuthUrl(redirectUri: string, state?: string) {
  const clientId = requireEnv("GMAIL_CLIENT_ID");
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SCOPES,
    access_type: "offline",
    prompt: "consent",
  });
  if (state) params.set("state", state);
  return `${OAUTH_AUTH}?${params.toString()}`;
}

export async function exchangeGmailCode(code: string, redirectUri: string) {
  const res = await fetch(OAUTH_TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: requireEnv("GMAIL_CLIENT_ID"),
      client_secret: requireEnv("GMAIL_CLIENT_SECRET"),
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
    cache: "no-store",
  });
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 300);
    throw new GmailError(`OAuth exchange failed: ${detail}`, res.status);
  }
  return (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
  };
}

let cachedToken: { value: string; expiresAt: number } | null = null;

async function getAccessToken() {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) {
    return cachedToken.value;
  }

  const res = await fetch(OAUTH_TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: requireEnv("GMAIL_CLIENT_ID"),
      client_secret: requireEnv("GMAIL_CLIENT_SECRET"),
      refresh_token: requireEnv("GMAIL_REFRESH_TOKEN"),
      grant_type: "refresh_token",
    }),
    cache: "no-store",
  });

  if (!res.ok) {
    const detail = (await res.text()).slice(0, 300);
    throw new GmailError(`Gmail auth failed: ${detail}`, res.status);
  }

  const data = (await res.json()) as {
    access_token?: string;
    expires_in?: number;
  };
  if (!data.access_token) {
    throw new GmailError("Gmail auth returned no access_token", 502);
  }
  cachedToken = {
    value: data.access_token,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
  };
  return data.access_token;
}

async function gmailFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const token = await getAccessToken();
  const res = await fetch(`${GMAIL_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
    cache: "no-store",
  });

  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = (await res.json()) as { error?: { message?: string } };
      if (body.error?.message) detail = body.error.message;
    } catch {
      // keep statusText
    }
    throw new GmailError(detail || "Gmail API request failed", res.status);
  }

  if (res.status === 204) return undefined as T;
  const text = await res.text();
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}

export function parseEmailAddress(raw: string | null | undefined) {
  if (!raw?.trim()) return "";
  const match = raw.match(/<([^>]+)>/);
  const email = (match?.[1] || raw).trim().toLowerCase();
  return email.replace(/^mailto:/i, "");
}

function decodeBase64Url(data: string) {
  const normalized = data.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(normalized, "base64").toString("utf8");
}

type GmailApiMessage = {
  id: string;
  threadId: string;
  snippet?: string;
  labelIds?: string[];
  payload?: {
    headers?: Array<{ name: string; value: string }>;
    mimeType?: string;
    body?: { data?: string };
    parts?: GmailApiMessage["payload"][];
  };
};

function headerValue(
  headers: Array<{ name: string; value: string }> | undefined,
  name: string,
) {
  const found = headers?.find(
    (h) => h.name.toLowerCase() === name.toLowerCase(),
  );
  return found?.value ?? "";
}

function extractTextParts(
  payload: GmailApiMessage["payload"] | undefined,
): string {
  if (!payload) return "";
  if (payload.mimeType?.startsWith("text/plain") && payload.body?.data) {
    return decodeBase64Url(payload.body.data);
  }
  if (payload.parts?.length) {
    const plain = payload.parts
      .map((part) => extractTextParts(part))
      .filter(Boolean);
    if (plain.length) return plain.join("\n\n");
  }
  if (payload.mimeType?.startsWith("text/html") && payload.body?.data) {
    const html = decodeBase64Url(payload.body.data);
    return html
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }
  if (payload.body?.data) {
    return decodeBase64Url(payload.body.data);
  }
  return "";
}

function normalizeMessage(raw: GmailApiMessage): GmailMessage {
  const headers = raw.payload?.headers;
  const from = headerValue(headers, "From");
  return {
    id: raw.id,
    threadId: raw.threadId,
    from,
    fromEmail: parseEmailAddress(from),
    to: headerValue(headers, "To"),
    subject: headerValue(headers, "Subject") || "(no subject)",
    snippet: raw.snippet || "",
    bodyText: extractTextParts(raw.payload).trim() || raw.snippet || "",
    date: headerValue(headers, "Date") || null,
    labelIds: raw.labelIds ?? [],
  };
}

export async function listRecentMessageIds(query: string, maxResults = 20) {
  const params = new URLSearchParams({
    q: query,
    maxResults: String(Math.min(Math.max(maxResults, 1), 50)),
  });
  const data = await gmailFetch<{ messages?: Array<{ id: string; threadId: string }> }>(
    `/users/me/messages?${params.toString()}`,
  );
  return data.messages ?? [];
}

export async function getMessage(messageId: string): Promise<GmailMessage> {
  const raw = await gmailFetch<GmailApiMessage>(
    `/users/me/messages/${encodeURIComponent(messageId)}?format=full`,
  );
  return normalizeMessage(raw);
}

async function listLabels() {
  const data = await gmailFetch<{
    labels?: Array<{ id: string; name: string; type?: string }>;
  }>("/users/me/labels");
  return data.labels ?? [];
}

export async function ensureProcessedLabelId() {
  const labels = await listLabels();
  const existing = labels.find(
    (label) => label.name.toLowerCase() === PROCESSED_LABEL.toLowerCase(),
  );
  if (existing) return existing.id;

  const created = await gmailFetch<{ id: string }>("/users/me/labels", {
    method: "POST",
    body: JSON.stringify({
      name: PROCESSED_LABEL,
      labelListVisibility: "labelShow",
      messageListVisibility: "show",
    }),
  });
  return created.id;
}

export async function markMessageProcessed(messageId: string) {
  const labelId = await ensureProcessedLabelId();
  await gmailFetch(`/users/me/messages/${encodeURIComponent(messageId)}/modify`, {
    method: "POST",
    body: JSON.stringify({
      addLabelIds: [labelId],
      removeLabelIds: ["UNREAD"],
    }),
  });
}

function encodeRfc2822(message: {
  to: string;
  subject: string;
  body: string;
  inReplyTo?: string | null;
  references?: string | null;
  threadId?: string | null;
}) {
  const lines = [
    `To: ${message.to}`,
    `Subject: ${message.subject}`,
    "Content-Type: text/plain; charset=utf-8",
    "MIME-Version: 1.0",
  ];
  if (message.inReplyTo) lines.push(`In-Reply-To: ${message.inReplyTo}`);
  if (message.references) lines.push(`References: ${message.references}`);
  lines.push("", message.body);
  return Buffer.from(lines.join("\r\n"))
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export async function getMessageHeaders(messageId: string) {
  const raw = await gmailFetch<GmailApiMessage>(
    `/users/me/messages/${encodeURIComponent(messageId)}?format=metadata&metadataHeaders=Message-ID&metadataHeaders=References&metadataHeaders=Subject`,
  );
  const headers = raw.payload?.headers;
  return {
    messageIdHeader: headerValue(headers, "Message-ID"),
    references: headerValue(headers, "References"),
    subject: headerValue(headers, "Subject"),
    threadId: raw.threadId,
  };
}

export async function sendReply(input: {
  to: string;
  subject: string;
  body: string;
  threadId: string;
  inReplyToMessageId: string;
}) {
  const meta = await getMessageHeaders(input.inReplyToMessageId);
  const subject = /^re:/i.test(input.subject)
    ? input.subject
    : `Re: ${input.subject.replace(/^re:\s*/i, "")}`;
  const references = [meta.references, meta.messageIdHeader]
    .filter(Boolean)
    .join(" ")
    .trim();

  const raw = encodeRfc2822({
    to: input.to,
    subject,
    body: input.body,
    inReplyTo: meta.messageIdHeader || null,
    references: references || meta.messageIdHeader || null,
  });

  const sent = await gmailFetch<{ id: string; threadId: string }>(
    "/users/me/messages/send",
    {
      method: "POST",
      body: JSON.stringify({
        raw,
        threadId: input.threadId || meta.threadId,
      }),
    },
  );
  return sent;
}

/** Split allowlist text into normalized emails. */
export function parseSenderAllowlist(raw: string | null | undefined) {
  if (!raw?.trim()) return [];
  return [
    ...new Set(
      raw
        .split(/[\s,;]+/)
        .map((part) => parseEmailAddress(part))
        .filter((email) => email.includes("@")),
    ),
  ];
}
