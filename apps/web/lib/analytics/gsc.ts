import crypto from "node:crypto";
import fs from "node:fs";

/**
 * Google Search Console (REST + service-account JWT).
 * - Search Analytics: https://developers.google.com/webmaster-tools/v1/searchanalytics/query
 * - Sitemaps: https://developers.google.com/webmaster-tools/v1/sitemaps
 * - URL Inspection: https://developers.google.com/webmaster-tools/v1/urlInspection.index/inspect
 *
 * Reuses the same service-account env vars as GA4:
 * GA4_SERVICE_ACCOUNT_JSON / GA4_SERVICE_ACCOUNT_PATH / GOOGLE_APPLICATION_CREDENTIALS
 *
 * Enable "Google Search Console API" and add the SA email as a user on each property.
 * Restricted is enough for analytics + sitemaps; Owner is often required for URL Inspection.
 */

export class GscError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "GscError";
    this.status = status;
  }
}

type ServiceAccount = {
  client_email: string;
  private_key: string;
  token_uri?: string;
};

export type GscTotals = {
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
};

export type GscRow = {
  keys: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
};

export type GscQueryRow = {
  query: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
};

export type GscPageRow = {
  page: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
};

export type GscDimensionRow = {
  key: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
};

export type GscSitemapEntry = {
  path: string;
  lastSubmitted: string | null;
  isPending: boolean;
  isSitemapsIndex: boolean;
  type: string | null;
  lastDownloaded: string | null;
  warnings: number;
  errors: number;
  contents: Array<{ type: string; submitted: number; indexed: number }>;
};

export type GscUrlInspection = {
  inspectionUrl: string;
  indexStatusResult: {
    verdict: string | null;
    coverageState: string | null;
    robotsTxtState: string | null;
    indexingState: string | null;
    lastCrawlTime: string | null;
    pageFetchState: string | null;
    googleCanonical: string | null;
    userCanonical: string | null;
    crawledAs: string | null;
  };
  mobileUsabilityResult: {
    verdict: string | null;
    issues: string[];
  } | null;
  richResultsResult: {
    verdict: string | null;
  } | null;
  inspectionLink: string | null;
};

export type GscCoverage = {
  siteUrl: string;
  sitemaps: GscSitemapEntry[];
  sitemapTotals: {
    count: number;
    withErrors: number;
    withWarnings: number;
    pending: number;
    submittedUrls: number;
    indexedUrls: number;
  };
  inspectedUrls: GscUrlInspection[];
  inspectionNote: string | null;
};

export type GscSiteSummary = {
  siteUrl: string;
  rangeDays: number;
  startDate: string;
  endDate: string;
  current: GscTotals;
  previous: GscTotals;
  deltas: {
    clicksPct: number | null;
    impressionsPct: number | null;
    ctrPctPoints: number | null;
    positionDelta: number | null;
  };
  topQueries: GscQueryRow[];
  topPages: GscPageRow[];
  risingQueries: GscQueryRow[];
  decliningQueries: Array<GscQueryRow & { clicksDelta: number }>;
  byDevice: GscDimensionRow[];
  byCountry: GscDimensionRow[];
  coverage: GscCoverage | null;
};

export function isGscConfigured() {
  return Boolean(
    process.env.GA4_SERVICE_ACCOUNT_JSON?.trim() ||
      process.env.GA4_SERVICE_ACCOUNT_PATH?.trim() ||
      process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim() ||
      process.env.GSC_SERVICE_ACCOUNT_JSON?.trim(),
  );
}

