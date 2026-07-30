import { NextResponse } from "next/server";
import { getProject, seedIfEmpty } from "@/lib/db/queries";
import {
  Ga4Error,
  getPropertySummary,
  isGa4Configured,
} from "@/lib/analytics/ga4";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  await seedIfEmpty();
  const { id } = await params;
  const project = await getProject(id);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }
  if (!project.gaPropertyId) {
    return NextResponse.json(
      {
        error: `Project "${project.name}" has no GA4 property id configured.`,
      },
      { status: 400 },
    );
  }
  if (!isGa4Configured()) {
    return NextResponse.json(
      {
        error:
          "GA4 credentials missing. Set GA4_SERVICE_ACCOUNT_JSON or GOOGLE_APPLICATION_CREDENTIALS.",
      },
      { status: 503 },
    );
  }

  const { searchParams } = new URL(request.url);
  const daysRaw = Number(searchParams.get("days") ?? "7");
  const days = Number.isFinite(daysRaw) ? daysRaw : 7;

  try {
    const summary = await getPropertySummary(project.gaPropertyId, days);
    return NextResponse.json({
      projectId: project.id,
      projectName: project.name,
      gaPropertyId: project.gaPropertyId,
      summary,
    });
  } catch (error) {
    if (error instanceof Ga4Error) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "GA4 request failed" }, { status: 500 });
  }
}
