import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/**
 * Lightweight GA4 Data API client (REST + service-account JWT).
 * Docs: https://developers.google.com/analytics/devguides/reporting/data/v1
 */

export class Ga4Error extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "Ga4Error";
    this.status = status;
  }
}

type ServiceAccount = {
  client_email: string;
  private_key: string;
  token_uri?: string;
};

export type Ga4MetricTotals = {
  activeUsers: number;
  newUsers: number;
  sessions: number;
  screenPageViews: number;
  engagementRate: number | null;
  averageSessionDurationSec: number | null;
};

export type Ga4TopPage = {
  path: string;
  views: number;
  activeUsers: number;
};

export type Ga4PropertySummary = {
  propertyId: string;
  rangeDays: number;
  current: Ga4MetricTotals;
  previous: Ga4MetricTotals;
  deltas: {
    activeUsersPct: number | null;
    sessionsPct: number | null;
    screenPageViewsPct: number | null;
  };
  topPages: Ga4TopPage[];
};

export function isGa4Configured() {
  return Boolean(
    process.env.GA4_SERVICE_ACCOUNT_JSON?.trim() ||
      process.env.GA4_SERVICE_ACCOUNT_PATH?.trim() ||
      process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim(),
  );
}

function resolveCredentialsPath(raw: string) {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (path.isAbsolute(trimmed)) return trimmed;
  return path.resolve(process.cwd(), trimmed);
}

function loadCredentials(): ServiceAccount {
  const inline = process.env.GA4_SERVICE_ACCOUNT_JSON?.trim();
  if (inline) {
    try {
      return JSON.parse(inline) as ServiceAccount;
    } catch {
      throw new Ga4Error("GA4_SERVICE_ACCOUNT_JSON is not valid JSON", 500);
    }
  }

  const filePathRaw =
    process.env.GA4_SERVICE_ACCOUNT_PATH?.trim() ||
    process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim();
  if (filePathRaw) {
    const filePath = resolveCredentialsPath(filePathRaw);
    try {
      return JSON.parse(fs.readFileSync(filePath!, "utf8")) as ServiceAccount;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Could not read credentials file";
      throw new Ga4Error(
        `GA4 credentials file unreadable at ${filePath}: ${message}. On Railway, paste the JSON into GA4_SERVICE_ACCOUNT_JSON instead — local paths like ./lib/google/sa.json are not in the Docker image.`,
        500,
      );
    }
  }

  throw new Ga4Error(
    "GA4 credentials missing. Set Railway Variable GA4_SERVICE_ACCOUNT_JSON to the full service-account JSON key (preferred on Railway), or use a local GOOGLE_APPLICATION_CREDENTIALS path for development only.",
    503,
  );
}

export function normalizeGa4PropertyId(raw: string | null | undefined) {
  if (!raw?.trim()) return null;
  const match = raw.trim().match(/^(?:properties\/)?(\d+)$/i);
  if (!match) {
    throw new Ga4Error(
      "GA4 property id must look like 123456789 (Admin → Property settings).",
      400,
    );
  }
  return match[1];
}

function base64url(input: Buffer | string) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  return buf.toString("base64url");
}

async function getAccessToken() {
  const creds = loadCredentials();
  if (!creds.client_email || !creds.private_key) {
    throw new Ga4Error("Service account JSON needs client_email and private_key", 500);
  }

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claim = {
    iss: creds.client_email,
    scope: "https://www.googleapis.com/auth/analytics.readonly",
    aud: creds.token_uri || "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };
  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claim))}`;
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  const jwt = `${unsigned}.${base64url(signer.sign(creds.private_key))}`;

  const tokenUri = creds.token_uri || "https://oauth2.googleapis.com/token";
  const res = await fetch(tokenUri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
    cache: "no-store",
  });

  if (!res.ok) {
    const detail = (await res.text()).slice(0, 240);
    throw new Ga4Error(`GA4 auth failed: ${detail || res.statusText}`, res.status);
  }

  const data = (await res.json()) as { access_token?: string };
  if (!data.access_token) {
    throw new Ga4Error("GA4 auth returned no access_token", 502);
  }
  return data.access_token;
}

type RunReportResponse = {
  rows?: Array<{
    dimensionValues?: Array<{ value?: string }>;
    metricValues?: Array<{ value?: string }>;
  }>;
};

async function runReport(
  propertyId: string,
  body: Record<string, unknown>,
): Promise<RunReportResponse> {
  const token = await getAccessToken();
  const res = await fetch(
    `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
      cache: "no-store",
    },
  );

  if (!res.ok) {
    let detail = res.statusText;
    try {
      const err = (await res.json()) as { error?: { message?: string } };
      if (err.error?.message) detail = err.error.message;
    } catch {
      // keep statusText
    }
    if (res.status === 403) {
      throw new Ga4Error(
        `${detail} — add the service account email as a Viewer on this GA4 property.`,
        403,
      );
    }
    throw new Ga4Error(detail || "GA4 runReport failed", res.status);
  }

  return (await res.json()) as RunReportResponse;
}