function loadCredentials(): ServiceAccount {
  const inline =
    process.env.GSC_SERVICE_ACCOUNT_JSON?.trim() ||
    process.env.GA4_SERVICE_ACCOUNT_JSON?.trim();
  if (inline) {
    try {
      return JSON.parse(inline) as ServiceAccount;
    } catch {
      throw new GscError("Service account JSON is not valid", 500);
    }
  }

  const filePath =
    process.env.GA4_SERVICE_ACCOUNT_PATH?.trim() ||
    process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim();
  if (filePath) {
    try {
      return JSON.parse(fs.readFileSync(filePath, "utf8")) as ServiceAccount;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Could not read credentials file";
      throw new GscError(`GSC credentials file unreadable: ${message}`, 500);
    }
  }

  throw new GscError(
    "Search Console credentials missing. Set GA4_SERVICE_ACCOUNT_JSON (or GSC_SERVICE_ACCOUNT_JSON) / GOOGLE_APPLICATION_CREDENTIALS, enable Search Console API, and add the service account as a user on the property.",
    503,
  );
}

/**
 * Normalize lane GSC site URL.
 * Accepts:
 * - sc-domain:example.com
 * - https://example.com/ (URL-prefix property)
 * - example.com → sc-domain:example.com
 */
export function normalizeGscSiteUrl(raw: string | null | undefined) {
  if (!raw?.trim()) return null;
  let value = raw.trim();

  if (/^sc-domain:/i.test(value)) {
    const domain = value.slice("sc-domain:".length).trim().toLowerCase();
    if (!domain || /\s/.test(domain)) {
      throw new GscError("Invalid sc-domain:… Search Console site URL", 400);
    }
    return `sc-domain:${domain}`;
  }

  if (!/^https?:\/\//i.test(value)) {
    // Bare domain → domain property form (most common for whole-site SEO).
    const domain = value.replace(/\/+$/, "").toLowerCase();
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)) {
      throw new GscError(
        "GSC site must be sc-domain:example.com, https://example.com/, or example.com",
        400,
      );
    }
    return `sc-domain:${domain}`;
  }

  try {
    const url = new URL(value);
    // URL-prefix properties in GSC usually include trailing slash.
    if (!url.pathname || url.pathname === "") {
      url.pathname = "/";
    }
    return url.toString();
  } catch {
    throw new GscError("GSC site URL is not a valid URL", 400);
  }
}

function base64url(input: Buffer | string) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  return buf.toString("base64url");
}

async function getAccessToken() {
  const creds = loadCredentials();
  if (!creds.client_email || !creds.private_key) {
    throw new GscError("Service account JSON needs client_email and private_key", 500);
  }

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claim = {
    iss: creds.client_email,
    scope: "https://www.googleapis.com/auth/webmasters.readonly",
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
    throw new GscError(`GSC auth failed: ${detail || res.statusText}`, res.status);
  }

  const data = (await res.json()) as { access_token?: string };
  if (!data.access_token) {
    throw new GscError("GSC auth returned no access_token", 502);
  }
  return data.access_token;
}

type SearchAnalyticsResponse = {
  rows?: Array<{
    keys?: string[];
    clicks?: number;
    impressions?: number;
    ctr?: number;
    position?: number;
  }>;
  responseAggregationType?: string;
};

function ymdUTC(date: Date) {
  return date.toISOString().slice(0, 10);
}

function daysAgoUTC(days: number) {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - days);
  return d;
}

function pctChange(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return ((current - previous) / previous) * 100;
}

async function querySearchAnalytics(
  siteUrl: string,
  body: Record<string, unknown>,
): Promise<SearchAnalyticsResponse> {
  const token = await getAccessToken();
  const encoded = encodeURIComponent(siteUrl);
  const res = await fetch(
    `https://www.googleapis.com/webmasters/v3/sites/${encoded}/searchAnalytics/query`,
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
      throw new GscError(
        `${detail} — add the service account email as a user on this Search Console property, and enable the Search Console API.`,
        403,
      );
    }
    if (res.status === 404) {
      throw new GscError(
        `${detail} — check the lane GSC site URL matches the property exactly (sc-domain:… or https://…).`,
        404,
      );
    }
    throw new GscError(detail || "Search Console query failed", res.status);
  }

  return (await res.json()) as SearchAnalyticsResponse;
}

