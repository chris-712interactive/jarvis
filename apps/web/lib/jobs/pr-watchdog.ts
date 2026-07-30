import {
  createNotification,
  listNotifications,
} from "@/lib/db/notifications";
import { listProjects } from "@/lib/db/queries";
import {
  getPullRequestCiStatus,
  listOpenPullRequests,
  parseGithubRepoUrl,
} from "@/lib/github/repo";

export type PrWatchdogResult = {
  scanned: number;
  failing: Array<{
    projectId: string;
    projectName: string;
    prNumber: number;
    title: string;
    htmlUrl: string;
    failingChecks: string[];
  }>;
  notified: string[];
  skipped: string[];
  errors: string[];
};

function alertTitle(repoLabel: string, prNumber: number) {
  return `CI failing: ${repoLabel}#${prNumber}`;
}

async function alreadyNotified(title: string) {
  const rows = await listNotifications({ limit: 100 });
  // Avoid re-alerting while an unread alert exists, or any alert from the last day.
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

/** Scan open PRs on active lanes; notify once when CI is failing. */
export async function runPrWatchdog(options?: {
  maxPrsPerRepo?: number;
}): Promise<PrWatchdogResult> {
  const maxPrs = options?.maxPrsPerRepo ?? 8;
  const projects = await listProjects("active");
  const withRepos = projects.filter((p) => parseGithubRepoUrl(p.repoUrl));

  const result: PrWatchdogResult = {
    scanned: 0,
    failing: [],
    notified: [],
    skipped: [],
    errors: [],
  };

  for (const project of withRepos) {
    const repoUrl = project.repoUrl!;
    const parsed = parseGithubRepoUrl(repoUrl)!;
    const repoLabel = `${parsed.owner}/${parsed.repo}`;

    let prs;
    try {
      prs = await listOpenPullRequests(repoUrl, maxPrs);
    } catch (error) {
      result.errors.push(
        `${repoLabel}: ${error instanceof Error ? error.message : "list PRs failed"}`,
      );
      continue;
    }

    for (const pr of prs) {
      if (pr.draft) {
        result.skipped.push(`${repoLabel}#${pr.number} draft`);
        continue;
      }
      result.scanned += 1;

      let status;
      try {
        status = await getPullRequestCiStatus(repoUrl, pr.number);
      } catch (error) {
        result.errors.push(
          `${repoLabel}#${pr.number}: ${error instanceof Error ? error.message : "CI status failed"}`,
        );
        continue;
      }

      if (status.state !== "failure" && status.state !== "error") {
        continue;
      }

      const failingNames = status.failing.map((f) => f.name);
      result.failing.push({
        projectId: project.id,
        projectName: project.name,
        prNumber: pr.number,
        title: pr.title,
        htmlUrl: status.htmlUrl,
        failingChecks: failingNames,
      });

      const title = alertTitle(repoLabel, pr.number);
      if (await alreadyNotified(title)) {
        result.skipped.push(`${title} already notified`);
        continue;
      }

      const body = [
        `Lane: ${project.name}`,
        `PR: #${pr.number} ${pr.title}`,
        failingNames.length
          ? `Failing checks: ${failingNames.join(", ")}`
          : "Combined CI status is failing.",
        status.htmlUrl,
      ].join("\n");

      await createNotification({
        title,
        body,
        level: "nudge",
        projectId: project.id,
      });
      result.notified.push(title);
    }
  }

  return result;
}
