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
import { resolveLane } from "@/lib/chat/resolve-lane";
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
import { jobKinds, interruptLevels } from "@/lib/db/schema";

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
            needsYou: p.needsYou,
            interruptLevel: p.interruptLevel,
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
            needsYou: project.needsYou,
            interruptLevel: project.interruptLevel,
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
        "Mark a priority job as approved/done so it leaves Needs you. Use when the user approves a decision, architecture choice, or clears a blocked job. Prefer jobId from list_jobs / get_dashboard_status; title match is a fallback.",
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
      }),
      execute: async ({ jobId, title, note }) => {
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

        const summary =
          note?.trim() ||
          `Approved / resolved by operator. (${job.title})`;
        const updated = await updateJob(job.id, {
          status: "done",
          summary,
        });
        return {
          resolved: true,
          job: updated
            ? {
                id: updated.id,
                title: updated.title,
                status: updated.status,
                summary: updated.summary,
              }
            : null,
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
        "Start an async background job for a project lane. When the user names a lane, pass it as `lane` — do not rely on the UI dropdown. Prefer this for research, ops, drafts, and coding missions. Use kind `code` for implement/PR work — that launches a Cursor Cloud Agent when CURSOR_API_KEY and a GitHub repo URL are set.",
      inputSchema: z.object({
        title: z.string().min(1).max(200).describe("Short job title"),
        brief: z
          .string()
          .min(1)
          .max(8000)
          .describe("What the worker should accomplish"),
        kind: z
          .enum(jobKinds)
          .optional()
          .describe(
            "code (Cloud Agent) | research | ops | message. Defaults to ops. Prefer code for implement/fix/PR work.",
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

        const job = await createJob({
          projectId: project.id,
          title,
          brief,
          kind: kind ?? "ops",
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
            (project.vaultPath
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
  };
}
