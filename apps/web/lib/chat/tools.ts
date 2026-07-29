import { tool } from "ai";
import { z } from "zod";
import {
  createJob,
  getDashboardData,
  getJob,
  getProject,
  listJobs,
  listProjects,
} from "@/lib/db/queries";
import { kickJob } from "@/lib/jobs/runner";
import {
  listVaultNotes,
  readVaultNote,
  searchVaultNotes,
  writeVaultNote,
  VaultError,
} from "@/lib/vault/notes";
import { jobKinds, interruptLevels } from "@/lib/db/schema";

function vaultErrorMessage(error: unknown) {
  if (error instanceof VaultError) return error.message;
  if (error instanceof Error) return error.message;
  return "Vault read failed";
}

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

    get_project: tool({
      description:
        "Get one project lane by id, or the currently selected active project if no id is provided.",
      inputSchema: z.object({
        projectId: z
          .string()
          .optional()
          .describe("Project id. Defaults to the active chat project."),
      }),
      execute: async ({ projectId }) => {
        const id = projectId || activeProjectId;
        if (!id) {
          return { error: "No project selected. Ask which lane to inspect." };
        }
        const project = await getProject(id);
        if (!project) return { error: "Project not found" };
        const jobs = await listJobs({ projectId: project.id });
        return {
          project: {
            id: project.id,
            name: project.name,
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
        "List jobs, optionally filtered by project and/or status (queued, running, needs_you, done, failed).",
      inputSchema: z.object({
        projectId: z.string().optional(),
        status: z
          .enum(["queued", "running", "needs_you", "done", "failed"])
          .optional(),
      }),
      execute: async ({ projectId, status }) => {
        const id = projectId || activeProjectId || undefined;
        const jobs = await listJobs({
          projectId: id,
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
            updatedAt: job.updatedAt,
          },
          project: project
            ? { id: project.id, name: project.name }
            : null,
        };
      },
    }),

    start_job: tool({
      description:
        "Start an async background job for a project lane. Prefer this for research, ops, drafts, and coding missions that should continue while the user is busy. The job appears under In flight, then moves to Needs you or Recent when finished.",
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
          .describe("code | research | ops | message. Defaults to ops."),
        projectId: z
          .string()
          .optional()
          .describe("Lane id. Defaults to the active chat project."),
        interruptLevel: z
          .enum(interruptLevels)
          .optional()
          .describe("How loudly to notify on completion. Defaults to digest."),
      }),
      execute: async ({ title, brief, kind, projectId, interruptLevel }) => {
        const id = projectId || activeProjectId;
        if (!id) {
          return {
            error:
              "No project selected. Ask which lane owns this job, then call start_job again.",
          };
        }
        const project = await getProject(id);
        if (!project) return { error: "Project not found" };

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

        return {
          started: true,
          job: {
            id: (claimed ?? job).id,
            title: (claimed ?? job).title,
            kind: (claimed ?? job).kind,
            status: (claimed ?? job).status,
            summary: (claimed ?? job).summary,
            brief: (claimed ?? job).brief,
            projectId: project.id,
            projectName: project.name,
            vaultPath: project.vaultPath,
          },
          note:
            (claimed ?? job).kind === "code"
              ? "Code jobs finish as needs_you until coding agents are wired."
              : project.vaultPath
                ? "Job is in flight. When finished, a markdown note is written under Jarvis Jobs/ in this lane's vault."
                : `Job is in flight, but "${project.name}" has no vault path — set one or the job will need you when it tries to write the note.`,
        };
      },
    }),

    write_vault_note: tool({
      description:
        "Write or overwrite a markdown note in a project's Obsidian vault. Use for immediate short notes. For longer planning/research, prefer start_job so work shows under In flight and lands in Jarvis Jobs/.",
      inputSchema: z.object({
        path: z
          .string()
          .min(1)
          .max(240)
          .describe("Relative note path, e.g. Planning/Forge-social.md"),
        content: z.string().min(1).max(200_000).describe("Full markdown body"),
        projectId: z.string().optional(),
        overwrite: z.boolean().optional().describe("Defaults to true"),
      }),
      execute: async ({ path, content, projectId, overwrite }) => {
        const id = projectId || activeProjectId;
        if (!id) return { error: "No project selected." };
        const project = await getProject(id);
        if (!project) return { error: "Project not found" };
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
        "List markdown notes in a project's Obsidian vault. Defaults to the active project.",
      inputSchema: z.object({
        projectId: z.string().optional(),
      }),
      execute: async ({ projectId }) => {
        const id = projectId || activeProjectId;
        if (!id) return { error: "No project selected." };
        const project = await getProject(id);
        if (!project) return { error: "Project not found" };
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
        "Search markdown notes in a project's Obsidian vault for a query string.",
      inputSchema: z.object({
        query: z.string().min(2).describe("Text to search for in notes"),
        projectId: z.string().optional(),
      }),
      execute: async ({ query, projectId }) => {
        const id = projectId || activeProjectId;
        if (!id) return { error: "No project selected." };
        const project = await getProject(id);
        if (!project) return { error: "Project not found" };
        if (!project.vaultPath) {
          return {
            error: `Project "${project.name}" has no vault path configured.`,
          };
        }
        try {
          const hits = searchVaultNotes(project.vaultPath, query);
          return {
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
        "Read one markdown note from a project's Obsidian vault by relative path.",
      inputSchema: z.object({
        path: z
          .string()
          .describe("Relative note path inside the vault, e.g. Home.md"),
        projectId: z.string().optional(),
      }),
      execute: async ({ path, projectId }) => {
        const id = projectId || activeProjectId;
        if (!id) return { error: "No project selected." };
        const project = await getProject(id);
        if (!project) return { error: "Project not found" };
        if (!project.vaultPath) {
          return {
            error: `Project "${project.name}" has no vault path configured.`,
          };
        }
        try {
          const note = readVaultNote(project.vaultPath, path);
          return {
            projectId: project.id,
            projectName: project.name,
            note,
          };
        } catch (error) {
          return { error: vaultErrorMessage(error) };
        }
      },
    }),
  };
}
