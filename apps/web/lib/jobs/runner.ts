import { generateText } from "ai";
import { getJob, getProject, listJobs, updateJob } from "@/lib/db/queries";
import { createNotification } from "@/lib/db/notifications";
import { getChatModel, getPlanningModel, isChatConfigured } from "@/lib/chat/model";
import { isVisualContentChannel } from "@/lib/content/channels";
import { writeMessageContentPack } from "@/lib/content/pack";
import type { Job, JobKind, Project, TrustLevel } from "@/lib/db/schema";
import { jobNotePath, writeVaultNote, VaultError } from "@/lib/vault/notes";
import {
  createCloudAgent,
  CursorAgentError,
  firstBranchName,
  firstPrUrl,
  getCloudAgent,
  getCloudAgentRun,
  isCursorConfigured,
  isTerminalRunStatus,
} from "@/lib/cursor/agents";
import { getRepoSummary, parseGithubRepoUrl } from "@/lib/github/repo";
import {
  buildCodeAgentRequirements,
  looksLikeCodeIntent,
} from "@/lib/jobs/job-intent";
import {
  canLaunchCloudAgent,
  codeLaunchOptions,
  projectTrust,
  terminalStatusForSuccessfulJob,
  trustDenialMessage,
} from "@/lib/trust/policy";

/** Keep vault jobs visible in "In flight" long enough to notice. */
const MIN_RUNNING_MS = 8000;

function stubMarkdown(job: Job, project: Project) {
  return [
    `# ${job.title}`,
    "",
    `> Lane: **${project.name}** · Job \`${job.id}\` · ${job.kind}`,
    "",
    "## Brief",
    "",
    job.brief.trim() || "(no brief)",
    "",
    "## Draft",
    "",
    "Local runner stub — set `OPENAI_API_KEY` for a fuller drafted note.",
    "Edit this file in Obsidian and continue from here.",
    "",
    "---",
    `_Written by Jarvis job runner · ${new Date().toISOString()}_`,
    "",
  ].join("\n");
}

function buildDraftPrompt(job: Job, project: Project) {
  return [
    `Write an Obsidian markdown note for project lane "${project.name}".`,
    `Job title: ${job.title}`,
    `Job kind: ${job.kind}`,
    `Brief from the operator:`,
    job.brief.trim() || job.title,
    "",
    "Requirements:",
    "- Start with a single # heading matching the title",
    "- Be concrete and useful (plans, bullets, next actions, risks, open questions)",
    "- Structure with clear ## sections; end with a prioritized Next actions list",
    "- Do not invent external facts you were not given",
    "- Keep research/planning notes thorough but under ~1500 words",
    "- Output markdown only, no surrounding commentary",
  ].join("\n");
}

async function draftNoteMarkdown(job: Job, project: Project) {
  if (!isChatConfigured()) {
    return stubMarkdown(job, project);
  }

  const kind = job.kind as JobKind;
  const usePlanning = kind === "research" || kind === "ops";

  try {
    const { text } = await generateText({
      model: usePlanning ? getPlanningModel() : getChatModel(),
      temperature: 0.4,
      prompt: buildDraftPrompt(job, project),
    });
    const body = text.trim();
    if (!body) return stubMarkdown(job, project);
    const modelNote = usePlanning ? "planning model" : "chat model";
    return `${body}\n\n---\n_Written by Jarvis job runner (${modelNote}) · ${new Date().toISOString()}_\n`;
  } catch (error) {
    console.error("[jobs] draft generation failed", error);
    return stubMarkdown(job, project);
  }
}

async function writeJobArtifact(job: Job, project: Project) {
  if ((job.kind as JobKind) === "message") {
    return writeMessageContentPack(job, project);
  }

  if (!project.vaultPath) {
    return {
      ok: false as const,
      reason: `Project "${project.name}" has no vault path configured.`,
    };
  }

  try {
    const content = await draftNoteMarkdown(job, project);
    const notePath = jobNotePath(job.title);
    const note = writeVaultNote(project.vaultPath, notePath, content, {
      overwrite: true,
    });
    return {
      ok: true as const,
      path: note.path,
      title: note.title,
      mediaPath: null as string | null,
      contentCaption: null as string | null,
      mediaToken: null as string | null,
    };
  } catch (error) {
    const message =
      error instanceof VaultError
        ? error.message
        : error instanceof Error
          ? error.message
          : "Vault write failed";
    return { ok: false as const, reason: message };
  }
}

function autoCreatePr(trust?: TrustLevel | null) {
  const envAllows = (() => {
    const raw = process.env.CURSOR_AGENT_AUTO_PR?.trim().toLowerCase();
    if (raw === "0" || raw === "false" || raw === "no") return false;
    return true;
  })();
  return envAllows && codeLaunchOptions(trust).autoCreatePR;
}

