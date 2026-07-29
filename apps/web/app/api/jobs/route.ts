import { NextResponse } from "next/server";
import { createJob, getProject, listJobs, seedIfEmpty } from "@/lib/db/queries";
import { kickJob } from "@/lib/jobs/runner";
import { createJobSchema } from "@/lib/validation";
import type { JobStatus } from "@/lib/db/schema";

export const runtime = "nodejs";

export async function GET(request: Request) {
  await seedIfEmpty();
  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status") as JobStatus | null;
  const projectId = searchParams.get("projectId") ?? undefined;
  const jobs = await listJobs({
    status: status ?? undefined,
    projectId,
  });
  return NextResponse.json({ jobs });
}

export async function POST(request: Request) {
  await seedIfEmpty();
  const body = await request.json().catch(() => null);
  const parsed = createJobSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid job", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const project = await getProject(parsed.data.projectId);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const job = await createJob({
    ...parsed.data,
    artifactUrl: parsed.data.artifactUrl ?? null,
  });

  // Claim immediately so it shows in "In flight"; poller finishes + writes vault.
  const claimed = await kickJob(job.id);

  return NextResponse.json({ job: claimed ?? job }, { status: 201 });
}
