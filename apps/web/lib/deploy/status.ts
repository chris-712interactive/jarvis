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

/** Infer host when the form left deployHost blank but an id is present. */
export function inferDeployHost(input: {
  deployHost?: string | null;
  deployProjectId?: string | null;
  productionUrl?: string | null;
}): DeployHost | null {
  try {
    const explicit = normalizeDeployHost(input.deployHost);
    if (explicit) return explicit;
  } catch {
    // fall through to inference
  }

  const id = input.deployProjectId?.trim() || "";
  if (/^prj_/i.test(id)) return "vercel";
  // Railway project/service IDs are UUIDs.
  if (
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      id,
    )
  ) {
    return "railway";
  }
  // Vercel project names are common when not using prj_ ids.
  if (id && !input.productionUrl?.trim()) {
    // Ambiguous non-UUID id with no URL — prefer Vercel project name.
    return "vercel";
  }
  if (input.productionUrl?.trim()) return "url";
  return null;
}

export function isLaneDeployConfigured(project: {
  productionUrl?: string | null;
  deployHost?: string | null;
  deployProjectId?: string | null;
}) {
  return Boolean(
    project.productionUrl?.trim() || project.deployProjectId?.trim(),
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
      "VERCEL_TOKEN is not set on Jarvis. Add a Vercel token in Railway Variables.",
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
  projectOrServiceId: string,
): Promise<PlatformDeploy> {
  const token = process.env.RAILWAY_TOKEN?.trim();
  if (!token) {
    throw new DeployError(
      "RAILWAY_TOKEN is not set on Jarvis. Add a Railway account/workspace token in Railway Variables.",
      503,
    );
  }

  const id = projectOrServiceId.trim();

  // Prefer project lookup — users often paste Railway project IDs.
  const projectQuery = `
    query JarvisProjectDeploy($id: String!) {
      project(id: $id) {
        name
        services {
          edges {
            node {
              id
              name
              serviceInstances {
                edges {
                  node {
                    latestDeployment {
                      status
                      staticUrl
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  `;

  const projectData = await railwayGraphql<{
    project?: {
      name?: string;
      services?: {
        edges?: Array<{
          node?: {
            id?: string;
            name?: string;
            serviceInstances?: {
              edges?: Array<{
                node?: {
                  latestDeployment?: {
                    status?: string;
                    staticUrl?: string | null;
                  } | null;
                };
              }>;
            };
          };
        }>;
      };
    } | null;
  }>(token, projectQuery, { id });

  if (projectData.project) {
    const services = projectData.project.services?.edges ?? [];
    let best: {
      status: string | null;
      url: string | null;
      serviceName: string;
    } | null = null;

    for (const edge of services) {
      const service = edge.node;
      if (!service) continue;
      for (const instance of service.serviceInstances?.edges ?? []) {
        const dep = instance.node?.latestDeployment;
        if (!dep?.status) continue;
        const mapped = mapRailwayState(dep.status);
        const url = dep.staticUrl
          ? dep.staticUrl.startsWith("http")
            ? dep.staticUrl
            : `https://${dep.staticUrl}`
          : null;
        // Prefer an unhealthy signal if any service is down; else first SUCCESS.
        if (
          !best ||
          mapped === "down" ||
          (mapped === "building" && mapRailwayState(best.status) === "ok") ||
          (mapped === "ok" && !best.status)
        ) {
          best = {
            status: dep.status,
            url,
            serviceName: service.name || service.id || "service",
          };
          if (mapped === "down") break;
        }
      }
    }

    if (!best) {
      return {
        provider: "railway",
        state: "unknown",
        detail: `Railway project "${projectData.project.name || id}" has no service deployments yet`,
        url: null,
        rawStatus: null,
      };
    }

    const state = mapRailwayState(best.status);
    return {
      provider: "railway",
      state,
      detail: `Railway ${best.serviceName}: ${best.status || "unknown"}${best.url ? ` · ${best.url}` : ""}`,
      url: best.url,
      rawStatus: best.status,
    };
  }

  // Fallback: treat the id as a service id.
  const serviceQuery = `
    query JarvisServiceDeploy($id: String!) {
      service(id: $id) {
        id
        name
        serviceInstances {
          edges {
            node {
              latestDeployment {
                status
                staticUrl
              }
            }
          }
        }
      }
    }
  `;

  const serviceData = await railwayGraphql<{
    service?: {
      id?: string;
      name?: string;
      serviceInstances?: {
        edges?: Array<{
          node?: {
            latestDeployment?: {
              status?: string;
              staticUrl?: string | null;
            } | null;
          };
        }>;
      };
    } | null;
  }>(token, serviceQuery, { id });

  const service = serviceData.service;
  if (!service) {
    return {
      provider: "railway",
      state: "unknown",
      detail: `Railway id "${id}" matched neither a project nor a service. Copy Project ID or Service ID from Railway (Cmd/Ctrl+K).`,
      url: null,
      rawStatus: null,
    };
  }

  const latest =
    service.serviceInstances?.edges?.[0]?.node?.latestDeployment ?? null;
  if (!latest?.status) {
    return {
      provider: "railway",
      state: "unknown",
      detail: `Railway service "${service.name || id}" has no latest deployment`,
      url: null,
      rawStatus: null,
    };
  }

  const raw = latest.status;
  const state = mapRailwayState(raw);
  const url = latest.staticUrl
    ? latest.staticUrl.startsWith("http")
      ? latest.staticUrl
      : `https://${latest.staticUrl}`
    : null;
  return {
    provider: "railway",
    state,
    detail: `Railway ${service.name || id}: ${raw}${url ? ` · ${url}` : ""}`,
    url,
    rawStatus: raw,
  };
}

async function railwayGraphql<T>(
  token: string,
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  const res = await fetch("https://backboard.railway.com/graphql/v2", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ query, variables }),
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
    data?: T;
  };

  if (data.errors?.length) {
    // "Not found" style errors should fall through to the next lookup strategy.
    const message = data.errors
      .map((e) => e.message || "Railway GraphQL error")
      .join("; ");
    if (/not found|could not find|no project|no service/i.test(message)) {
      return {} as T;
    }
    throw new DeployError(message, 502);
  }

  return (data.data ?? {}) as T;
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
  const deployProjectId = project.deployProjectId?.trim() || null;
  const deployHost = inferDeployHost({
    deployHost: project.deployHost,
    deployProjectId,
    productionUrl,
  });

  let health: UrlHealth | null = null;
  let platform: PlatformDeploy | null = null;

  if (productionUrl) {
    health = await checkUrlHealth(productionUrl);
  }

  if (deployHost === "vercel") {
    if (!deployProjectId) {
      platform = {
        provider: "vercel",
        state: "unknown",
        detail:
          "deployHost is vercel but deployProjectId is empty — paste the Vercel project id (prj_…) or project name.",
        url: null,
        rawStatus: null,
      };
    } else if (!isVercelConfigured()) {
      platform = {
        provider: "vercel",
        state: "unknown",
        detail:
          "VERCEL_TOKEN is not set on Jarvis. Add a Vercel token in Railway Variables, then re-check.",
        url: null,
        rawStatus: null,
      };
    } else {
      try {
        platform = await checkVercelProductionDeploy(deployProjectId);
      } catch (error) {
        platform = {
          provider: "vercel",
          state: "unknown",
          detail:
            error instanceof Error
              ? error.message
              : "Vercel status check failed",
          url: null,
          rawStatus: null,
        };
      }
    }
  } else if (deployHost === "railway") {
    if (!deployProjectId) {
      platform = {
        provider: "railway",
        state: "unknown",
        detail:
          "deployHost is railway but deployProjectId is empty — paste the Railway project or service UUID (Cmd/Ctrl+K → Copy ID).",
        url: null,
        rawStatus: null,
      };
    } else if (!isRailwayConfigured()) {
      platform = {
        provider: "railway",
        state: "unknown",
        detail:
          "RAILWAY_TOKEN is not set on Jarvis. Add a Railway account/workspace token in Railway Variables, then re-check.",
        url: null,
        rawStatus: null,
      };
    } else {
      try {
        platform = await checkRailwayServiceDeploy(deployProjectId);
      } catch (error) {
        platform = {
          provider: "railway",
          state: "unknown",
          detail:
            error instanceof Error
              ? error.message
              : "Railway status check failed",
          url: null,
          rawStatus: null,
        };
      }
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
  } else if (deployProjectId && !deployHost) {
    platform = {
      provider: "url",
      state: "unknown",
      detail:
        "Could not infer deploy host from the project id. Set Deploy host to vercel or railway.",
      url: null,
      rawStatus: null,
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
