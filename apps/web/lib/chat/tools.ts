import { tool } from "ai";
import { z } from "zod";
import {
  createJob,
  getDashboardData,
  getJob,
  getProject,
  listJobs,
  listProjects,
  updateJob,
  updateProject,
} from "@/lib/db/queries";
import { kickJob } from "@/lib/jobs/runner";
import { resolveJobWithSideEffects } from "@/lib/jobs/resolve";
import { ingestInboundEmails } from "@/lib/jobs/email-ingest";
import { resolveLane } from "@/lib/chat/resolve-lane";
import { isGmailConfigured } from "@/lib/gmail/client";
import {
  listVaultNotes,
  readVaultNote,
  searchVaultNotes,
  writeVaultNote,
  VaultError,
} from "@/lib/vault/notes";
import {
  getRepoSummary,
  listOpenPullRequests,
  GitHubError,
} from "@/lib/github/repo";
import {
  Ga4Error,
  getPropertySummary,
  isGa4Configured,
} from "@/lib/analytics/ga4";
import {
  GscError,
  getSearchConsoleSummary,
  isGscConfigured,
} from "@/lib/analytics/gsc";
import { generateLaneRecommendations } from "@/lib/analytics/recommendations";
import { queueDailyContentDrafts } from "@/lib/jobs/daily-content";
import {
  enrichCodeBriefWithGsc,
  resolveJobKind,
} from "@/lib/jobs/job-intent";
import {
  generateBriefing,
  getLatestBriefing,
} from "@/lib/briefing/generate";
import {
  generateWeeklyReview,
  getLatestWeeklyReview,
} from "@/lib/briefing/weekly-review";
import { runPrWatchdog } from "@/lib/jobs/pr-watchdog";
import {
  refreshProjectDeployStatus,
  runDeployWatchdog,
} from "@/lib/jobs/deploy-watchdog";
import { jobKinds, interruptLevels } from "@/lib/db/schema";
import {
  canQueueDailyContent,
  canStartJobKind,
  canUseMutatingTool,
  canWriteVaultNote,
  projectTrust,
  trustDenialMessage,
} from "@/lib/trust/policy";

function vaultErrorMessage(error: unknown) {
  if (error instanceof VaultError) return error.message;
  if (error instanceof Error) return error.message;
  return "Vault read failed";
}

function githubErrorMessage(error: unknown) {
  if (error instanceof GitHubError) return error.message;
  if (error instanceof Error) return error.message;
  return "GitHub request failed";
}

function ga4ErrorMessage(error: unknown) {
  if (error instanceof Ga4Error) return error.message;
  if (error instanceof Error) return error.message;
  return "GA4 request failed";
}

function gscErrorMessage(error: unknown) {
  if (error instanceof GscError) return error.message;
  if (error instanceof Error) return error.message;
  return "Search Console request failed";
}

const laneFields = {
  lane: z
    .string()
    .optional()
    .describe(
      "Lane name/slug the user said (e.g. ForgeRep, Carline Dad). Prefer this over the UI dropdown whenever they named a lane.",
    ),
  projectId: z
    .string()
    .optional()
    .describe("Exact project id when already known. Optional if lane is set."),
};

