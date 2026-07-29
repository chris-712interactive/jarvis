import { getProject, listProjects } from "@/lib/db/queries";
import type { Project } from "@/lib/db/schema";

/** Collapse "Forge Rep", "ForgeRep", "forge-rep" to the same key. */
export function normalizeLaneKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export type ResolveLaneInput = {
  /** Explicit project id from a prior tool result. */
  projectId?: string | null;
  /** Spoken/typed lane name, slug, or nickname (e.g. "ForgeRep"). */
  lane?: string | null;
  /** UI dropdown selection — used only when no lane/projectId was given. */
  fallbackProjectId?: string | null;
};

export type ResolveLaneResult =
  | {
      ok: true;
      project: Project;
      matchedBy: "projectId" | "lane" | "fallback";
    }
  | {
      ok: false;
      error: string;
      candidates?: Array<{ id: string; name: string; slug: string }>;
    };

/**
 * Resolve which project lane a tool call should use.
 * Priority: explicit projectId → named lane → UI dropdown fallback.
 */
export async function resolveLane(
  input: ResolveLaneInput,
): Promise<ResolveLaneResult> {
  const projectId = input.projectId?.trim() || "";
  const lane = input.lane?.trim() || "";
  const fallback = input.fallbackProjectId?.trim() || "";

  if (projectId) {
    const project = await getProject(projectId);
    if (!project) {
      return { ok: false, error: `No project with id ${projectId}` };
    }
    return { ok: true, project, matchedBy: "projectId" };
  }

  if (lane) {
    const projects = (await listProjects()).filter((p) => p.status !== "archived");
    const key = normalizeLaneKey(lane);
    if (!key) {
      return { ok: false, error: "Lane name was empty after normalizing." };
    }

    const scored = projects
      .map((project) => {
        const nameKey = normalizeLaneKey(project.name);
        const slugKey = normalizeLaneKey(project.slug);
        let score = 0;
        if (nameKey === key || slugKey === key) score = 100;
        else if (nameKey.startsWith(key) || slugKey.startsWith(key)) score = 80;
        else if (key.startsWith(nameKey) && nameKey.length >= 4) score = 70;
        else if (nameKey.includes(key) && key.length >= 4) score = 60;
        else if (key.includes(nameKey) && nameKey.length >= 4) score = 50;
        return { project, score };
      })
      .filter((row) => row.score > 0)
      .sort((a, b) => b.score - a.score);

    if (scored.length === 0) {
      return {
        ok: false,
        error: `No lane matched "${lane}". Use list_projects and pass the correct lane name.`,
        candidates: projects.slice(0, 12).map((p) => ({
          id: p.id,
          name: p.name,
          slug: p.slug,
        })),
      };
    }

    const best = scored[0];
    const tied = scored.filter((row) => row.score === best.score);
    if (tied.length > 1) {
      return {
        ok: false,
        error: `Lane "${lane}" is ambiguous. Pass a more specific name or projectId.`,
        candidates: tied.map((row) => ({
          id: row.project.id,
          name: row.project.name,
          slug: row.project.slug,
        })),
      };
    }

    return { ok: true, project: best.project, matchedBy: "lane" };
  }

  if (fallback) {
    const project = await getProject(fallback);
    if (!project) {
      return { ok: false, error: "UI-selected lane was not found." };
    }
    return { ok: true, project, matchedBy: "fallback" };
  }

  return {
    ok: false,
    error:
      "No lane specified. Pass lane (the name the user said) or ask which lane owns this work.",
  };
}