function agentMode(job?: Pick<Job, "title" | "brief">): "agent" | "plan" {
  const raw = process.env.CURSOR_AGENT_MODE?.trim().toLowerCase();
  // Implementation briefs must not run in plan mode (that yields docs-only PRs).
  if (
    job &&
    looksLikeCodeIntent(`${job.title}\n${job.brief}`) &&
    raw === "plan"
  ) {
    return "agent";
  }
  return raw === "plan" ? "plan" : "agent";
}

async function resolveStartingRef(repoUrl: string) {
  const configured = process.env.CURSOR_AGENT_STARTING_REF?.trim();
  if (configured) return configured;
  try {
    const summary = await getRepoSummary(repoUrl);
    if (summary.defaultBranch?.trim()) return summary.defaultBranch.trim();
  } catch (error) {
    console.warn("[jobs] default branch lookup failed", error);
  }
  return "main";
}

function buildAgentPrompt(job: Job, project: Project) {
  const requirements = buildCodeAgentRequirements(job.title, job.brief);
  return [
    `You are working as a coding agent for the Jarvis command center.`,
    `Lane: ${project.name}`,
    project.goal?.trim() ? `Lane goal: ${project.goal.trim()}` : null,
    `Job title: ${job.title}`,
    `Job id: ${job.id}`,
    "",
    "Mission brief:",
    job.brief.trim() || job.title,
    "",
    ...requirements,
  ]
    .filter(Boolean)
    .join("\n");
}

async function needsYouJob(
  job: Job,
  summary: string,
  extras?: {
    artifactUrl?: string | null;
    mediaPath?: string | null;
    contentCaption?: string | null;
    mediaToken?: string | null;
  },
) {
  const updated = await updateJob(job.id, {
    status: "needs_you",
    summary,
    artifactUrl: extras?.artifactUrl,
    mediaPath: extras?.mediaPath,
    contentCaption: extras?.contentCaption,
    mediaToken: extras?.mediaToken,
  });
  await createNotification({
    title: `Needs you: ${job.title}`,
    body: summary,
    level: job.interruptLevel === "silent" ? "nudge" : job.interruptLevel,
    projectId: job.projectId,
    jobId: job.id,
  });
  return updated;
}

async function failJob(job: Job, summary: string) {
  const updated = await updateJob(job.id, {
    status: "failed",
    summary,
  });
  await createNotification({
    title: `Job failed: ${job.title}`,
    body: summary,
    level: "nudge",
    projectId: job.projectId,
    jobId: job.id,
  });
  return updated;
}

async function launchCodeAgent(job: Job) {
  const project = await getProject(job.projectId);
  const brief = job.brief.trim() || job.title;

  if (!project) {
    return failJob(job, `Code job failed — project ${job.projectId} is missing.`);
  }

  if (!canLaunchCloudAgent(project.trustLevel)) {
    return needsYouJob(
      job,
      trustDenialMessage(
        projectTrust(project),
        "launch Cloud Agent — promote lane trust to drafter+",
      ),
    );
  }

  if (!isCursorConfigured()) {
    return needsYouJob(
      job,
      `Set CURSOR_API_KEY in apps/web/.env.local (Cursor Dashboard → API Keys), then retry this code mission. Brief: ${brief}`,
    );
  }

  const parsed = parseGithubRepoUrl(project.repoUrl);
  if (!parsed) {
    return needsYouJob(
      job,
      `Lane "${project.name}" needs a GitHub repo URL (https://github.com/owner/repo) before a Cloud Agent can run. Brief: ${brief}`,
    );
  }

  try {
    const startingRef = await resolveStartingRef(parsed.url);
    const { agent, run } = await createCloudAgent({
      prompt: buildAgentPrompt(job, project),
      name: job.title,
      repoUrl: parsed.url,
      startingRef,
      autoCreatePR: autoCreatePr(project.trustLevel),
      mode: agentMode(job),
      modelId: process.env.CURSOR_AGENT_MODEL?.trim() || undefined,
    });

    const summary = `Cloud Agent launched (${run.status}). Open ${agent.url}`;
    return updateJob(job.id, {
      status: "running",
      summary,
      artifactUrl: agent.url,
      agentId: agent.id,
      agentRunId: run.id || agent.latestRunId,
    });
  } catch (error) {
    const message =
      error instanceof CursorAgentError
        ? error.message
        : error instanceof Error
          ? error.message
          : "Failed to launch Cloud Agent";
    console.error("[jobs] cloud agent launch failed", error);
    return needsYouJob(
      job,
      `Could not launch Cloud Agent: ${message}. Confirm the repo is connected in Cursor Integrations and CURSOR_API_KEY is valid. Brief: ${brief}`,
    );
  }
}