function sumRows(rows: SearchAnalyticsResponse["rows"]): GscTotals {
  let clicks = 0;
  let impressions = 0;
  let positionWeighted = 0;
  for (const row of rows ?? []) {
    const c = Number(row.clicks || 0);
    const i = Number(row.impressions || 0);
    const p = Number(row.position || 0);
    clicks += c;
    impressions += i;
    positionWeighted += p * i;
  }
  return {
    clicks,
    impressions,
    ctr: impressions > 0 ? clicks / impressions : 0,
    position: impressions > 0 ? positionWeighted / impressions : 0,
  };
}

function mapQueryRows(rows: SearchAnalyticsResponse["rows"]): GscQueryRow[] {
  return (rows ?? []).map((row) => ({
    query: row.keys?.[0] || "(unknown)",
    clicks: Number(row.clicks || 0),
    impressions: Number(row.impressions || 0),
    ctr: Number(row.ctr || 0),
    position: Number(row.position || 0),
  }));
}

function mapPageRows(rows: SearchAnalyticsResponse["rows"]): GscPageRow[] {
  return (rows ?? []).map((row) => ({
    page: row.keys?.[0] || "(unknown)",
    clicks: Number(row.clicks || 0),
    impressions: Number(row.impressions || 0),
    ctr: Number(row.ctr || 0),
    position: Number(row.position || 0),
  }));
}

function mapDimensionRows(
  rows: SearchAnalyticsResponse["rows"],
): GscDimensionRow[] {
  return (rows ?? []).map((row) => ({
    key: row.keys?.[0] || "(unknown)",
    clicks: Number(row.clicks || 0),
    impressions: Number(row.impressions || 0),
    ctr: Number(row.ctr || 0),
    position: Number(row.position || 0),
  }));
}

type SitemapListResponse = {
  sitemap?: Array<{
    path?: string;
    lastSubmitted?: string;
    isPending?: boolean;
    isSitemapsIndex?: boolean;
    type?: string;
    lastDownloaded?: string;
    warnings?: string | number;
    errors?: string | number;
    contents?: Array<{
      type?: string;
      submitted?: string | number;
      indexed?: string | number;
    }>;
  }>;
};

type UrlInspectionResponse = {
  inspectionResult?: {
    inspectionResultLink?: string;
    indexStatusResult?: {
      verdict?: string;
      coverageState?: string;
      robotsTxtState?: string;
      indexingState?: string;
      lastCrawlTime?: string;
      pageFetchState?: string;
      googleCanonical?: string;
      userCanonical?: string;
      crawledAs?: string;
    };
    mobileUsabilityResult?: {
      verdict?: string;
      issues?: Array<{ issueType?: string; severity?: string; message?: string }>;
    };
    richResultsResult?: {
      verdict?: string;
    };
  };
};

async function gscFetchJson<T>(
  url: string,
  init?: RequestInit,
): Promise<T> {
  const token = await getAccessToken();
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });

  if (!res.ok) {
    let detail = res.statusText;
    try {
      const err = (await res.json()) as { error?: { message?: string } };
      if (err.error?.message) detail = err.error.message;
    } catch {
      // keep statusText
    }
    if (res.status === 403) {
      throw new GscError(
        `${detail} — add the service account email as a user on this Search Console property (Owner may be required for URL Inspection), and enable the Search Console API.`,
        403,
      );
    }
    if (res.status === 404) {
      throw new GscError(
        `${detail} — check the lane GSC site URL matches the property exactly (sc-domain:… or https://…).`,
        404,
      );
    }
    throw new GscError(detail || "Search Console request failed", res.status);
  }

  return (await res.json()) as T;
}

