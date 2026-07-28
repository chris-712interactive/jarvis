import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import type { HubState, Job, Project } from "./types";

// Phase 1 uses a simple JSON file store on disk so the Project Hub is real
// without requiring an external Postgres. The docs' data model (Project, Job,
// NotificationPolicy) will migrate to Postgres in a later phase.
const DATA_DIR = path.join(process.cwd(), ".data");
const DATA_FILE = path.join(DATA_DIR, "hub.json");

function seed(): HubState {
  const now = new Date().toISOString();
  return {
    projects: [
      {
        id: randomUUID(),
        name: "carline-dad",
        goal: "Ship onboarding flow",
        source: "github.com/acme/carline-dad",
        status: "active",
        needsYou: true,
        createdAt: now,
      },
    ],
    jobs: [
      {
        id: randomUUID(),
        projectId: "seed",
        title: "Draft onboarding PR",
        kind: "code",
        status: "running",
        interruptLevel: "digest",
        createdAt: now,
      },
    ],
  };
}

async function read(): Promise<HubState> {
  try {
    const raw = await fs.readFile(DATA_FILE, "utf8");
    return JSON.parse(raw) as HubState;
  } catch {
    const initial = seed();
    await write(initial);
    return initial;
  }
}

async function write(state: HubState): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(DATA_FILE, JSON.stringify(state, null, 2), "utf8");
}

export async function getState(): Promise<HubState> {
  return read();
}

export async function createProject(input: {
  name: string;
  goal: string;
  source: string;
}): Promise<Project> {
  const state = await read();
  const project: Project = {
    id: randomUUID(),
    name: input.name.trim(),
    goal: input.goal.trim(),
    source: input.source.trim(),
    status: "active",
    needsYou: false,
    createdAt: new Date().toISOString(),
  };
  state.projects.unshift(project);
  await write(state);
  return project;
}

export async function setProjectStatus(
  id: string,
  status: Project["status"]
): Promise<void> {
  const state = await read();
  const project = state.projects.find((p) => p.id === id);
  if (project) {
    project.status = status;
    await write(state);
  }
}

export async function toggleNeedsYou(id: string): Promise<void> {
  const state = await read();
  const project = state.projects.find((p) => p.id === id);
  if (project) {
    project.needsYou = !project.needsYou;
    await write(state);
  }
}

export function jobsForProject(state: HubState, projectId: string): Job[] {
  return state.jobs.filter((j) => j.projectId === projectId);
}