async function refreshCodeAgent(job: Job) {
  if (!job.agentId) {
    return launchCodeAgent(job);
  }

  if (!isCursorConfigured()) {
    return needsYouJob(
      job,
      `CURSOR_API_KEY missing while agent ${job.agentId} is in flight. Re-add the key to resume status polling.`,
      { artifactUrl: job.artifactUrl },
    );
  }

  try {
    const agent = await getCloudAgent(job.agentId);
    const runId = agent.latestRunId || job.agentRunId;
    if (!runId) {
      const summary = `Cloud Agent active but no run id yet. Open ${agent.url}`;
      if (summary === job.summary && agent.url === job.artifactUrl) {
        return job;
      }
      return updateJob(job.id, {
        status: "running",
        summary,
        artifactUrl: agent.url,
        agentRunId: null,
      });
    }

    const run = await getCloudAgentRun(job.agentId, runId);
    const prUrl = firstPrUrl(run);
    const branch = firstBranchName(run);
    const agentUrl = agent.url || job.artifactUrl;

    if (!isTerminalRunStatus(run.status)) {
      const summary = [
        `Cloud Agent ${run.status.toLowerCase()}`,
        branch ? `on ${branch}` : null,
        agentUrl ? `— ${agentUrl}` : null,
      ]
        .filter(Boolean)
        .join(" ");
      if (
        summary === job.summary &&
        (agentUrl ?? null) === (job.artifactUrl ?? null) &&
        runId === job.agentRunId
      ) {
        return job;
      }
      return updateJob(job.id, {
        status: "running",
        summary,
        artifactUrl: agentUrl,
        agentRunId: runId,
      });
    }

    if (run.status === "FINISHED") {
      const resultSnippet = run.result?.trim()
        ? run.result.trim().slice(0, 280)
        : "Agent finished.";
      const summary = [
        resultSnippet,
        prUrl ? `PR: ${prUrl}` : branch ? `Branch: ${branch}` : null,
        agentUrl && !prUrl ? `Agent: ${agentUrl}` : null,
      ]
        .filter(Boolean)
        .join(" ");
      const artifactUrl = prUrl || agentUrl;

      // Email-originated code jobs wait for operator Approve before reply.
      if (job.emailMessageId) {
        const emailSummary = [
          summary,
          `From ${job.emailFrom || "sender"}. Approve to email them that work is complete.`,
        ].join(" ");
        const updated = await updateJob(job.id, {
          status: "needs_you",
          summary: emailSummary,
          artifactUrl,
          agentRunId: runId,
        });
        await createNotification({
          title: `PR ready (email): ${job.title}`,
          body: emailSummary,
          level: job.interruptLevel === "silent" ? "nudge" : job.interruptLevel,
          projectId: job.projectId,
          jobId: job.id,
        });
        return updated;
      }

      const project = await getProject(job.projectId);
      const terminal = terminalStatusForSuccessfulJob({
        trust: project?.trustLevel,
        kind: "code",
        emailMessageId: job.emailMessageId,
      });
      const updated = await updateJob(job.id, {
        status: terminal,
        summary,
        artifactUrl,
        agentRunId: runId,
      });
      await createNotification({
        title:
          terminal === "needs_you"
            ? `Code ready (review): ${job.title}`
            : `Code done: ${job.title}`,
        body: summary,
        level: job.interruptLevel,
        projectId: job.projectId,
        jobId: job.id,
      });
      return updated;
    }

    const summary = [
      `Cloud Agent ${run.status.toLowerCase()}`,
      run.result?.trim() ? `— ${run.result.trim().slice(0, 200)}` : null,
      agentUrl ? `Open ${agentUrl}` : null,
    ]
      .filter(Boolean)
      .join(" ");

    if (run.status === "CANCELLED" || run.status === "EXPIRED") {
      return needsYouJob(job, summary, { artifactUrl: agentUrl });
    }

    return failJob(job, summary);
  } catch (error) {
    const message =
      error instanceof CursorAgentError
        ? error.message
        : error instanceof Error
          ? error.message
          : "Failed to poll Cloud Agent";
    console.error("[jobs] cloud agent poll failed", error);
    // Keep running — transient API blips should not kill the mission.
    const summary = `Cloud Agent poll error (will retry): ${message}`;
    if (summary === job.summary) return job;
    return updateJob(job.id, { status: "running", summary });
  }
}