/** List submitted sitemaps + error/warning counts for a property. */
export async function listGscSitemaps(
  siteUrlRaw: string,
): Promise<GscSitemapEntry[]> {
  const siteUrl = normalizeGscSiteUrl(siteUrlRaw);
  if (!siteUrl) {
    throw new GscError("Search Console site URL is required", 400);
  }

  const encoded = encodeURIComponent(siteUrl);
  const data = await gscFetchJson<SitemapListResponse>(
    `https://www.googleapis.com/webmasters/v3/sites/${encoded}/sitemaps`,
  );

  return (data.sitemap ?? []).map((entry) => ({
    path: entry.path || "(unknown)",
    lastSubmitted: entry.lastSubmitted ?? null,
    isPending: Boolean(entry.isPending),
    isSitemapsIndex: Boolean(entry.isSitemapsIndex),
    type: entry.type ?? null,
    lastDownloaded: entry.lastDownloaded ?? null,
    warnings: Number(entry.warnings || 0),
    errors: Number(entry.errors || 0),
    contents: (entry.contents ?? []).map((c) => ({
      type: c.type || "unknown",
      submitted: Number(c.submitted || 0),
      indexed: Number(c.indexed || 0),
    })),
  }));
}

/** Inspect one URL's Google index status (URL Inspection API). */
export async function inspectGscUrl(
  siteUrlRaw: string,
  inspectionUrl: string,
): Promise<GscUrlInspection> {
  const siteUrl = normalizeGscSiteUrl(siteUrlRaw);
  if (!siteUrl) {
    throw new GscError("Search Console site URL is required", 400);
  }
  const url = inspectionUrl.trim();
  if (!url || !/^https?:\/\//i.test(url)) {
    throw new GscError("inspectionUrl must be an absolute http(s) URL", 400);
  }

  const data = await gscFetchJson<UrlInspectionResponse>(
    "https://searchconsole.googleapis.com/v1/urlInspection/index:inspect",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        inspectionUrl: url,
        siteUrl,
        languageCode: "en-US",
      }),
    },
  );

  const result = data.inspectionResult;
  const index = result?.indexStatusResult;
  const mobile = result?.mobileUsabilityResult;
  const rich = result?.richResultsResult;

  return {
    inspectionUrl: url,
    indexStatusResult: {
      verdict: index?.verdict ?? null,
      coverageState: index?.coverageState ?? null,
      robotsTxtState: index?.robotsTxtState ?? null,
      indexingState: index?.indexingState ?? null,
      lastCrawlTime: index?.lastCrawlTime ?? null,
      pageFetchState: index?.pageFetchState ?? null,
      googleCanonical: index?.googleCanonical ?? null,
      userCanonical: index?.userCanonical ?? null,
      crawledAs: index?.crawledAs ?? null,
    },
    mobileUsabilityResult: mobile
      ? {
          verdict: mobile.verdict ?? null,
          issues: (mobile.issues ?? [])
            .map((issue) => issue.message || issue.issueType || "")
            .filter(Boolean),
        }
      : null,
    richResultsResult: rich ? { verdict: rich.verdict ?? null } : null,
    inspectionLink: result?.inspectionResultLink ?? null,
  };
}

export type GscCoverageOptions = {
  /** Extra URLs to inspect (absolute). Top pages are also sampled. */
  inspectUrls?: string[];
  /** How many top pages to auto-inspect (0–5). Default 3. */
  inspectTopPages?: number;
  topPages?: GscPageRow[];
};

