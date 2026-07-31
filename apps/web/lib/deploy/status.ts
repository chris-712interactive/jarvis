import type { DeployHost, DeployStatus, Project } from "@/lib/db/schema";

export class DeployError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "DeployError";
    this.status = status;
  }
}

export type UrlHealth = {
  ok: boolean;
  statusCode: number | null;
  latencyMs: number;
  error: string | null;
};

export type PlatformDeploy = {
  provider: DeployHost;
  state: DeployStatus;
  detail: string;
  url: string | null;
  rawStatus: string | null;
};

export type LaneDeploySnapshot = {
  projectId: string;
  projectName: string;
  productionUrl: string | null;
  deployHost: DeployHost | null;
  deployProjectId: string | null;
  health: UrlHealth | null;
  platform: PlatformDeploy | null;
  /** Combined rollup used for dashboard + alerts. */
  status: DeployStatus;
  detail: string;
  checkedAt: string;
};

export function isVercelConfigured() {
  return Boolean(process.env.VERCEL_TOKEN?.trim());
}

export function isRailwayConfigured() {
  return Boolean(process.env.RAILWAY_TOKEN?.trim());
}

export function normalizeDeployHost(
  raw: string | null | undefined,
): DeployHost | null {
  if (!raw?.trim()) return null;
  const value = raw.trim().toLowerCase();
  if (value === "url" || value === "vercel" || value === "railway" || value === "aws") {
    return value;
  }
  throw new DeployError(
    "deployHost must be url, vercel, railway, or aws",
    400,
  );
}

export async function checkUrlHealth(
  urlRaw: string,
  options?: { timeoutMs?: number },
): Promise<UrlHealth> {
  let url: URL;
  try {
    url = new URL(urlRaw);
  } catch {
    return {
      ok: false,
      statusCode: null,
      latencyMs: 0,
      error: "Invalid production URL",
    };
  }
  if (!/^https?:$/i.test(url.protocol)) {
    return {
      ok: false,
      statusCode: null,
      latencyMs: 0,
      error: "productionUrl must be http(s)",
    };
  }

  const timeoutMs = options?.timeoutMs ?? 8_000;
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    // Prefer HEAD; some apps reject it — fall back to GET.
    let res = await fetch(url.toString(), {
      method: "HEAD",
      redirect: "follow",
      signal: controller.signal,
      cache: "no-store",
    });
    if (res.status === 405 || res.status === 501) {
      res = await fetch(url.toString(), {
        method: "GET",
        redirect: "follow",
        signal: controller.signal,
        cache: "no-store",
        headers: { Range: "bytes=0-0" },
      });
    }
    const latencyMs = Date.now() - started;
    const ok = res.status >= 200 && res.status < 400;
    return {
      ok,
      statusCode: res.status,
      latencyMs,
      error: ok ? null : `HTTP ${res.status}`,
    };
  } catch (error) {
    const latencyMs = Date.now() - started;
    const message =
      error instanceof Error
        ? error.name === "AbortError"
          ? `Timed out after ${timeoutMs}ms`
          : error.message
        : "Health check failed";
    return {
      ok: false,
      statusCode: null,
      latencyMs,
      error: message,
    };
  } finally {
    clearTimeout(timer);
  }
}

function mapVercelState(raw: string | null | undefined): DeployStatus {
  const state = (raw || "").toUpperCase();
  if (state === "READY") return "ok";
  if (state === "BUILDING" || state === "QUEUED" || state === "INITIALIZING") {
    return "building";
  }
  if (state === "ERROR" || state === "CANCELED" || state === "DELETED") {
    return "down";
  }
  return "unknown";
}

function mapRailwayState(raw: string | null | undefined): DeployStatus {
  const state = (raw || "").toUpperCase();
  if (state === "SUCCESS") return "ok";
  if (
    state === "BUILDING" ||
    state === "DEPLOYING" ||
    state === "INITIALIZING" ||
    state === "WAITING"
  ) {
    return "building";
  }
  if (
    state === "FAILED" ||
    state === "CRASHED" ||
    state === "REMOVED" ||
    state === "SKIPPED"
  ) {
    return "down";
  }
  return "unknown";
}

