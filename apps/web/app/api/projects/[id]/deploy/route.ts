import { NextResponse } from "next/server";
import { getProject, seedIfEmpty } from "@/lib/db/queries";
import { DeployError } from "@/lib/deploy/status";
import { refreshProjectDeployStatus } from "@/lib/jobs/deploy-watchdog";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  await seedIfEmpty();
  const { id } = await params;
  const project = await getProject(id);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const { searchParams } = new URL(request.url);
  const refresh =
    searchParams.get("refresh") === "1" ||
    searchParams.get("refresh") === "true";

  if (!refresh) {
    return NextResponse.json({
      projectId: project.id,
      projectName: project.name,
      productionUrl: project.productionUrl,
      deployHost: project.deployHost,
      deployProjectId: project.deployProjectId,
      status: project.deployStatus,
      detail: project.deployStatusDetail,
      checkedAt: project.deployCheckedAt,
      cached: true,
    });
  }

  if (
    !project.productionUrl?.trim() &&
    !project.deployProjectId?.trim()
  ) {
    return NextResponse.json(
      {
        error: `Project "${project.name}" has no productionUrl or deployProjectId configured.`,
      },
      { status: 400 },
    );
  }

  try {
    const snapshot = await refreshProjectDeployStatus(project);
    return NextResponse.json({
      ...snapshot,
      cached: false,
    });
  } catch (error) {
    if (error instanceof DeployError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: "Deploy status check failed" },
      { status: 500 },
    );
  }
}