/** Sitemaps health + sample URL Inspection for index coverage. */
export async function getSearchConsoleCoverage(
  siteUrlRaw: string,
  options: GscCoverageOptions = {},
): Promise<GscCoverage> {
  const siteUrl = normalizeGscSiteUrl(siteUrlRaw);
  if (!siteUrl) {
    throw new GscError("Search Console site URL is required", 400);
  }

  const sitemaps = await listGscSitemaps(siteUrl);
  let submittedUrls = 0;
  let indexedUrls = 0;
  for (const sitemap of sitemaps) {
    for (const content of sitemap.contents) {
      submittedUrls += content.submitted;
      indexedUrls += content.indexed;
    }
  }

  const inspectTopPages = Math.min(
    Math.max(options.inspectTopPages ?? 3, 0),
    5,
  );
  const candidates = [
    ...(options.inspectUrls ?? []),
    ...(options.topPages ?? [])
      .slice(0, inspectTopPages)
      .map((row) => row.page),
  ]
    .map((u) => u.trim())
    .filter((u) => /^https?:\/\//i.test(u));

  const uniqueUrls = [...new Set(candidates)].slice(0, 5);
  const inspectedUrls: GscUrlInspection[] = [];
  let inspectionNote: string | null = null;

  for (const url of uniqueUrls) {
    try {
      inspectedUrls.push(await inspectGscUrl(siteUrl, url));
    } catch (error) {
      const message =
        error instanceof GscError
          ? error.message
          : error instanceof Error
            ? error.message
            : "URL Inspection failed";
      inspectionNote = message;
      // Stop after first failure (often Owner permission / quota).
      break;
    }
  }

  if (uniqueUrls.length === 0) {
    inspectionNote =
      inspectionNote ??
      "No absolute page URLs available to inspect. Pass inspectUrl or wait for top pages with https:// URLs.";
  }

  return {
    siteUrl,
    sitemaps,
    sitemapTotals: {
      count: sitemaps.length,
      withErrors: sitemaps.filter((s) => s.errors > 0).length,
      withWarnings: sitemaps.filter((s) => s.warnings > 0).length,
      pending: sitemaps.filter((s) => s.isPending).length,
      submittedUrls,
      indexedUrls,
    },
    inspectedUrls,
    inspectionNote,
  };
}

export type GscSummaryOptions = {
  days?: number;
  includeCoverage?: boolean;
  inspectUrls?: string[];
  inspectTopPages?: number;
};

/** Summarize Search Console performance for the last N days vs prior N days. */
export async function getSearchConsoleSummary(
  siteUrlRaw: string,
  daysOrOptions: number | GscSummaryOptions = 28,
): Promise<GscSiteSummary> {
  const options: GscSummaryOptions =
    typeof daysOrOptions === "number"
      ? { days: daysOrOptions }
      : daysOrOptions;
  const days = options.days ?? 28;

  const siteUrl = normalizeGscSiteUrl(siteUrlRaw);
  if (!siteUrl) {
    throw new GscError("Search Console site URL is required", 400);
  }

  const rangeDays = Math.min(Math.max(Math.floor(days) || 28, 1), 90);
  // GSC data often lags ~2–3 days; end at 3 days ago for stabler totals.
  const end = daysAgoUTC(3);
  const currentStart = daysAgoUTC(3 + rangeDays - 1);
  const previousEnd = daysAgoUTC(3 + rangeDays);
  const previousStart = daysAgoUTC(3 + rangeDays * 2 - 1);

  const startDate = ymdUTC(currentStart);
  const endDate = ymdUTC(end);
  const prevStartDate = ymdUTC(previousStart);
  const prevEndDate = ymdUTC(previousEnd);

  const [
    currentRaw,
    previousRaw,
    topQueriesRaw,
    topPagesRaw,
    prevQueriesRaw,
    deviceRaw,
    countryRaw,
  ] = await Promise.all([
    querySearchAnalytics(siteUrl, {
      startDate,
      endDate,
      dimensions: ["date"],
      rowLimit: rangeDays + 5,
    }),
    querySearchAnalytics(siteUrl, {
      startDate: prevStartDate,
      endDate: prevEndDate,
      dimensions: ["date"],
      rowLimit: rangeDays + 5,
    }),
    querySearchAnalytics(siteUrl, {
      startDate,
      endDate,
      dimensions: ["query"],
      rowLimit: 15,
      startRow: 0,
    }),
    querySearchAnalytics(siteUrl, {
      startDate,
      endDate,
      dimensions: ["page"],
      rowLimit: 15,
      startRow: 0,
    }),
    querySearchAnalytics(siteUrl, {
      startDate: prevStartDate,
      endDate: prevEndDate,
      dimensions: ["query"],
      rowLimit: 50,
      startRow: 0,
    }),
    querySearchAnalytics(siteUrl, {
      startDate,
      endDate,
      dimensions: ["device"],
      rowLimit: 10,
    }),
    querySearchAnalytics(siteUrl, {
      startDate,
      endDate,
      dimensions: ["country"],
      rowLimit: 15,
    }),
  ]);

  const current = sumRows(currentRaw.rows);
  const previous = sumRows(previousRaw.rows);
  const topQueries = mapQueryRows(topQueriesRaw.rows);
  const topPages = mapPageRows(topPagesRaw.rows);
  const byDevice = mapDimensionRows(deviceRaw.rows);
  const byCountry = mapDimensionRows(countryRaw.rows);

  const prevByQuery = new Map(
    mapQueryRows(prevQueriesRaw.rows).map((row) => [row.query, row]),
  );

  const risingQueries = [...topQueries]
    .map((row) => {
      const prev = prevByQuery.get(row.query);
      const clicksDelta = row.clicks - (prev?.clicks ?? 0);
      return { ...row, clicksDelta };
    })
    .filter((row) => row.clicksDelta > 0)
    .sort((a, b) => b.clicksDelta - a.clicksDelta)
    .slice(0, 8)
    .map(({ clicksDelta: _d, ...row }) => row);

  const decliningQueries = [...topQueries]
    .map((row) => {
      const prev = prevByQuery.get(row.query);
      const clicksDelta = row.clicks - (prev?.clicks ?? 0);
      return { ...row, clicksDelta };
    })
    .filter((row) => row.clicksDelta < 0)
    .sort((a, b) => a.clicksDelta - b.clicksDelta)
    .slice(0, 8);

  // Also surface previously strong queries that fell out of the current top set.
  for (const prev of mapQueryRows(prevQueriesRaw.rows).slice(0, 20)) {
    if (topQueries.some((q) => q.query === prev.query)) continue;
    if (prev.clicks < 3) continue;
    decliningQueries.push({
      query: prev.query,
      clicks: 0,
      impressions: 0,
      ctr: 0,
      position: prev.position,
      clicksDelta: -prev.clicks,
    });
  }
  decliningQueries.sort((a, b) => a.clicksDelta - b.clicksDelta);

  let coverage: GscCoverage | null = null;
  if (options.includeCoverage !== false) {
    try {
      coverage = await getSearchConsoleCoverage(siteUrl, {
        inspectUrls: options.inspectUrls,
        inspectTopPages: options.inspectTopPages,
        topPages,
      });
    } catch (error) {
      // Coverage is additive — performance summary still succeeds.
      const message =
        error instanceof Error ? error.message : "Coverage fetch failed";
      coverage = {
        siteUrl,
        sitemaps: [],
        sitemapTotals: {
          count: 0,
          withErrors: 0,
          withWarnings: 0,
          pending: 0,
          submittedUrls: 0,
          indexedUrls: 0,
        },
        inspectedUrls: [],
        inspectionNote: message,
      };
    }
  }

  return {
    siteUrl,
    rangeDays,
    startDate,
    endDate,
    current,
    previous,
    deltas: {
      clicksPct: pctChange(current.clicks, previous.clicks),
      impressionsPct: pctChange(current.impressions, previous.impressions),
      ctrPctPoints: (current.ctr - previous.ctr) * 100,
      positionDelta: current.position - previous.position,
    },
    topQueries,
    topPages,
    risingQueries,
    decliningQueries: decliningQueries.slice(0, 8),
    byDevice,
    byCountry,
    coverage,
  };
}
