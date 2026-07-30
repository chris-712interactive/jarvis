export class GitHubError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "GitHubError";
    this.status = status;
  }
}

export type ParsedRepo = {
  owner: string;
  repo: string;
  url: string;
};

export type RepoSummary = {
  fullName: string;
  description: string | null;
  defaultBranch: string;
  openIssues: number;
  stars: number;
  pushedAt: string | null;
  htmlUrl: string;
  private: boolean;
};

export type OpenPullRequest = {
  number: number;
  title: string;
  state: string;
  draft: boolean;
  author: string | null;
  htmlUrl: string;
  updatedAt: string;
  head: string;
  base: string;
};

/** Parse https://github.com/owner/repo(.git)? URLs (and ssh form). */
export function parseGithubRepoUrl(repoUrl: string | null | undefined): ParsedRepo | null {
  if (!repoUrl?.trim()) return null;
  const raw = repoUrl.trim();

  const https = raw.match(
    /^https?:\/\/github\.com\/([^/]+)\/([^/#?]+?)(?:\.git)?\/?$/i,
  );
  if (https) {
    return {
      owner: https[1],
      repo: https[2],
      url: `https://github.com/${https[1]}/${https[2]}`,
    };
  }

  const ssh = raw.match(/^git@github\.com:([^/]+)\/([^/#?]+?)(?:\.git)?$/i);
  if (ssh) {
    return {
      owner: ssh[1],
      repo: ssh[2],
      url: `https://github.com/${ssh[1]}/${ssh[2]}`,
    };
  }

  return null;
}

function githubHeaders() {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "jarvis-command-hub",
  };
  const token = process.env.GITHUB_TOKEN?.trim();
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function githubFetch<T>(path: string): Promise<T> {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: githubHeaders(),
    cache: "no-store",
  });

  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = (await res.json()) as { message?: string };
      if (body.message) detail = body.message;
    } catch {
      // keep statusText
    }
    if (res.status === 401 || res.status === 403) {
      throw new GitHubError(
        `${detail} — set GITHUB_TOKEN in apps/web/.env.local for private repos or higher rate limits.`,
        res.status,
      );
    }
    if (res.status === 404) {
      throw new GitHubError(
        "Repository not found (or private without GITHUB_TOKEN).",
        404,
      );
    }
    throw new GitHubError(detail || "GitHub request failed", res.status);
  }

  return (await res.json()) as T;
}

export async function getRepoSummary(repoUrl: string): Promise<RepoSummary> {
  const parsed = parseGithubRepoUrl(repoUrl);
  if (!parsed) {
    throw new GitHubError("Not a GitHub repo URL", 400);
  }

  const data = await githubFetch<{
    full_name: string;
    description: string | null;
    default_branch: string;
    open_issues_count: number;
    stargazers_count: number;
    pushed_at: string | null;
    html_url: string;
    private: boolean;
  }>(`/repos/${parsed.owner}/${parsed.repo}`);

  return {
    fullName: data.full_name,
    description: data.description,
    defaultBranch: data.default_branch,
    openIssues: data.open_issues_count,
    stars: data.stargazers_count,
    pushedAt: data.pushed_at,
    htmlUrl: data.html_url,
    private: data.private,
  };
}

export async function listOpenPullRequests(
  repoUrl: string,
  limit = 12,
): Promise<OpenPullRequest[]> {
  const parsed = parseGithubRepoUrl(repoUrl);
  if (!parsed) {
    throw new GitHubError("Not a GitHub repo URL", 400);
  }

  const data = await githubFetch<
    Array<{
      number: number;
      title: string;
      state: string;
      draft: boolean;
      user: { login: string } | null;
      html_url: string;
      updated_at: string;
      head: { ref: string };
      base: { ref: string };
    }>
  >(
    `/repos/${parsed.owner}/${parsed.repo}/pulls?state=open&per_page=${Math.min(Math.max(limit, 1), 30)}&sort=updated`,
  );

  return data.map((pr) => ({
    number: pr.number,
    title: pr.title,
    state: pr.state,
    draft: pr.draft,
    author: pr.user?.login ?? null,
    htmlUrl: pr.html_url,
    updatedAt: pr.updated_at,
    head: pr.head.ref,
    base: pr.base.ref,
  }));
}
