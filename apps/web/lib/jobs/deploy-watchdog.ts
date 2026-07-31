import {
  createNotification,
  listNotifications,
} from "@/lib/db/notifications";
import { listProjects, updateProject } from "@/lib/db/queries";
import type { DeployStatus, Project } from "@/lib/db/schema";
import {
  probeLaneDeploy,
  type LaneDeploySnapshot,
} from "@/lib/deploy/status";

export type DeployWatchdogResult = {
  scanned: number;
  snapshots: Array<{
    projectId: string;
    projectName: string;
    status: DeployStatus;
    detail: string;
  }>;
  unhealthy: Array<{
    projectId: string;
    projectName: string;
    status: DeployStatus;
    detail: string;
  }>;
  notified: string[];
  skipped: string[];
  errors: string[];
};

function alertTitle(projectName: string, status: DeployStatus) {
  return `Deploy ${status}: ${projectName}`;
}

async function alreadyNotified(title: string) {
  const rows = await listNotifications({ limit: 100 });
  const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
  return rows.some((row) => {
    if (row.title !== title) return false;
    if (!row.read) return true;
    const created =
      row.createdAt instanceof Date
        ? row.createdAt.getTime()
        : new Date(row.createdAt).getTime();
    return created >= dayAgo;
  });
}

function isMonitored(project: Project) {
  return Boolean(
    project.productionUrl?.trim() ||
      (project.deployHost &&
        project.deployHost !== "url" &&
        project.deployProjectId?.trim()) ||
      (project.deployHost === "url" && project.productionUrl?.trim()),
  );
}

/** Probe + persist deploy/health for one lane. */
export async function refreshProjectDeployStatus(project: Project) {
  const snapshot = await probeLaneDeploy(project);
  await updateProject(project.id, {
    deployStatus: snapshot.status,
    deployStatusDetail: snapshot.detail.slice(0, 2000),
    deployCheckedAt: new Date(snapshot.checkedAt),
  });
  return snapshot;
}

/** Scan active lanes with production URL / deploy ids; alert on down/degraded. */
export async function runDeployWatchdog(): Promise<DeployWatchdogResult> {
  const projects = await listProjects("active");
  const monitored = projects.filter(isMonitored);

  const result: DeployWatchdogResult = {
    scanned: 0,
    snapshots: [],
    unhealthy: [],
    notified: [],
    skipped: [],
    errors: [],
  };

  for (const project of monitored) {
    result.scanned += 1;
    let snapshot: LaneDeploySnapshot;
    try {
      snapshot = await refreshProjectDeployStatus(project);
    } catch (error) {
      result.errors.push(
        `${project.name}: ${error instanceof Error ? error.message : "deploy check failed"}`,
      );
      continue;
    }

    result.snapshots.push({
      projectId: project.id,
      projectName: project.name,
      status: snapshot.status,
      detail: snapshot.detail,
    });

    if (snapshot.status !== "down" && snapshot.status !== "degraded") {
      continue;
    }

    result.unhealthy.push({
      projectId: project.id,
      projectName: project.name,
      status: snapshot.status,
      detail: snapshot.detail,
    });

    const title = alertTitle(project.name, snapshot.status);
    if (await alreadyNotified(title)) {
      result.skipped.push(`${title} already notified`);
      continue;
    }

    const body = [
      `Lane: ${project.name}`,
      `Status: ${snapshot.status}`,
      snapshot.productionUrl ? `URL: ${snapshot.productionUrl}` : null,
      snapshot.deployHost ? `Host: ${snapshot.deployHost}` : null,
      snapshot.detail,
    ]
      .filter(Boolean)
      .join("\n");

    await createNotification({
      title,
      body,
      level: "nudge",
      projectId: project.id,
    });
    result.notified.push(title);
  }

  return result;
}
