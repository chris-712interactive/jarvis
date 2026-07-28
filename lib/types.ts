export type ProjectStatus = "active" | "paused" | "archived";

export type InterruptLevel = "silent" | "digest" | "nudge" | "interrupt";

export type JobStatus =
  | "queued"
  | "running"
  | "needs_you"
  | "done"
  | "failed";

export type JobKind = "code" | "research" | "ops" | "message";

export interface Project {
  id: string;
  name: string;
  goal: string;
  source: string;
  status: ProjectStatus;
  needsYou: boolean;
  createdAt: string;
}

export interface Job {
  id: string;
  projectId: string;
  title: string;
  kind: JobKind;
  status: JobStatus;
  interruptLevel: InterruptLevel;
  createdAt: string;
}

export interface HubState {
  projects: Project[];
  jobs: Job[];
}
