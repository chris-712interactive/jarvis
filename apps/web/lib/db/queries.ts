import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getDb } from "./index";
import {
  jobs,
  projects,
  type InterruptLevel,
  type Job,
  type JobKind,
  type JobStatus,
  type ProjectStatus,
} from "./schema";

function slugify(name: string) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64);
}

export async function listProjects(status?: ProjectStatus) {
  const db = getDb();
  if (status) {
    return db
      .select()
      .from(projects)
      .where(eq(projects.status, status))
      .orderBy(asc(projects.name));
  }
  return db.select().from(projects).orderBy(asc(projects.name));
}

export async function getProject(id: string) {
  const db = getDb();
  const rows = await db.select().from(projects).where(eq(projects.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function getProjectBySlug(slug: string) {
  const db = getDb();
  const rows = await db
    .select()
    .from(projects)
    .where(eq(projects.slug, slug))
    .limit(1);
  return rows[0] ?? null;
}

export type CreateProjectInput = {
  name: string;
  goal?: string;
  status?: ProjectStatus;
  repoUrl?: string | null;
  notes?: string;
  vaultPath?: string | null;
  needsYou?: string | null;
  interruptLevel?: InterruptLevel;
};

export async function createProject(input: CreateProjectInput) {
  const db = getDb();
  const now = new Date();
  let slug = slugify(input.name) || "project";
  const existing = await getProjectBySlug(slug);
  if (existing) {
    slug = `${slug}-${nanoid(6)}`;
  }

  const row = {
    id: nanoid(),
    name: input.name.trim(),
    slug,
    goal: input.goal?.trim() ?? "",
    status: input.status ?? "active",
    repoUrl: input.repoUrl?.trim() || null,
    notes: input.notes?.trim() ?? "",
    vaultPath: input.vaultPath?.trim() || null,
    needsYou: input.needsYou?.trim() || null,
    interruptLevel: input.interruptLevel ?? "digest",
    createdAt: now,
    updatedAt: now,
  };

  await db.insert(projects).values(row);
  return row;
}

export type UpdateProjectInput = Partial<CreateProjectInput>;

export async function updateProject(id: string, input: UpdateProjectInput) {
  const db = getDb();
  const existing = await getProject(id);
  if (!existing) return null;

  const patch = {
    name: input.name?.trim() ?? existing.name,
    goal: input.goal !== undefined ? input.goal.trim() : existing.goal,
    status: input.status ?? existing.status,
    repoUrl:
      input.repoUrl !== undefined
        ? input.repoUrl?.trim() || null
        : existing.repoUrl,
    notes: input.notes !== undefined ? input.notes.trim() : existing.notes,
    vaultPath:
      input.vaultPath !== undefined
        ? input.vaultPath?.trim() || null
        : existing.vaultPath,
    needsYou:
      input.needsYou !== undefined
        ? input.needsYou?.trim() || null
        : existing.needsYou,
    interruptLevel: input.interruptLevel ?? existing.interruptLevel,
    updatedAt: new Date(),
  };

  await db.update(projects).set(patch).where(eq(projects.id, id));
  return { ...existing, ...patch };
}

export async function deleteProject(id: string) {
  const db = getDb();
  const existing = await getProject(id);
  if (!existing) return false;
  await db.delete(projects).where(eq(projects.id, id));
  return true;
}

export async function listJobs(filters?: {
  status?: JobStatus | JobStatus[];
  projectId?: string;
}) {
  const db = getDb();
  const conditions = [];
  if (filters?.projectId) {
    conditions.push(eq(jobs.projectId, filters.projectId));
  }
  if (filters?.status) {
    const statuses = Array.isArray(filters.status)
      ? filters.status
      : [filters.status];
    conditions.push(inArray(jobs.status, statuses));
  }

  const query = db.select().from(jobs).orderBy(desc(jobs.updatedAt));
  if (conditions.length === 0) return query;
  return query.where(and(...conditions));
}

export async function getJob(id: string) {
  const db = getDb();
  const rows = await db.select().from(jobs).where(eq(jobs.id, id)).limit(1);
  return rows[0] ?? null;
}

export type CreateJobInput = {
  projectId: string;
  title: string;
  kind?: JobKind;
  status?: JobStatus;
  summary?: string;
  brief?: string;
  artifactUrl?: string | null;
  agentId?: string | null;
  agentRunId?: string | null;
  interruptLevel?: InterruptLevel;
};

export async function createJob(input: CreateJobInput) {
  const db = getDb();
  const now = new Date();
  const row = {
    id: nanoid(),
    projectId: input.projectId,
    title: input.title.trim(),
    kind: input.kind ?? "ops",
    status: input.status ?? "queued",
    summary: input.summary?.trim() ?? "",
    brief: input.brief?.trim() ?? "",
    artifactUrl: input.artifactUrl?.trim() || null,
    agentId: input.agentId?.trim() || null,
    agentRunId: input.agentRunId?.trim() || null,
    interruptLevel: input.interruptLevel ?? "digest",
    createdAt: now,
    updatedAt: now,
  };
  await db.insert(jobs).values(row);
  return row;
}

export type UpdateJobInput = {
  title?: string;
  kind?: JobKind;
  status?: JobStatus;
  summary?: string;
  brief?: string;
  artifactUrl?: string | null;
  agentId?: string | null;
  agentRunId?: string | null;
  interruptLevel?: InterruptLevel;
};

export async function updateJob(id: string, input: UpdateJobInput) {
  const db = getDb();
  const existing = await getJob(id);
  if (!existing) return null;

  const patch: Partial<Job> & { updatedAt: Date } = {
    title: input.title?.trim() ?? existing.title,
    kind: input.kind ?? existing.kind,
    status: input.status ?? existing.status,
    summary:
      input.summary !== undefined ? input.summary.trim() : existing.summary,
    brief: input.brief !== undefined ? input.brief.trim() : existing.brief,
    artifactUrl:
      input.artifactUrl !== undefined
        ? input.artifactUrl?.trim() || null
        : existing.artifactUrl,
    agentId:
      input.agentId !== undefined
        ? input.agentId?.trim() || null
        : existing.agentId,
    agentRunId:
      input.agentRunId !== undefined
        ? input.agentRunId?.trim() || null
        : existing.agentRunId,
    interruptLevel: input.interruptLevel ?? existing.interruptLevel,
    updatedAt: new Date(),
  };

  await db.update(jobs).set(patch).where(eq(jobs.id, id));
  return { ...existing, ...patch };
}

export async function updateJobStatus(
  id: string,
  status: JobStatus,
  extras?: { summary?: string; artifactUrl?: string | null },
) {
  return updateJob(id, {
    status,
    summary: extras?.summary,
    artifactUrl: extras?.artifactUrl,
  });
}

export async function getDashboardData() {
  const allProjects = await listProjects();
  const activeProjects = allProjects.filter((p) => p.status !== "archived");

  const needsYouFromProjects = activeProjects.filter((p) => Boolean(p.needsYou));
  const needsYouJobs = await listJobs({ status: ["needs_you", "failed"] });
  const inFlightJobs = await listJobs({ status: ["queued", "running"] });
  const recentDone = (await listJobs({ status: ["done"] })).slice(0, 8);

  const projectById = new Map(allProjects.map((p) => [p.id, p]));

  return {
    projects: activeProjects,
    needsYou: {
      projects: needsYouFromProjects,
      jobs: needsYouJobs.map((job) => ({
        ...job,
        project: projectById.get(job.projectId) ?? null,
      })),
    },
    inFlight: inFlightJobs.map((job) => ({
      ...job,
      project: projectById.get(job.projectId) ?? null,
    })),
    recent: recentDone.map((job) => ({
      ...job,
      project: projectById.get(job.projectId) ?? null,
    })),
    counts: {
      projects: activeProjects.length,
      needsYou:
        needsYouFromProjects.length +
        needsYouJobs.filter((j) => j.status === "needs_you" || j.status === "failed")
          .length,
      inFlight: inFlightJobs.length,
    },
  };
}

export async function seedIfEmpty() {
  const existing = await listProjects();
  if (existing.length > 0) return { seeded: false, count: existing.length };

  const hub = await createProject({
    name: "Command hub",
    goal: "Ship a command center for every active project with async agents.",
    repoUrl: "https://github.com/chris-712interactive/jarvis",
    notes: "Control plane + conversation + job tracking.",
    vaultPath: "fixtures/sample-vault",
    needsYou: null,
    interruptLevel: "nudge",
  });

  const carline = await createProject({
    name: "The Carline Dad",
    goal: "Grow the brand systems and keep content + product lanes moving.",
    notes: "Example project — replace with your real sources.",
    needsYou: null,
  });

  const ops = await createProject({
    name: "Personal Ops",
    goal: "Keep life admin from stealing focus during deep work.",
    status: "paused",
    notes: "Calendar, errands, follow-ups.",
  });

  await createJob({
    projectId: hub.id,
    title: "Scaffold Phase 1 dashboard",
    kind: "code",
    status: "done",
    summary: "Project Hub + Needs you / In flight / Projects shell shipped.",
    brief: "Ship the Phase 1 dashboard shell.",
    interruptLevel: "digest",
  });

  await createJob({
    projectId: hub.id,
    title: "Review architecture decisions",
    kind: "research",
    status: "done",
    summary:
      "Resolved: keep SQLite for local hub; defer auth until multi-user. Recorded in vault Home.md.",
    brief: "Decide storage and auth for the hub.",
    interruptLevel: "nudge",
  });

  await createJob({
    projectId: carline.id,
    title: "Draft weekly content outline",
    kind: "research",
    status: "queued",
    summary: "Queued for local job runner.",
    brief: "Outline next week's Carline Dad content themes and hooks.",
  });

  await createJob({
    projectId: ops.id,
    title: "Collect open loops",
    kind: "ops",
    status: "done",
    summary: "Seed example of a finished ambient job.",
    brief: "Scan personal ops for open loops.",
  });

  return { seeded: true, count: 3 };
}