async function finishVaultJob(job: Job) {
  const project = await getProject(job.projectId);
  const brief = job.brief.trim() || job.title;

  if (!project) {
    return failJob(
      job,
      `Job finished but project ${job.projectId} is missing.`,
    );
  }

  const artifact = await writeJobArtifact(job, project);

  if (!artifact.ok) {
    return needsYouJob(
      job,
      `Could not write Obsidian note: ${artifact.reason}. Brief was: ${brief}`,
    );
  }

  if ((job.kind as JobKind) === "message") {
    const channel = project.contentChannel?.trim() || "channel";
    const visual = isVisualContentChannel(channel);
    const bits = [
      `Draft ready for ${channel}.`,
      `Note \`${artifact.path}\`.`,
    ];
    if (artifact.mediaPath) {
      bits.push(`Image \`${artifact.mediaPath}\`.`);
    } else if (visual) {
      bits.push("No image generated.");
    }
    bits.push(
      visual
        ? "Copy caption + image (or Approve & publish when Instagram is configured)."
        : "Copy/post manually, then Approve/Resolve.",
    );
    return needsYouJob(job, bits.join(" "), {
      artifactUrl: artifact.path,
      mediaPath: artifact.mediaPath,
      contentCaption: artifact.contentCaption,
      mediaToken: artifact.mediaToken,
    });
  }

  const terminal = terminalStatusForSuccessfulJob({
    trust: project.trustLevel,
    kind: job.kind,
    emailMessageId: job.emailMessageId,
  });
  const summary = `Wrote Obsidian note \`${artifact.path}\`. Brief: ${brief}`;
  if (terminal === "needs_you") {
    return needsYouJob(job, summary, { artifactUrl: artifact.path });
  }
  const updated = await updateJob(job.id, {
    status: "done",
    summary,
    artifactUrl: artifact.path,
  });
  await createNotification({
    title: `Note ready: ${job.title}`,
    body: summary,
    level: job.interruptLevel,
    projectId: job.projectId,
    jobId: job.id,
  });
  return updated;
}

export type ProcessJobsResult = {
  claimed: string[];
  finished: string[];
  skipped: string[];
  updated: string[];
};

function claimSummary(job: Job) {
  if ((job.kind as JobKind) === "code") {
    return job.summary?.trim()
      ? job.summary
      : "Launching Cursor Cloud Agent…";
  }
  return job.summary?.trim()
    ? job.summary
    : "Worker claimed this mission — drafting into Obsidian…";
}

/**
 * Advance queued → running.
 * Code jobs launch/poll Cursor Cloud Agents.
 * Research/ops/message jobs write a markdown note after a short dwell.
 */
export async function processQueuedJobs(limit = 8): Promise<ProcessJobsResult> {
  const claimed: string[] = [];
  const finished: string[] = [];
  const skipped: string[] = [];
  const updated: string[] = [];

  const queued = await listJobs({ status: "queued" });
  for (const job of queued.slice(0, limit)) {
    try {
      await updateJob(job.id, {
        status: "running",
        summary: claimSummary(job),
      });
      claimed.push(job.id);
    } catch (error) {
      console.error("[jobs] claim failed", job.id, error);
      skipped.push(job.id);
    }
  }

  const running = await listJobs({ status: "running" });
  const now = Date.now();
  for (const job of running) {
    try {
      if ((job.kind as JobKind) === "code") {
        const before = job;
        const after = await refreshCodeAgent(job);
        if (!after) continue;
        if (after.status !== "running") {
          finished.push(job.id);
        } else if (
          after.summary !== before.summary ||
          after.artifactUrl !== before.artifactUrl ||
          after.agentId !== before.agentId ||
          after.agentRunId !== before.agentRunId
        ) {
          updated.push(job.id);
        } else {
          skipped.push(job.id);
        }
        continue;
      }

      const updatedAt =
        job.updatedAt instanceof Date
          ? job.updatedAt.getTime()
          : new Date(job.updatedAt).getTime();
      if (now - updatedAt < MIN_RUNNING_MS) {
        skipped.push(job.id);
        continue;
      }
      await finishVaultJob(job);
      finished.push(job.id);
    } catch (error) {
      console.error("[jobs] process running failed", job.id, error);
      skipped.push(job.id);
    }
  }

  return { claimed, finished, skipped, updated };
}

/** Claim one job immediately (used right after create). */
export async function kickJob(jobId: string) {
  const job = await getJob(jobId);
  if (!job) return null;
  if (job.status === "queued") {
    const claimed = await updateJob(job.id, {
      status: "running",
      summary: claimSummary(job),
    });
    if (!claimed) return null;
    if ((claimed.kind as JobKind) === "code") {
      return refreshCodeAgent(claimed);
    }
    return claimed;
  }
  if (job.status === "running" && (job.kind as JobKind) === "code") {
    return refreshCodeAgent(job);
  }
  return job;
}
