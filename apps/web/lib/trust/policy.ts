import type { Job, JobKind, Project, TrustLevel } from "@/lib/db/schema";

export const TRUST_LEVEL_ORDER: TrustLevel[] = [
  "observer",
  "drafter",
  "operator",
  "autopilot",
];

export function normalizeTrustLevel(
  raw: string | null | undefined,
): TrustLevel {
  const value = raw?.trim().toLowerCase();
  if (
    value === "observer" ||
    value === "drafter" ||
    value === "operator" ||
    value === "autopilot"
  ) {
    return value;
  }
  return "operator";
}

export function trustAtLeast(
  actual: TrustLevel | null | undefined,
  required: TrustLevel,
) {
  const a = TRUST_LEVEL_ORDER.indexOf(normalizeTrustLevel(actual));
  const b = TRUST_LEVEL_ORDER.indexOf(required);
  return a >= b;
}

export function trustLabel(level: TrustLevel) {
  switch (level) {
    case "observer":
      return "Observer (read-only)";
    case "drafter":
      return "Drafter (drafts only — Needs you before publish)";
    case "operator":
      return "Operator (approve-gated sends / PRs)";
    case "autopilot":
      return "Autopilot (narrow auto-resolve for safe successes)";
  }
}

/** Mutating chat tools and what trust they require. */
export function canUseMutatingTool(
  trust: TrustLevel | null | undefined,
  toolName: string,
): { ok: true } | { ok: false; error: string } {
  const level = normalizeTrustLevel(trust);

  const readOnly = new Set([
    "get_dashboard_status",
    "list_projects",
    "resolve_lane",
    "get_project",
    "list_jobs",
    "get_job",
    "list_vault_notes",
    "search_vault_notes",
    "read_vault_note",
    "get_repo_summary",
    "list_open_prs",
    "get_lane_analytics",
    "get_lane_search",
    "get_lane_deploy",
    "get_briefing",
    "check_pr_ci",
    "check_deploy_health",
  ]);

  if (readOnly.has(toolName)) return { ok: true };

  if (level === "observer") {
    return {
      ok: false,
      error: `Lane trust is observer (read-only). Promote trustLevel to drafter+ to use ${toolName}.`,
    };
  }

  // Soft writes / drafts
  const drafterOk = new Set([
    "write_vault_note",
    "start_job",
    "draft_daily_post",
    "ingest_emails",
    "run_briefing",
    "clear_needs_you",
    "resolve_job",
  ]);

  if (drafterOk.has(toolName)) {
    if (!trustAtLeast(level, "drafter")) {
      return {
        ok: false,
        error: `Lane trust is ${level}; ${toolName} needs drafter+.`,
      };
    }
    return { ok: true };
  }

  return { ok: true };
}

export function canStartJobKind(
  trust: TrustLevel | null | undefined,
  kind: JobKind,
): { ok: true } | { ok: false; error: string } {
  const level = normalizeTrustLevel(trust);
  if (level === "observer") {
    return {
      ok: false,
      error:
        "Lane trust is observer — cannot start jobs. Promote to drafter+ on the project form.",
    };
  }
  if (kind === "code" && !trustAtLeast(level, "drafter")) {
    return {
      ok: false,
      error: `Lane trust is ${level}; code jobs need drafter+.`,
    };
  }
  return { ok: true };
}

export function canWriteVaultNote(trust: TrustLevel | null | undefined) {
  return trustAtLeast(trust, "drafter");
}

export function canQueueDailyContent(trust: TrustLevel | null | undefined) {
  return trustAtLeast(trust, "drafter");
}

export function canIngestEmailCodeJobs(trust: TrustLevel | null | undefined) {
  return trustAtLeast(trust, "drafter");
}

/** Drafter may draft replies; only operator+ may send. */
export function canSendEmailReply(trust: TrustLevel | null | undefined) {
  return trustAtLeast(trust, "operator");
}

export function canLaunchCloudAgent(trust: TrustLevel | null | undefined) {
  return trustAtLeast(trust, "drafter");
}

/** Cloud Agent launch knobs by trust. */
export function codeLaunchOptions(trust: TrustLevel | null | undefined): {
  autoCreatePR: boolean;
  forceNeedsYouOnFinish: boolean;
} {
  const level = normalizeTrustLevel(trust);
  if (level === "drafter") {
    return { autoCreatePR: false, forceNeedsYouOnFinish: true };
  }
  // operator + autopilot: open PRs; finish done unless email-originated
  return { autoCreatePR: true, forceNeedsYouOnFinish: false };
}

/**
 * Terminal status after a successful worker run.
 * Message jobs always need_you (approve-before-post) until a publish channel exists.
 */
export function terminalStatusForSuccessfulJob(input: {
  trust: TrustLevel | null | undefined;
  kind: JobKind;
  emailMessageId?: string | null;
}): "done" | "needs_you" {
  const level = normalizeTrustLevel(input.trust);
  if (input.kind === "message") return "needs_you";
  if (input.emailMessageId) return "needs_you";
  if (input.kind === "code") {
    return codeLaunchOptions(level).forceNeedsYouOnFinish
      ? "needs_you"
      : "done";
  }
  // research / ops
  return "done";
}

/** Narrow autopilot: auto-resolve successful non-email code jobs only. */
export function canAutoResolveCodeSuccess(
  trust: TrustLevel | null | undefined,
  job: Pick<Job, "kind" | "emailMessageId" | "status">,
) {
  if (normalizeTrustLevel(trust) !== "autopilot") return false;
  if (job.kind !== "code") return false;
  if (job.emailMessageId) return false;
  return job.status === "needs_you" || job.status === "done";
}

export function projectTrust(project: Pick<Project, "trustLevel"> | null | undefined) {
  return normalizeTrustLevel(project?.trustLevel);
}

export function trustDenialMessage(level: TrustLevel, action: string) {
  return `Blocked by trust budget (${level}): ${action}. Edit the lane trustLevel to promote.`;
}
