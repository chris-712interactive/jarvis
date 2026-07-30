/**
 * Cursor Cloud Agents API v1 client.
 * Docs: https://cursor.com/docs/cloud-agent/api/endpoints
 */

const API_BASE = "https://api.cursor.com/v1";

export class CursorAgentError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "CursorAgentError";
    this.status = status;
  }
}

export type CursorRunStatus =
  | "CREATING"
  | "RUNNING"
  | "FINISHED"
  | "ERROR"
  | "CANCELLED"
  | "EXPIRED";

export type CursorAgent = {
  id: string;
  name: string;
  status: string;
  url: string;
  latestRunId: string | null;
  autoCreatePR?: boolean;
};

export type CursorRun = {
  id: string;
  agentId: string;
  status: CursorRunStatus;
  result?: string | null;
  durationMs?: number | null;
  git?: {
    branches?: Array<{
      repoUrl?: string;
      branch?: string;
      prUrl?: string;
    }>;
  } | null;
};

export type CreateAgentInput = {
  prompt: string;
  name?: string;
  repoUrl: string;
  startingRef?: string;
  autoCreatePR?: boolean;
  mode?: "agent" | "plan";
  modelId?: string;
};

export function isCursorConfigured() {
  return Boolean(process.env.CURSOR_API_KEY?.trim());
}

function apiKey() {
  const key = process.env.CURSOR_API_KEY?.trim();
  if (!key) {
    throw new CursorAgentError(
      "CURSOR_API_KEY is not set. Create one at Cursor Dashboard → API Keys.",
      503,
    );
  }
  return key;
}

function authHeader() {
  const encoded = Buffer.from(`${apiKey()}:`).toString("base64");
  return `Basic ${encoded}`;
}

async function cursorFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: authHeader(),
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
    cache: "no-store",
  });

  if (!res.ok) {
    let detail = res.statusText || "Cursor API request failed";
    try {
      const body = (await res.json()) as {
        message?: string;
        error?: string | { message?: string };
      };
      if (typeof body.message === "string" && body.message.trim()) {
        detail = body.message;
      } else if (typeof body.error === "string" && body.error.trim()) {
        detail = body.error;
      } else if (
        body.error &&
        typeof body.error === "object" &&
        typeof body.error.message === "string"
      ) {
        detail = body.error.message;
      }
    } catch {
      // keep statusText
    }
    throw new CursorAgentError(detail, res.status);
  }

  return (await res.json()) as T;
}

export function agentDashboardUrl(agentId: string) {
  return `https://cursor.com/agents/${agentId}`;
}

export async function createCloudAgent(input: CreateAgentInput): Promise<{
  agent: CursorAgent;
  run: CursorRun;
}> {
  const body: Record<string, unknown> = {
    prompt: { text: input.prompt },
    name: input.name?.slice(0, 100),
    repos: [
      {
        url: input.repoUrl,
        ...(input.startingRef ? { startingRef: input.startingRef } : {}),
      },
    ],
    autoCreatePR: input.autoCreatePR ?? true,
    mode: input.mode ?? "agent",
  };

  if (input.modelId?.trim()) {
    body.model = { id: input.modelId.trim() };
  }

  const data = await cursorFetch<{ agent: CursorAgent; run: CursorRun }>(
    "/agents",
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );

  return {
    agent: {
      ...data.agent,
      url: data.agent.url || agentDashboardUrl(data.agent.id),
      latestRunId: data.agent.latestRunId ?? data.run?.id ?? null,
    },
    run: data.run,
  };
}

export async function getCloudAgent(agentId: string): Promise<CursorAgent> {
  const data = await cursorFetch<CursorAgent>(
    `/agents/${encodeURIComponent(agentId)}`,
  );
  return {
    ...data,
    url: data.url || agentDashboardUrl(data.id),
  };
}

export async function getCloudAgentRun(
  agentId: string,
  runId: string,
): Promise<CursorRun> {
  return cursorFetch<CursorRun>(
    `/agents/${encodeURIComponent(agentId)}/runs/${encodeURIComponent(runId)}`,
  );
}

export function isTerminalRunStatus(status: string | null | undefined) {
  return (
    status === "FINISHED" ||
    status === "ERROR" ||
    status === "CANCELLED" ||
    status === "EXPIRED"
  );
}

export function firstPrUrl(run: CursorRun): string | null {
  const branches = run.git?.branches ?? [];
  for (const branch of branches) {
    if (branch.prUrl?.trim()) return branch.prUrl.trim();
  }
  return null;
}

export function firstBranchName(run: CursorRun): string | null {
  const branches = run.git?.branches ?? [];
  for (const branch of branches) {
    if (branch.branch?.trim()) return branch.branch.trim();
  }
  return null;
}
