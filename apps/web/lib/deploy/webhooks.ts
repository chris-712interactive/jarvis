import crypto from "node:crypto";
import { createNotification } from "@/lib/db/notifications";
import { getProject, listProjects, updateProject } from "@/lib/db/queries";
import type { DeployStatus, Project } from "@/lib/db/schema";
import { refreshProjectDeployStatus } from "@/lib/jobs/deploy-watchdog";

export function deployWebhookSecret() {
  return (
    process.env.DEPLOY_WEBHOOK_SECRET?.trim() ||
    process.env.CRON_SECRET?.trim() ||
    ""
  );
}

/** Shared secret for Railway (and optional manual) webhook URLs. */
export function authorizeDeployWebhook(request: Request): boolean {
  const secret = deployWebhookSecret();
  if (!secret) {
    return process.env.NODE_ENV !== "production";
  }
  const header = request.headers.get("authorization")?.trim();
  if (header === `Bearer ${secret}`) return true;
  const url = new URL(request.url);
  if (url.searchParams.get("secret") === secret) return true;
  return false;
}

/** Vercel account webhooks: HMAC-SHA1 of raw body in x-vercel-signature. */
export function verifyVercelSignature(
  rawBody: string,
  signatureHeader: string | null,
): boolean {
  const secret = process.env.VERCEL_WEBHOOK_SECRET?.trim();
  if (!secret || !signatureHeader) return false;
  const expected = crypto
    .createHmac("sha1", secret)
    .update(rawBody)
    .digest("hex");
  try {
    const a = Buffer.from(signatureHeader);
    const b = Buffer.from(expected);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function idsEqual(a: string | null | undefined, b: string | null | undefined) {
  if (!a?.trim() || !b?.trim()) return false;
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

export async function findLanesForDeployEvent(input: {
  host: "vercel" | "railway";
  externalIds: Array<string | null | undefined>;
  names?: Array<string | null | undefined>;
}) {
  const projects = await listProjects("active");
  const ids = input.externalIds
    .map((value) => value?.trim())
    .filter(Boolean) as string[];
  const names = (input.names ?? [])
    .map((value) => value?.trim().toLowerCase())
    .filter(Boolean) as string[];

  return projects.filter((project) => {
    const configuredId = project.deployProjectId?.trim();
    if (!configuredId && names.length === 0) return false;

    if (configuredId && ids.some((id) => idsEqual(id, configuredId))) {
      return true;
    }
    if (names.length > 0) {
      const laneName = project.name.trim().toLowerCase();
      if (names.includes(laneName)) return true;
      if (configuredId && names.includes(configuredId.toLowerCase())) {
        return true;
      }
    }
    return false;
  });
}

function mapVercelEventType(type: string): DeployStatus | null {
  switch (type) {
    case "deployment.succeeded":
      return "ok";
    case "deployment.error":
    case "deployment.canceled":
      return "down";
    case "deployment.created":
    case "deployment.promoted":
      return "building";
    default:
      return null;
  }
}

function mapRailwayEventType(type: string, status?: string): DeployStatus | null {
  const normalized = `${type} ${status || ""}`.toLowerCase();
  if (/success|succeeded|ready/.test(normalized)) return "ok";
  if (/fail|crash|error|removed/.test(normalized)) return "down";
  if (/build|deploy|initializ|waiting|queued/.test(normalized)) {
    return "building";
  }
  return null;
}

async function notifyIfUnhealthy(
  project: Project,
  status: DeployStatus,
  detail: string,
) {
  if (status !== "down" && status !== "degraded") return;
  await createNotification({
    title: `Deploy ${status}: ${project.name}`,
    body: [
      `Lane: ${project.name}`,
      `Status: ${status}`,
      project.productionUrl ? `URL: ${project.productionUrl}` : null,
      detail,
      "Source: deploy webhook",
    ]
      .filter(Boolean)
      .join("\n"),
    level: "nudge",
    projectId: project.id,
  });
}

/** Apply webhook hint, then live-refresh when tokens allow. */
export async function applyDeployWebhookToLanes(input: {
  lanes: Project[];
  statusHint: DeployStatus;
  detail: string;
}) {
  const results: Array<{
    projectId: string;
    projectName: string;
    status: DeployStatus;
    detail: string;
  }> = [];

  for (const lane of input.lanes) {
    await updateProject(lane.id, {
      deployStatus: input.statusHint,
      deployStatusDetail: input.detail.slice(0, 2000),
      deployCheckedAt: new Date(),
    });

    let status = input.statusHint;
    let detail = input.detail;
    const fresh = await getProject(lane.id);
    if (fresh) {
      try {
        const snapshot = await refreshProjectDeployStatus(fresh);
        status = snapshot.status;
        detail = snapshot.detail;
      } catch (error) {
        console.warn(
          "[deploy-webhook] refresh after hint failed",
          lane.name,
          error,
        );
      }
      await notifyIfUnhealthy(fresh, status, detail);
    }

    results.push({
      projectId: lane.id,
      projectName: lane.name,
      status,
      detail,
    });
  }

  return results;
}

export function parseVercelWebhook(body: unknown): {
  type: string;
  statusHint: DeployStatus;
  detail: string;
  externalIds: string[];
  names: string[];
  productionTarget: boolean;
} | null {
  if (!body || typeof body !== "object") return null;
  const event = body as {
    type?: string;
    payload?: {
      deployment?: {
        id?: string;
        url?: string;
        name?: string;
        projectId?: string;
        target?: string | null;
        readyState?: string;
      };
      project?: { id?: string; name?: string };
    };
  };

  const type = event.type?.trim() || "";
  const statusHint = mapVercelEventType(type);
  if (!statusHint) return null;

  const deployment = event.payload?.deployment;
  const project = event.payload?.project;
  const target = deployment?.target ?? null;
  const productionTarget = !target || target === "production";

  const externalIds = [
    project?.id,
    deployment?.projectId,
    deployment?.name,
    project?.name,
  ].filter(Boolean) as string[];
  const names = [project?.name, deployment?.name].filter(Boolean) as string[];
  const url = deployment?.url ? `https://${deployment.url}` : null;
  const detail = [
    `Vercel ${type}`,
    deployment?.readyState ? `state ${deployment.readyState}` : null,
    url,
  ]
    .filter(Boolean)
    .join(" · ");

  return {
    type,
    statusHint,
    detail,
    externalIds,
    names,
    productionTarget,
  };
}

export function parseRailwayWebhook(body: unknown): {
  type: string;
  statusHint: DeployStatus;
  detail: string;
  externalIds: string[];
  names: string[];
} | null {
  if (!body || typeof body !== "object") return null;
  const event = body as {
    type?: string;
    details?: { status?: string; id?: string };
    resource?: {
      project?: { id?: string; name?: string };
      service?: { id?: string; name?: string };
      environment?: { name?: string; isEphemeral?: boolean };
    };
  };

  const type = event.type?.trim() || "";
  const status = event.details?.status;
  const statusHint = mapRailwayEventType(type, status);
  if (!statusHint) return null;
  if (event.resource?.environment?.isEphemeral) return null;

  const externalIds = [
    event.resource?.project?.id,
    event.resource?.service?.id,
  ].filter(Boolean) as string[];
  const names = [
    event.resource?.project?.name,
    event.resource?.service?.name,
  ].filter(Boolean) as string[];

  const detail = [
    `Railway ${type}`,
    status ? `status ${status}` : null,
    event.resource?.service?.name
      ? `service ${event.resource.service.name}`
      : null,
    event.resource?.environment?.name
      ? `env ${event.resource.environment.name}`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return { type, statusHint, detail, externalIds, names };
}