export function createOperatorTools(activeProjectId?: string | null) {
  return {
    get_dashboard_status: tool({
      description:
        "Get command-center status: priority items, in-flight jobs, and active project lanes.",
      inputSchema: z.object({}),
      execute: async () => {
        const data = await getDashboardData();
        return {
          counts: data.counts,
          needsYou: {
            projects: data.needsYou.projects.map((p) => ({
              id: p.id,
              name: p.name,
              needsYou: p.needsYou,
            })),
            jobs: data.needsYou.jobs.map((j) => ({
              id: j.id,
              title: j.title,
              status: j.status,
              summary: j.summary,
              project: j.project?.name ?? null,
            })),
          },
          inFlight: data.inFlight.map((j) => ({
            id: j.id,
            title: j.title,
            status: j.status,
            summary: j.summary,
            project: j.project?.name ?? null,
          })),
          projects: data.projects.map((p) => ({
            id: p.id,
            name: p.name,
            status: p.status,
            goal: p.goal,
            needsYou: p.needsYou,
          })),
        };
      },
    }),

    list_projects: tool({
      description: "List project lanes with goals, status, and vault configuration.",
      inputSchema: z.object({
        includeArchived: z
          .boolean()
          .optional()
          .describe("Include archived projects. Defaults to false."),
      }),
      execute: async ({ includeArchived }) => {
        const projects = await listProjects();
        return projects
          .filter((p) => includeArchived || p.status !== "archived")
          .map((p) => ({
            id: p.id,
            name: p.name,
            slug: p.slug,
            status: p.status,
            goal: p.goal,
            repoUrl: p.repoUrl,
            vaultPath: p.vaultPath,
            gaPropertyId: p.gaPropertyId,
            gscSiteUrl: p.gscSiteUrl,
            productionUrl: p.productionUrl,
            deployHost: p.deployHost,
            deployProjectId: p.deployProjectId,
            deployStatus: p.deployStatus,
            deployStatusDetail: p.deployStatusDetail,
            deployCheckedAt: p.deployCheckedAt,
            contentChannel: p.contentChannel,
            instagramUserId: p.instagramUserId,
            dailyContent: p.dailyContent,
            emailSenders: p.emailSenders,
            needsYou: p.needsYou,
            interruptLevel: p.interruptLevel,
            trustLevel: p.trustLevel,
            notes: p.notes,
          }));
      },
    }),

    resolve_lane: tool({
      description:
        "Resolve a spoken/typed lane name (ForgeRep, Carline Dad, …) to a project id before starting work.",
      inputSchema: z.object({
        lane: z.string().min(1).describe("Lane name or nickname from the user"),
      }),
      execute: async ({ lane }) => {
        const resolved = await resolveLane({ lane });
        if (!resolved.ok) {
          return {
            error: resolved.error,
            candidates: resolved.candidates ?? null,
          };
        }
        return {
          matchedBy: resolved.matchedBy,
          project: {
            id: resolved.project.id,
            name: resolved.project.name,
            slug: resolved.project.slug,
            vaultPath: resolved.project.vaultPath,
            status: resolved.project.status,
          },
        };
      },
    }),

    get_project: tool({
      description:
        "Get one project lane by id or lane name. Falls back to the UI dropdown only when neither is provided.",
      inputSchema: z.object(laneFields),
      execute: async ({ projectId, lane }) => {
        const resolved = await resolveLane({
          projectId,
          lane,
          fallbackProjectId: activeProjectId,
        });
        if (!resolved.ok) {
          return {
            error: resolved.error,
            candidates: resolved.candidates ?? null,
          };
        }
        const project = resolved.project;
        const jobs = await listJobs({ projectId: project.id });
        return {
          matchedBy: resolved.matchedBy,
          project: {
            id: project.id,
            name: project.name,
            slug: project.slug,
            status: project.status,
            goal: project.goal,
            repoUrl: project.repoUrl,
            vaultPath: project.vaultPath,
            gaPropertyId: project.gaPropertyId,
            gscSiteUrl: project.gscSiteUrl,
            productionUrl: project.productionUrl,
            deployHost: project.deployHost,
            deployProjectId: project.deployProjectId,
            deployStatus: project.deployStatus,
            deployStatusDetail: project.deployStatusDetail,
            deployCheckedAt: project.deployCheckedAt,
            contentChannel: project.contentChannel,
            instagramUserId: project.instagramUserId,
            contentBrief: project.contentBrief,
            dailyContent: project.dailyContent,
            emailSenders: project.emailSenders,
            needsYou: project.needsYou,
            interruptLevel: project.interruptLevel,
            trustLevel: project.trustLevel,
            notes: project.notes,
          },
          jobs: jobs.map((j) => ({
            id: j.id,
            title: j.title,
            kind: j.kind,
            status: j.status,
            summary: j.summary,
            brief: j.brief,
          })),
        };
      },
    }),

    list_jobs: tool({
      description:
        "List jobs, optionally filtered by lane name/id and/or status (queued, running, needs_you, done, failed).",
      inputSchema: z.object({
        ...laneFields,
        status: z
          .enum(["queued", "running", "needs_you", "done", "failed"])
          .optional(),
      }),
      execute: async ({ projectId, lane, status }) => {
        let scopedProjectId: string | undefined;
        if (projectId || lane || activeProjectId) {
          const resolved = await resolveLane({
            projectId,
            lane,
            fallbackProjectId: activeProjectId,
          });
          if (!resolved.ok) {
            return {
              error: resolved.error,
              candidates: resolved.candidates ?? null,
            };
          }
          scopedProjectId = resolved.project.id;
        }

        const jobs = await listJobs({
          projectId: scopedProjectId,
          status,
        });
        const projects = await listProjects();
        const byId = new Map(projects.map((p) => [p.id, p.name]));
        return jobs.map((j) => ({
          id: j.id,
          title: j.title,
          kind: j.kind,
          status: j.status,
          summary: j.summary,
          brief: j.brief,
          projectId: j.projectId,
          projectName: byId.get(j.projectId) ?? null,
          updatedAt: j.updatedAt,
        }));
      },
    }),

    get_job: tool({
      description: "Get one job by id, including brief and latest status.",
      inputSchema: z.object({
        jobId: z.string().describe("Job id to inspect"),
      }),
      execute: async ({ jobId }) => {
        const job = await getJob(jobId);
        if (!job) return { error: "Job not found" };
        const project = await getProject(job.projectId);
        return {
          job: {
            id: job.id,
            title: job.title,
            kind: job.kind,
            status: job.status,
            summary: job.summary,
            brief: job.brief,
            interruptLevel: job.interruptLevel,
            artifactUrl: job.artifactUrl,
            agentId: job.agentId,
            agentRunId: job.agentRunId,
            updatedAt: job.updatedAt,
          },
          project: project
            ? {
                id: project.id,
                name: project.name,
                repoUrl: project.repoUrl,
              }
            : null,
        };
      },
    }),

    resolve_job: tool({
      description:
        "Mark a priority job as approved/done so it leaves Needs you. For email drafts, pass replyDraft to edit the reply before send. For Instagram packs with API configured, Approve publishes via Graph API (see contentPublish in the result). Prefer jobId from list_jobs / get_dashboard_status; title match is a fallback.",
      inputSchema: z.object({
        jobId: z.string().optional().describe("Exact job id when known"),
        title: z
          .string()
          .optional()
          .describe("Job title to match if id is unknown"),
        note: z
          .string()
          .optional()
          .describe("Optional resolution note saved on the job summary"),
        replyDraft: z
          .string()
          .max(20_000)
          .optional()
          .describe(
            "Edited email reply body to send on approve. Omit to keep the stored draft / code completion template.",
          ),
      }),
      execute: async ({ jobId, title, note, replyDraft }) => {
        let job = jobId ? await getJob(jobId) : null;
        if (!job && title?.trim()) {
          const needle = title.trim().toLowerCase();
          const open = await listJobs({ status: ["needs_you", "failed"] });
          const matches = open.filter((j) =>
            j.title.toLowerCase().includes(needle),
          );
          if (matches.length === 1) job = matches[0];
          else if (matches.length > 1) {
            return {
              error: "Multiple matching priority jobs. Pass jobId.",
              candidates: matches.map((j) => ({
                id: j.id,
                title: j.title,
                status: j.status,
              })),
            };
          }
        }
        if (!job) {
          return {
            error:
              "Job not found. Use get_dashboard_status or list_jobs with status needs_you.",
          };
        }

        const project = await getProject(job.projectId);
        const mutate = canUseMutatingTool(project?.trustLevel, "resolve_job");
        if (!mutate.ok) return { error: mutate.error };

        const summary =
          note?.trim() ||
          `Approved / resolved by operator. (${job.title})`;
        const resolved = await resolveJobWithSideEffects(job.id, {
          note: summary,
          replyDraft,
        });
        return {
          resolved: true,
          job: resolved
            ? {
                id: resolved.job.id,
                title: resolved.job.title,
                status: resolved.job.status,
                summary: resolved.job.summary,
                emailFrom: resolved.job.emailFrom,
                emailReplySent: resolved.job.emailReplySent,
                mediaPath: resolved.job.mediaPath,
                contentPublished: resolved.job.contentPublished,
              }
            : null,
          emailReply: resolved?.emailReply ?? null,
          contentPublish: resolved?.contentPublish ?? null,
          trustLevel: project ? projectTrust(project) : null,
        };
      },
    }),

    clear_needs_you: tool({
      description:
        "Clear a project lane's Needs you flag so the project alert leaves Priority. Pass lane name when the user names one.",
      inputSchema: z.object({
        ...laneFields,
      }),
      execute: async ({ projectId, lane }) => {
        const resolved = await resolveLane({
          projectId,
          lane,
          fallbackProjectId: activeProjectId,
        });
        if (!resolved.ok) {
          return {
            error: resolved.error,
            candidates: resolved.candidates ?? null,
          };
        }
        const mutate = canUseMutatingTool(
          resolved.project.trustLevel,
          "clear_needs_you",
        );
        if (!mutate.ok) return { error: mutate.error };
        const updated = await updateProject(resolved.project.id, {
          needsYou: null,
        });
        return {
          cleared: true,
          project: updated
            ? {
                id: updated.id,
                name: updated.name,
                needsYou: updated.needsYou,
              }
            : null,
        };
      },
    }),

    start_job: tool({
      description:
        "Start an async background job for a project lane. When the user names a lane, pass it as `lane` — do not rely on the UI dropdown. Use kind `code` for implement/fix/PR/SEO site updates — that launches a Cursor Cloud Agent when CURSOR_API_KEY and a GitHub repo URL are set. kind `research`/`ops` only write Obsidian markdown notes (never site changes). For \"plan and implement SEO\", use kind `code` and put the plan + Search Console highlights in the brief.",
      inputSchema: z.object({
        title: z.string().min(1).max(200).describe("Short job title"),
        brief: z
          .string()
          .min(1)
          .max(8000)
          .describe(
            "What the worker should accomplish. For SEO code jobs, include concrete on-site targets (pages/meta/queries) from get_lane_search — not a docs-only plan.",
          ),
        kind: z
          .enum(jobKinds)
          .optional()
          .describe(
            "code (Cloud Agent PR) | research | ops | message. Defaults to ops. MUST be code for implement/fix/PR/SEO site updates. research/ops = vault notes only.",
          ),
        ...laneFields,
        interruptLevel: z
          .enum(interruptLevels)
          .optional()
          .describe("How loudly to notify on completion. Defaults to digest."),
      }),
      execute: async ({
        title,
        brief,
        kind,
        projectId,
        lane,
        interruptLevel,
      }) => {
        const resolved = await resolveLane({
          projectId,
          lane,
          fallbackProjectId: activeProjectId,
        });
        if (!resolved.ok) {
          return {
            error: resolved.error,
            candidates: resolved.candidates ?? null,
          };
        }
        const project = resolved.project;
        const mutate = canUseMutatingTool(project.trustLevel, "start_job");
        if (!mutate.ok) return { error: mutate.error };

        const resolvedKind = resolveJobKind({ kind, title, brief });
        const kindGate = canStartJobKind(project.trustLevel, resolvedKind.kind);
        if (!kindGate.ok) return { error: kindGate.error };

        let finalBrief = brief;
        let gscEnriched = false;
        if (resolvedKind.kind === "code") {
          const enriched = await enrichCodeBriefWithGsc({
            project,
            title,
            brief,
          });
          finalBrief = enriched.brief;
          gscEnriched = enriched.enriched;
        }

        const job = await createJob({
          projectId: project.id,
          title,
          brief: finalBrief,
          kind: resolvedKind.kind,
          status: "queued",
          summary: "Queued for background worker.",
          interruptLevel: interruptLevel ?? project.interruptLevel ?? "digest",
        });

        const claimed = await kickJob(job.id);

        const active = claimed ?? job;
        const codeNote = (() => {
          if (active.kind !== "code") return null;
          if (active.agentId && active.artifactUrl) {
            return `Cloud Agent launched for lane "${project.name}". Track it under In flight and at ${active.artifactUrl}.`;
          }
          if (active.status === "needs_you") {
            return active.summary ||
              `Code job needs setup on lane "${project.name}" (CURSOR_API_KEY and/or GitHub repo URL).`;
          }
          return `Code job is launching a Cloud Agent on lane "${project.name}". Watch In flight for the agent link.`;
        })();

        return {
          started: true,
          matchedBy: resolved.matchedBy,
          trustLevel: projectTrust(project),
          kindResolved: {
            requested: kind ?? "ops",
            final: resolvedKind.kind,
            coerced: resolvedKind.coerced,
            reason: resolvedKind.reason,
            gscEnriched,
          },
          job: {
            id: active.id,
            title: active.title,
            kind: active.kind,
            status: active.status,
            summary: active.summary,
            brief: active.brief,
            artifactUrl: active.artifactUrl,
            agentId: active.agentId,
            agentRunId: active.agentRunId,
            projectId: project.id,
            projectName: project.name,
            repoUrl: project.repoUrl,
            vaultPath: project.vaultPath,
          },
          note:
            codeNote ??
            (active.kind === "message"
              ? `Message draft is in flight on lane "${project.name}". It will land in Needs you with a Content/ pack (caption${ /instagram|ig|insta/i.test(project.contentChannel || "") ? " + image" : ""} for ${project.contentChannel || "the channel"}).`
              : project.vaultPath
                ? `Job is in flight on lane "${project.name}". When finished, a markdown note is written under Jarvis Jobs/ in that lane's vault.`
                : `Job is in flight on lane "${project.name}", but that lane has no vault path — set one or the job will need you when it tries to write the note.`),
        };
      },
    }),

    write_vault_note: tool({
      description:
        "Write or overwrite a markdown note in a project's Obsidian vault. Pass `lane` when the user named a lane. For longer planning/research, prefer start_job.",
      inputSchema: z.object({
        path: z
          .string()
          .min(1)
          .max(240)
          .describe("Relative note path, e.g. Planning/Forge-social.md"),
        content: z.string().min(1).max(200_000).describe("Full markdown body"),
        ...laneFields,
        overwrite: z.boolean().optional().describe("Defaults to true"),
      }),
      execute: async ({ path, content, projectId, lane, overwrite }) => {
        const resolved = await resolveLane({
          projectId,
          lane,
          fallbackProjectId: activeProjectId,
        });
        if (!resolved.ok) {
          return {
            error: resolved.error,
            candidates: resolved.candidates ?? null,
          };
        }
        const project = resolved.project;
        if (!canWriteVaultNote(project.trustLevel)) {
          return {
            error: trustDenialMessage(
              projectTrust(project),
              "write_vault_note",
            ),
          };
        }
        if (!project.vaultPath) {
          return {
            error: `Project "${project.name}" has no vault path configured.`,
          };
        }
        try {
          const note = writeVaultNote(project.vaultPath, path, content, {
            overwrite: overwrite !== false,
          });
          return {
            written: true,
            matchedBy: resolved.matchedBy,
            projectId: project.id,
            projectName: project.name,
            note: {
              path: note.path,
              title: note.title,
              bytes: note.bytes,
            },
          };
        } catch (error) {
          return { error: vaultErrorMessage(error) };
        }
      },
    }),

    list_vault_notes: tool({
      description:
        "List markdown notes in a project's Obsidian vault. Pass `lane` when the user named a lane.",
      inputSchema: z.object(laneFields),
      execute: async ({ projectId, lane }) => {
        const resolved = await resolveLane({
          projectId,
          lane,
          fallbackProjectId: activeProjectId,
        });
        if (!resolved.ok) {
          return {
            error: resolved.error,
            candidates: resolved.candidates ?? null,
          };
        }
        const project = resolved.project;
        if (!project.vaultPath) {
          return {
            error: `Project "${project.name}" has no vault path configured.`,
            projectId: project.id,
            projectName: project.name,
          };
        }
        try {
          const notes = listVaultNotes(project.vaultPath);
          return {
            matchedBy: resolved.matchedBy,
            projectId: project.id,
            projectName: project.name,
            vaultPath: project.vaultPath,
            notes,
          };
        } catch (error) {
          return { error: vaultErrorMessage(error) };
        }
      },
    }),

    search_vault_notes: tool({
      description:
        "Search markdown notes in a project's Obsidian vault for a query string. Pass `lane` when named.",
      inputSchema: z.object({
        query: z.string().min(2).describe("Text to search for in notes"),
        ...laneFields,
      }),
      execute: async ({ query, projectId, lane }) => {
        const resolved = await resolveLane({
          projectId,
          lane,
          fallbackProjectId: activeProjectId,
        });
        if (!resolved.ok) {
          return {
            error: resolved.error,
            candidates: resolved.candidates ?? null,
          };
        }
        const project = resolved.project;
        if (!project.vaultPath) {
          return {
            error: `Project "${project.name}" has no vault path configured.`,
          };
        }
        try {
          const hits = searchVaultNotes(project.vaultPath, query);
          return {
            matchedBy: resolved.matchedBy,
            projectId: project.id,
            projectName: project.name,
            query,
            hits,
          };
        } catch (error) {
          return { error: vaultErrorMessage(error) };
        }
      },
    }),

    read_vault_note: tool({
      description:
        "Read one markdown note from a project's Obsidian vault by relative path. Pass `lane` when named.",
      inputSchema: z.object({
        path: z
          .string()
          .describe("Relative note path inside the vault, e.g. Home.md"),
        ...laneFields,
      }),
      execute: async ({ path, projectId, lane }) => {
        const resolved = await resolveLane({
          projectId,
          lane,
          fallbackProjectId: activeProjectId,
        });
        if (!resolved.ok) {
          return {
            error: resolved.error,
            candidates: resolved.candidates ?? null,
          };
        }
        const project = resolved.project;
        if (!project.vaultPath) {
          return {
            error: `Project "${project.name}" has no vault path configured.`,
          };
        }
        try {
          const note = readVaultNote(project.vaultPath, path);
          return {
            matchedBy: resolved.matchedBy,
            projectId: project.id,
            projectName: project.name,
            note,
          };
        } catch (error) {
          return { error: vaultErrorMessage(error) };
        }
      },
    }),

    get_repo_summary: tool({
      description:
        "Summarize the GitHub repo linked to a project lane (description, default branch, open issues, last push).",
      inputSchema: z.object(laneFields),
      execute: async ({ projectId, lane }) => {
        const resolved = await resolveLane({
          projectId,
          lane,
          fallbackProjectId: activeProjectId,
        });
        if (!resolved.ok) {
          return {
            error: resolved.error,
            candidates: resolved.candidates ?? null,
          };
        }
        const project = resolved.project;
        if (!project.repoUrl) {
          return {
            error: `Project "${project.name}" has no repo URL configured.`,
          };
        }
        try {
          const summary = await getRepoSummary(project.repoUrl);
          return {
            matchedBy: resolved.matchedBy,
            projectId: project.id,
            projectName: project.name,
            repoUrl: project.repoUrl,
            summary,
          };
        } catch (error) {
          return { error: githubErrorMessage(error) };
        }
      },
    }),

    list_open_prs: tool({
      description:
        "List open pull requests for the GitHub repo linked to a project lane.",
      inputSchema: z.object({
        ...laneFields,
        limit: z.number().int().min(1).max(30).optional(),
      }),
      execute: async ({ projectId, lane, limit }) => {
        const resolved = await resolveLane({
          projectId,
          lane,
          fallbackProjectId: activeProjectId,
        });
        if (!resolved.ok) {
          return {
            error: resolved.error,
            candidates: resolved.candidates ?? null,
          };
        }
        const project = resolved.project;
        if (!project.repoUrl) {
          return {
            error: `Project "${project.name}" has no repo URL configured.`,
          };
        }
        try {
          const pullRequests = await listOpenPullRequests(
            project.repoUrl,
            limit ?? 12,
          );
          return {
            matchedBy: resolved.matchedBy,
            projectId: project.id,
            projectName: project.name,
            repoUrl: project.repoUrl,
            count: pullRequests.length,
            pullRequests,
          };
        } catch (error) {
          return { error: githubErrorMessage(error) };
        }
      },
    }),

    get_lane_analytics: tool({
      description:
        "Summarize Google Analytics (GA4) for a lane: users, sessions, views, period deltas, and top pages. Requires gaPropertyId on the lane plus GA4 service-account credentials.",
      inputSchema: z.object({
        ...laneFields,
        days: z
          .number()
          .int()
          .min(1)
          .max(90)
          .optional()
          .describe("Lookback days. Defaults to 7."),
      }),
      execute: async ({ projectId, lane, days }) => {
        const resolved = await resolveLane({
          projectId,
          lane,
          fallbackProjectId: activeProjectId,
        });
        if (!resolved.ok) {
          return {
            error: resolved.error,
            candidates: resolved.candidates ?? null,
          };
        }
        const project = resolved.project;
        if (!project.gaPropertyId) {
          return {
            error: `Lane "${project.name}" has no GA4 property id. Set it on the project edit form.`,
          };
        }
        if (!isGa4Configured()) {
          return {
            error:
              "GA4 credentials missing. Set GA4_SERVICE_ACCOUNT_JSON or GOOGLE_APPLICATION_CREDENTIALS in apps/web/.env.local.",
          };
        }
        try {
          const summary = await getPropertySummary(
            project.gaPropertyId,
            days ?? 7,
          );
          return {
            matchedBy: resolved.matchedBy,
            projectId: project.id,
            projectName: project.name,
            gaPropertyId: project.gaPropertyId,
            summary,
          };
        } catch (error) {
          return { error: ga4ErrorMessage(error) };
        }
      },
    }),

    get_lane_search: tool({
      description:
        "Deep-dive Google Search Console SEO for a lane: clicks, impressions, CTR, average position, top queries/pages, rising/declining queries, device/country splits, submitted sitemaps (errors/warnings/indexed counts), and URL Inspection samples for index coverage. Requires gscSiteUrl on the lane plus the shared Google service-account credentials (Search Console API enabled). URL Inspection may need the SA as Owner on the property.",
      inputSchema: z.object({
        ...laneFields,
        days: z
          .number()
          .int()
          .min(1)
          .max(90)
          .optional()
          .describe("Lookback days. Defaults to 28."),
        includeCoverage: z
          .boolean()
          .optional()
          .describe(
            "Include sitemaps + URL Inspection. Defaults to true. Set false for a faster performance-only pull.",
          ),
        inspectUrl: z
          .string()
          .optional()
          .describe(
            "Optional absolute page URL to force-inspect (plus top pages). Example: https://example.com/blog/post",
          ),
      }),
      execute: async ({
        projectId,
        lane,
        days,
        includeCoverage,
        inspectUrl,
      }) => {
        const resolved = await resolveLane({
          projectId,
          lane,
          fallbackProjectId: activeProjectId,
        });
        if (!resolved.ok) {
          return {
            error: resolved.error,
            candidates: resolved.candidates ?? null,
          };
        }
        const project = resolved.project;
        if (!project.gscSiteUrl) {
          return {
            error: `Lane "${project.name}" has no Search Console site. Set gscSiteUrl (sc-domain:example.com or https://example.com/) on the project edit form.`,
          };
        }
        if (!isGscConfigured()) {
          return {
            error:
              "Search Console credentials missing on the server. In Railway Variables, set GA4_SERVICE_ACCOUNT_JSON (or GSC_SERVICE_ACCOUNT_JSON) to the full service-account JSON key file contents, then redeploy. A local path like GOOGLE_APPLICATION_CREDENTIALS=./lib/google/sa.json will not work on Railway — that file is gitignored and is not in the Docker image.",
          };
        }
        try {
          const summary = await getSearchConsoleSummary(project.gscSiteUrl, {
            days: days ?? 28,
            includeCoverage: includeCoverage ?? true,
            inspectUrls: inspectUrl?.trim() ? [inspectUrl.trim()] : undefined,
          });
          return {
            matchedBy: resolved.matchedBy,
            projectId: project.id,
            projectName: project.name,
            gscSiteUrl: project.gscSiteUrl,
            summary,
            note: "Use rising/declining queries, top pages, device/country splits, sitemap errors, and index coverageState/verdict for SEO priorities. Do not invent rankings or index status beyond this data. If the user asked to implement/ship SEO updates, follow up with start_job kind=code (not research/ops) and put these targets in the brief.",
          };
        } catch (error) {
          return { error: gscErrorMessage(error) };
        }
      },
    }),

    get_lane_recommendations: tool({
      description:
        "Deep goal-aligned recommendations for a lane from GA4 + Search Console (site SEO, content, and social post ideas). Call this when the user asks what to do next, how to grow toward the lane goal, SEO priorities, or social/content strategy. Returns a narrative briefing plus prioritized actions with paste-ready job briefs. Optional writeVault stores Jarvis Jobs/recommendations/. Does NOT invent social engagement metrics — social ideas are grounded in search/traffic demand + contentBrief.",
      inputSchema: z.object({
        ...laneFields,
        ga4Days: z
          .number()
          .int()
          .min(1)
          .max(90)
          .optional()
          .describe("GA4 lookback days. Defaults to 28."),
        gscDays: z
          .number()
          .int()
          .min(1)
          .max(90)
          .optional()
          .describe("Search Console lookback days. Defaults to 28."),
        includeCoverage: z
          .boolean()
          .optional()
          .describe("Include GSC sitemaps + URL Inspection. Defaults to true."),
        writeVault: z
          .boolean()
          .optional()
          .describe(
            "Write markdown under Jarvis Jobs/recommendations/. Requires drafter+ trust. Defaults to false.",
          ),
      }),
      execute: async ({
        projectId,
        lane,
        ga4Days,
        gscDays,
        includeCoverage,
        writeVault,
      }) => {
        const resolved = await resolveLane({
          projectId,
          lane,
          fallbackProjectId: activeProjectId,
        });
        if (!resolved.ok) {
          return {
            error: resolved.error,
            candidates: resolved.candidates ?? null,
          };
        }
        const project = resolved.project;
        if (!project.gaPropertyId?.trim() && !project.gscSiteUrl?.trim()) {
          return {
            error: `Lane "${project.name}" has neither gaPropertyId nor gscSiteUrl. Set analytics on the project form first.`,
          };
        }

        const wantVault = Boolean(writeVault);
        if (wantVault && !canWriteVaultNote(project.trustLevel)) {
          return {
            error: trustDenialMessage(
              projectTrust(project),
              "write recommendations vault note",
            ),
          };
        }

        try {
          const result = await generateLaneRecommendations({
            project,
            ga4Days: ga4Days ?? 28,
            gscDays: gscDays ?? 28,
            includeCoverage: includeCoverage ?? true,
            writeVault: wantVault,
          });
          return {
            matchedBy: resolved.matchedBy,
            ...result,
            // Keep tool payload smaller for the model — full GA4/GSC dumps are huge.
            snapshot: {
              ga4: result.snapshot.ga4
                ? {
                    rangeDays: result.snapshot.ga4.rangeDays,
                    current: result.snapshot.ga4.current,
                    deltas: result.snapshot.ga4.deltas,
                    topPages: result.snapshot.ga4.topPages.slice(0, 6),
                  }
                : null,
              gsc: result.snapshot.gsc
                ? {
                    rangeDays: result.snapshot.gsc.rangeDays,
                    startDate: result.snapshot.gsc.startDate,
                    endDate: result.snapshot.gsc.endDate,
                    current: result.snapshot.gsc.current,
                    deltas: result.snapshot.gsc.deltas,
                    risingQueries: result.snapshot.gsc.risingQueries.slice(0, 6),
                    decliningQueries:
                      result.snapshot.gsc.decliningQueries.slice(0, 6),
                    topPages: result.snapshot.gsc.topPages.slice(0, 6),
                    coverage: result.snapshot.gsc.coverage
                      ? {
                          sitemapTotals:
                            result.snapshot.gsc.coverage.sitemapTotals,
                          inspected: result.snapshot.gsc.coverage.inspectedUrls
                            .slice(0, 4)
                            .map((u) => ({
                              url: u.inspectionUrl,
                              verdict: u.indexStatusResult.verdict,
                              coverageState: u.indexStatusResult.coverageState,
                            })),
                        }
                      : null,
                  }
                : null,
            },
            note: [
              "Present the narrative + top priorities in spoken style.",
              "To execute: start_job with the recommendation briefSeed (kind from suggestedJobKind).",
              "Do not invent metrics beyond this payload. Social channels have no native analytics yet.",
              result.vaultPath ? `Vault note: ${result.vaultPath}` : null,
            ]
              .filter(Boolean)
              .join(" "),
          };
        } catch (error) {
          return {
            error:
              error instanceof Error
                ? error.message
                : "Recommendations failed",
          };
        }
      },
    }),

    draft_daily_post: tool({
      description:
        "Queue a daily content draft (kind message) for a lane — used for Skool / Instagram / channel posts. Instagram channels also generate an image pack. Draft lands in Needs you for approve-before-post (or Approve & publish when Instagram API is configured).",
      inputSchema: z.object({
        ...laneFields,
        force: z
          .boolean()
          .optional()
          .describe("Queue even if a daily draft already exists today."),
      }),
      execute: async ({ projectId, lane, force }) => {
        const resolved = await resolveLane({
          projectId,
          lane,
          fallbackProjectId: activeProjectId,
        });
        if (!resolved.ok) {
          return {
            error: resolved.error,
            candidates: resolved.candidates ?? null,
          };
        }
        if (!canQueueDailyContent(resolved.project.trustLevel)) {
          return {
            error: trustDenialMessage(
              projectTrust(resolved.project),
              "draft_daily_post",
            ),
          };
        }
        const result = await queueDailyContentDrafts({
          projectId: resolved.project.id,
          force: Boolean(force),
        });
        return {
          matchedBy: resolved.matchedBy,
          projectName: resolved.project.name,
          contentChannel: resolved.project.contentChannel,
          trustLevel: projectTrust(resolved.project),
          ...result,
          note:
            result.queued.length > 0
              ? `Draft job queued on "${resolved.project.name}". Watch In flight, then Needs you — copy the Content/ pack into ${resolved.project.contentChannel || "the channel"} (or Approve & publish for Instagram when configured).`
              : result.skipped[0]?.reason || "Nothing queued.",
        };
      },
    }),

    ingest_emails: tool({
      description:
        "Poll Gmail for unread messages from allowlisted senders, classify each as code vs question vs ambiguous, then queue the right job. Requires Gmail OAuth env vars.",
      inputSchema: z.object({
        max: z
          .number()
          .int()
          .min(1)
          .max(40)
          .optional()
          .describe("Max messages to scan. Defaults to 15."),
      }),
      execute: async ({ max }) => {
        if (!isGmailConfigured()) {
          return {
            error:
              "Gmail not configured. Set GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN (visit /api/gmail/oauth/start once).",
          };
        }
        const result = await ingestInboundEmails({ maxMessages: max ?? 15 });
        return {
          ...result,
          note:
            result.queued.length > 0
              ? `Queued ${result.queued.length} email job(s). Code runs agents; questions land as draft replies in Needs you; ambiguous needs triage.`
              : "No new allowlisted emails queued.",
        };
      },
    }),

    get_briefing: tool({
      description:
        "Fetch the latest morning or evening operator briefing (from Alerts). Use when the user asks for today's briefing or a status digest.",
      inputSchema: z.object({
        kind: z
          .enum(["morning", "evening"])
          .optional()
          .describe("Optional filter. Defaults to whichever was generated most recently."),
      }),
      execute: async ({ kind }) => {
        const latest = await getLatestBriefing(kind);
        if (!latest) {
          return {
            found: false,
            note: "No briefing yet. Call run_briefing to generate one now.",
          };
        }
        return { found: true, ...latest };
      },
    }),

    run_briefing: tool({
      description:
        "Generate a morning or evening briefing now (notification + optional vault note under Jarvis Jobs/briefings/). Use when the user asks for a briefing or end-of-day wrap.",
      inputSchema: z.object({
        kind: z
          .enum(["morning", "evening"])
          .optional()
          .describe("Defaults from local hour (<15 morning, else evening)."),
        force: z
          .boolean()
          .optional()
          .describe("Regenerate even if one already exists for today."),
      }),
      execute: async ({ kind, force }) => {
        const result = await generateBriefing({
          kind,
          force: Boolean(force),
        });
        return {
          ...result,
          note: result.skipped
            ? `Already sent ${result.kind} briefing for ${result.dayKey}. Pass force=true to regenerate.`
            : `${result.kind} briefing ready in Alerts${result.vaultPath ? ` and vault ${result.vaultPath}` : ""}.`,
        };
      },
    }),

    get_weekly_review: tool({
      description:
        "Fetch the latest weekly operator review (from Alerts). Use when the user asks what happened this week or for the weekly digest.",
      inputSchema: z.object({}),
      execute: async () => {
        const latest = await getLatestWeeklyReview();
        if (!latest) {
          return {
            found: false,
            note: "No weekly review yet. Call run_weekly_review to generate one now.",
          };
        }
        return { found: true, ...latest };
      },
    }),

    run_weekly_review: tool({
      description:
        "Generate a weekly review now: Alerts digest + Jarvis Jobs/reviews/ notes + compacted Memory/<slug>/Current.md per vaulted lane. Pass lane/projectId to review one lane only (skips hub notification).",
      inputSchema: z.object({
        ...laneFields,
        force: z
          .boolean()
          .optional()
          .describe("Regenerate even if this ISO week already has a review."),
      }),
      execute: async ({ projectId, lane, force }) => {
        let scopedProjectId: string | undefined;
        if (projectId || lane) {
          const resolved = await resolveLane({
            projectId,
            lane,
            fallbackProjectId: activeProjectId,
          });
          if (!resolved.ok) {
            return {
              error: resolved.error,
              candidates: resolved.candidates ?? null,
            };
          }
          scopedProjectId = resolved.project.id;
        }

        const result = await generateWeeklyReview({
          force: Boolean(force),
          projectId: scopedProjectId,
        });
        return {
          ...result,
          note: result.skipped
            ? result.reason === "already_sent"
              ? `Weekly review for ${result.weekKey} already exists. Pass force=true to regenerate.`
              : `Weekly review skipped (${result.reason}).`
            : `Weekly review ${result.weekKey} ready${result.vaultPath ? ` at ${result.vaultPath}` : ""}. Per-lane Memory/<slug>/Current.md compacted where vaults exist.`,
        };
      },
    }),

    check_pr_ci: tool({
      description:
        "Scan open PRs on active lanes for failing CI and create Alerts notifications. Light watchdog — does not merge or comment on GitHub.",
      inputSchema: z.object({}),
      execute: async () => {
        const result = await runPrWatchdog();
        return {
          ...result,
          note:
            result.notified.length > 0
              ? `Posted ${result.notified.length} CI alert(s).`
              : result.failing.length > 0
                ? "Failing PRs found but already notified recently."
                : "No failing CI on scanned open PRs.",
        };
      },
    }),

    get_lane_deploy: tool({
      description:
        "Live production status for a lane: URL health check plus Vercel/Railway deploy state when configured. Persists the result on the lane for the dashboard. Requires productionUrl and/or deployHost + deployProjectId.",
      inputSchema: z.object({
        ...laneFields,
      }),
      execute: async ({ projectId, lane }) => {
        const resolved = await resolveLane({
          projectId,
          lane,
          fallbackProjectId: activeProjectId,
        });
        if (!resolved.ok) {
          return {
            error: resolved.error,
            candidates: resolved.candidates ?? null,
          };
        }
        const project = resolved.project;
        if (
          !project.productionUrl?.trim() &&
          !project.deployProjectId?.trim()
        ) {
          return {
            error: `Lane "${project.name}" has no productionUrl or deployProjectId. Set them on the project edit form.`,
          };
        }
        try {
          const snapshot = await refreshProjectDeployStatus(project);
          return {
            matchedBy: resolved.matchedBy,
            ...snapshot,
            note: "Use status/detail for operator answers. Do not invent uptime beyond this probe.",
          };
        } catch (error) {
          return {
            error:
              error instanceof Error
                ? error.message
                : "Deploy status check failed",
          };
        }
      },
    }),

    check_deploy_health: tool({
      description:
        "Scan all active lanes with production URL / deploy ids, refresh cached status, and create Alerts for down/degraded. Same step as cron /api/cron/tick deployHealth.",
      inputSchema: z.object({}),
      execute: async () => {
        const result = await runDeployWatchdog();
        return {
          ...result,
          note:
            result.notified.length > 0
              ? `Posted ${result.notified.length} deploy alert(s).`
              : result.unhealthy.length > 0
                ? "Unhealthy lanes found but already notified recently."
                : "All monitored production lanes look healthy (or none configured).",
        };
      },
    }),
  };
}
