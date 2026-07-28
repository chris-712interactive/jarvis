import { NextResponse } from "next/server";
import { createJob, listJobs, seedIfEmpty } from "@/lib/db/queries";
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

  const job = await createJob({
    ...parsed.data,
    artifactUrl: parsed.data.artifactUrl ?? null,
  });
  return NextResponse.json({ job }, { status: 201 });
}