export async function checkVercelProductionDeploy(
  projectIdOrName: string,
): Promise<PlatformDeploy> {
  const token = process.env.VERCEL_TOKEN?.trim();
  if (!token) {
    throw new DeployError(
      "VERCEL_TOKEN is not set. Add a Vercel token in Railway Variables.",
      503,
    );
  }

  const teamId = process.env.VERCEL_TEAM_ID?.trim();
  const params = new URLSearchParams({
    projectId: projectIdOrName,
    target: "production",
    limit: "1",
  });
  if (teamId) params.set("teamId", teamId);

  const res = await fetch(
    `https://api.vercel.com/v6/deployments?${params.toString()}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
      cache: "no-store",
    },
  );

  if (!res.ok) {
    const detail = (await res.text()).slice(0, 240);
    throw new DeployError(
      `Vercel API ${res.status}: ${detail || res.statusText}`,
      res.status,
    );
  }

  const data = (await res.json()) as {
    deployments?: Array<{
      uid?: string;
      state?: string;
      readyState?: string;
      url?: string;
      name?: string;
    }>;
  };
  const latest = data.deployments?.[0];
  if (!latest) {
    return {
      provider: "vercel",
      state: "unknown",
      detail: "No production deployments found",
      url: null,
      rawStatus: null,
    };
  }

  const raw = latest.readyState || latest.state || null;
  const state = mapVercelState(raw);
  const url = latest.url ? `https://${latest.url}` : null;
  return {
    provider: "vercel",
    state,
    detail: `Production deploy ${raw || "unknown"}${url ? ` · ${url}` : ""}`,
    url,
    rawStatus: raw,
  };
}

export async function checkRailwayServiceDeploy(
  serviceId: string,
): Promise<PlatformDeploy> {
  const token = process.env.RAILWAY_TOKEN?.trim();
  if (!token) {
    throw new DeployError(
      "RAILWAY_TOKEN is not set. Add a Railway API token in Railway Variables.",
      503,
    );
  }

  const query = `
    query JarvisDeployStatus($serviceId: String!) {
      deployments(first: 1, input: { serviceId: $serviceId }) {
        edges {
          node {
            id
            status
            staticUrl
            createdAt
          }
        }
      }
    }
  `;

  const res = await fetch("https://backboard.railway.com/graphql/v2", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      query,
      variables: { serviceId },
    }),
    cache: "no-store",
  });

  if (!res.ok) {
    const detail = (await res.text()).slice(0, 240);
    throw new DeployError(
      `Railway API ${res.status}: ${detail || res.statusText}`,
      res.status,
    );
  }

  const data = (await res.json()) as {
    errors?: Array<{ message?: string }>;
    data?: {
      deployments?: {
        edges?: Array<{
          node?: {
            id?: string;
            status?: string;
            staticUrl?: string | null;
          };
        }>;
      };
    };
  };

  if (data.errors?.length) {
    throw new DeployError(
      data.errors.map((e) => e.message || "Railway GraphQL error").join("; "),
      502,
    );
  }

  const latest = data.data?.deployments?.edges?.[0]?.node;
  if (!latest) {
    return {
      provider: "railway",
      state: "unknown",
      detail: "No deployments found for this service id",
      url: null,
      rawStatus: null,
    };
  }

  const raw = latest.status || null;
  const state = mapRailwayState(raw);
  const url = latest.staticUrl
    ? latest.staticUrl.startsWith("http")
      ? latest.staticUrl
      : `https://${latest.staticUrl}`
    : null;
  return {
    provider: "railway",
    state,
    detail: `Service deploy ${raw || "unknown"}${url ? ` · ${url}` : ""}`,
    url,
    rawStatus: raw,
  };
}

