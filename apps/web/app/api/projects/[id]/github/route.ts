import { NextResponse } from "next/server";
import { getProject, seedIfEmpty } from "@/lib/db/queries";
import {
  getRepoSummary,
  listOpenPullRequests,
  GitHubError,
} from "@/lib/github/repo";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  await seedIfEmpty();
  const { id } = await params;
  const project = await getProject(id);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }
  if (!project.repoUrl) {
    return NextResponse.json(
      { error: `Project "${project.name}" has no repo URL configured.` },
      { status: 400 },
    );
  }

  const { searchParams } = new URL(request.url);
  const view = searchParams.get("view") ?? "summary";

  try {
    if (view === "prs") {
      const prs = await listOpenPullRequests(project.repoUrl);
      return NextResponse.json({
        projectId: project.id,
        repoUrl: project.repoUrl,
        pullRequests: prs,
      });
    }

    const summary = await getRepoSummary(project.repoUrl);
    return NextResponse.json({
      projectId: project.id,
      repoUrl: project.repoUrl,
      summary,
    });
  } catch (error) {
    if (error instanceof GitHubError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "GitHub request failed" }, { status: 500 });
  }
}
