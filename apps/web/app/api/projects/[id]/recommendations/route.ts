import { NextResponse } from "next/server";

import { generateLaneRecommendations } from "@/lib/analytics/recommendations";
import { getProject, seedIfEmpty } from "@/lib/db/queries";
import { canWriteVaultNote } from "@/lib/trust/policy";

export const runtime = "nodejs";
export const maxDuration = 120;

type Params = { params: Promise<{ id: string }> };

/**
 * Goal-aligned growth recommendations from GA4 + Search Console.
 * GET /api/projects/:id/recommendations?ga4Days=28&gscDays=28&coverage=1&writeVault=0
 */
export async function GET(request: Request, { params }: Params) {
  await seedIfEmpty();
  const { id } = await params;
  const project = await getProject(id);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const { searchParams } = new URL(request.url);
  const ga4Days = Number(searchParams.get("ga4Days") ?? "28");
  const gscDays = Number(searchParams.get("gscDays") ?? "28");
  const includeCoverage =
    searchParams.get("coverage") !== "0" &&
    searchParams.get("coverage") !== "false";
  const writeVaultRequested =
    searchParams.get("writeVault") === "1" ||
    searchParams.get("writeVault") === "true";
  const skipLlm =
    searchParams.get("skipLlm") === "1" ||
    searchParams.get("skipLlm") === "true";

  const writeVault =
    writeVaultRequested && canWriteVaultNote(project.trustLevel);

  try {
    const result = await generateLaneRecommendations({
      project,
      ga4Days: Number.isFinite(ga4Days) ? ga4Days : 28,
      gscDays: Number.isFinite(gscDays) ? gscDays : 28,
      includeCoverage,
      writeVault,
      skipLlm,
    });
    return NextResponse.json({
      recommendations: result,
      note:
        writeVaultRequested && !writeVault
          ? "Vault write skipped — lane trust is below drafter."
          : undefined,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Recommendations failed";
    console.error("[recommendations] failed", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
