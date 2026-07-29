import { tool } from "ai";
import { z } from "zod";
import {
  getDashboardData,
  getProject,
  listJobs,
  listProjects,
} from "@/lib/db/queries";
import {
  listVaultNotes,
  readVaultNote,
  searchVaultNotes,
  VaultError,
} from "@/lib/vault/notes";

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
          projectId: j.projectId,
          projectName: byId.get(j.projectId) ?? null,
          updatedAt: j.updatedAt,
        }));
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
