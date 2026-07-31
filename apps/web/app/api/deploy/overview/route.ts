import { NextResponse } from "next/server";
import { listProjects, seedIfEmpty } from "@/lib/db/queries";
import { isLaneDeployConfigured } from "@/lib/deploy/status";

export const runtime = "nodejs";

/** Lightweight production status list for the hub strip. */
export async function GET() {
  await seedIfEmpty();
  const projects = await listProjects("active");
  const lanes = projects
    .filter(isLaneDeployConfigured)
    .map((project) => ({
      id: project.id,
      name: project.name,
      productionUrl: project.productionUrl,
      deployHost: project.deployHost,
      deployProjectId: project.deployProjectId,
      status: project.deployStatus,
      detail: project.deployStatusDetail,
      checkedAt: project.deployCheckedAt,
    }))
    .sort((a, b) => {
      const rank = (status: string | null | undefined) => {
        if (status === "down") return 0;
        if (status === "degraded") return 1;
        if (status === "building") return 2;
        if (status === "unknown") return 3;
        return 4;
      };
      const diff = rank(a.status) - rank(b.status);
      if (diff !== 0) return diff;
      return a.name.localeCompare(b.name);
    });

  const counts = {
    total: lanes.length,
    ok: lanes.filter((lane) => lane.status === "ok").length,
    building: lanes.filter((lane) => lane.status === "building").length,
    degraded: lanes.filter((lane) => lane.status === "degraded").length,
    down: lanes.filter((lane) => lane.status === "down").length,
    unknown: lanes.filter((lane) => lane.status === "unknown").length,
  };

  return NextResponse.json({ lanes, counts, at: new Date().toISOString() });
}