function metricNumber(row: RunReportResponse["rows"], index: number) {
  const raw = row?.[0]?.metricValues?.[index]?.value;
  if (raw == null || raw === "") return 0;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

function pctChange(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return ((current - previous) / previous) * 100;
}

async function fetchTotals(
  propertyId: string,
  startDate: string,
  endDate: string,
): Promise<Ga4MetricTotals> {
  const report = await runReport(propertyId, {
    dateRanges: [{ startDate, endDate }],
    metrics: [
      { name: "activeUsers" },
      { name: "newUsers" },
      { name: "sessions" },
      { name: "screenPageViews" },
      { name: "engagementRate" },
      { name: "averageSessionDuration" },
    ],
  });

  return {
    activeUsers: metricNumber(report.rows, 0),
    newUsers: metricNumber(report.rows, 1),
    sessions: metricNumber(report.rows, 2),
    screenPageViews: metricNumber(report.rows, 3),
    engagementRate: report.rows?.[0]?.metricValues?.[4]?.value
      ? Number(report.rows[0].metricValues![4].value)
      : null,
    averageSessionDurationSec: report.rows?.[0]?.metricValues?.[5]?.value
      ? Number(report.rows[0].metricValues![5].value)
      : null,
  };
}

async function fetchTopPages(
  propertyId: string,
  startDate: string,
  endDate: string,
  limit: number,
): Promise<Ga4TopPage[]> {
  const report = await runReport(propertyId, {
    dateRanges: [{ startDate, endDate }],
    dimensions: [{ name: "pagePath" }],
    metrics: [{ name: "screenPageViews" }, { name: "activeUsers" }],
    orderBys: [{ metric: { metricName: "screenPageViews" }, desc: true }],
    limit,
  });

  return (report.rows ?? []).map((row) => ({
    path: row.dimensionValues?.[0]?.value || "/",
    views: Number(row.metricValues?.[0]?.value || 0),
    activeUsers: Number(row.metricValues?.[1]?.value || 0),
  }));
}

/** Summarize a GA4 property for the last N days vs the prior N days. */
export async function getPropertySummary(
  propertyIdRaw: string,
  days = 7,
): Promise<Ga4PropertySummary> {
  const propertyId = normalizeGa4PropertyId(propertyIdRaw);
  if (!propertyId) {
    throw new Ga4Error("GA4 property id is required", 400);
  }

  const rangeDays = Math.min(Math.max(Math.floor(days) || 7, 1), 90);
  const currentStart = `${rangeDays}daysAgo`;
  const previousStart = `${rangeDays * 2}daysAgo`;
  const previousEnd = `${rangeDays + 1}daysAgo`;

  const [current, previous, topPages] = await Promise.all([
    fetchTotals(propertyId, currentStart, "yesterday"),
    fetchTotals(propertyId, previousStart, previousEnd),
    fetchTopPages(propertyId, currentStart, "yesterday", 8),
  ]);

  return {
    propertyId,
    rangeDays,
    current,
    previous,
    deltas: {
      activeUsersPct: pctChange(current.activeUsers, previous.activeUsers),
      sessionsPct: pctChange(current.sessions, previous.sessions),
      screenPageViewsPct: pctChange(
        current.screenPageViews,
        previous.screenPageViews,
      ),
    },
    topPages,
  };
}
