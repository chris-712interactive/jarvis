import { NextResponse } from "next/server";
import { getProject, seedIfEmpty } from "@/lib/db/queries";
import {
  GscError,
  getSearchConsoleSummary,
  isGscConfigured,
} from "@/lib/analytics/gsc";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  await seedIfEmpty();
  const { id } = await params;
  const project = await getProject(id);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }
  if (!project.gscSiteUrl) {
    return NextResponse.json(
      {
        error: `Project "${project.name}" has no Search Console site configured.`,
      },
      { status: 400 },
    );
  }
  if (!isGscConfigured()) {
    return NextResponse.json(
      {
        error:
          "Search Console credentials missing. Set GA4_SERVICE_ACCOUNT_JSON (or GSC_SERVICE_ACCOUNT_JSON) / GOOGLE_APPLICATION_CREDENTIALS.",
      },
      { status: 503 },
    );
  }

  const { searchParams } = new URL(request.url);
  const daysRaw = Number(searchParams.get("days") ?? "28");
  const days = Number.isFinite(daysRaw) ? daysRaw : 28;

  try {
    const summary = await getSearchConsoleSummary(project.gscSiteUrl, days);
    return NextResponse.json({
      projectId: project.id,
      projectName: project.name,
      gscSiteUrl: project.gscSiteUrl,
      summary,
    });
  } catch (error) {
    if (error instanceof GscError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: "Search Console request failed" },
      { status: 500 },
    );
  }
}