function rollupStatus(input: {
  health: UrlHealth | null;
  platform: PlatformDeploy | null;
}): { status: DeployStatus; detail: string } {
  const { health, platform } = input;
  const bits: string[] = [];

  if (platform) bits.push(platform.detail);
  if (health) {
    bits.push(
      health.ok
        ? `URL health HTTP ${health.statusCode} in ${health.latencyMs}ms`
        : `URL health failed: ${health.error || "down"} (${health.latencyMs}ms)`,
    );
  }

  if (!health && !platform) {
    return { status: "unknown", detail: "No production URL or deploy id configured" };
  }

  // URL down wins over a READY deploy (DNS/app crash).
  if (health && !health.ok) {
    return {
      status: "down",
      detail: bits.join(" · "),
    };
  }

  if (platform) {
    if (platform.state === "down") {
      return { status: "down", detail: bits.join(" · ") };
    }
    if (platform.state === "building") {
      return {
        status: health?.ok ? "building" : "building",
        detail: bits.join(" · "),
      };
    }
    if (platform.state === "ok" && health?.ok) {
      return { status: "ok", detail: bits.join(" · ") };
    }
    if (platform.state === "ok" && !health) {
      return { status: "ok", detail: bits.join(" · ") };
    }
    if (platform.state === "unknown" && health?.ok) {
      return { status: "degraded", detail: bits.join(" · ") };
    }
    return {
      status: platform.state === "unknown" ? "unknown" : platform.state,
      detail: bits.join(" · "),
    };
  }

  // URL-only / AWS URL health
  if (health?.ok) {
    return { status: "ok", detail: bits.join(" · ") };
  }

  return { status: "unknown", detail: bits.join(" · ") || "Unknown" };
}

/** Live probe for a lane (does not persist). */
export async function probeLaneDeploy(
  project: Project,
): Promise<LaneDeploySnapshot> {
  const productionUrl = project.productionUrl?.trim() || null;
  let deployHost: DeployHost | null = null;
  try {
    deployHost =
      normalizeDeployHost(project.deployHost) ??
      (productionUrl ? "url" : null);
  } catch {
    deployHost = productionUrl ? "url" : null;
  }
  const deployProjectId = project.deployProjectId?.trim() || null;

  let health: UrlHealth | null = null;
  let platform: PlatformDeploy | null = null;

  if (productionUrl) {
    health = await checkUrlHealth(productionUrl);
  }

  if (deployHost === "vercel" && deployProjectId) {
    try {
      platform = await checkVercelProductionDeploy(deployProjectId);
    } catch (error) {
      platform = {
        provider: "vercel",
        state: "unknown",
        detail:
          error instanceof Error ? error.message : "Vercel status check failed",
        url: null,
        rawStatus: null,
      };
    }
  } else if (deployHost === "railway" && deployProjectId) {
    try {
      platform = await checkRailwayServiceDeploy(deployProjectId);
    } catch (error) {
      platform = {
        provider: "railway",
        state: "unknown",
        detail:
          error instanceof Error ? error.message : "Railway status check failed",
        url: null,
        rawStatus: null,
      };
    }
  } else if (deployHost === "aws") {
    platform = {
      provider: "aws",
      state: health ? (health.ok ? "ok" : "down") : "unknown",
      detail: health
        ? "AWS host uses URL health in v1 (set productionUrl)."
        : "Set productionUrl for AWS health checks (API wiring later).",
      url: productionUrl,
      rawStatus: health?.ok ? "healthy" : health ? "unhealthy" : null,
    };
  } else if (deployHost === "url" && health) {
    platform = {
      provider: "url",
      state: health.ok ? "ok" : "down",
      detail: "URL-only health check",
      url: productionUrl,
      rawStatus: health.ok ? "up" : "down",
    };
  }

  const rolled = rollupStatus({ health, platform });
  return {
    projectId: project.id,
    projectName: project.name,
    productionUrl,
    deployHost,
    deployProjectId,
    health,
    platform,
    status: rolled.status,
    detail: rolled.detail,
    checkedAt: new Date().toISOString(),
  };
}
