import { NextResponse } from "next/server";
import { getJob, seedIfEmpty, updateJob } from "@/lib/db/queries";
import { updateJobSchema } from "@/lib/validation";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  await seedIfEmpty();
  const { id } = await params;
  const job = await getJob(id);
  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }
  return NextResponse.json({ job });
}

export async function PATCH(request: Request, { params }: Params) {
  await seedIfEmpty();
  const { id } = await params;
  const body = await request.json().catch(() => null);
  const parsed = updateJobSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid job patch", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const job = await updateJob(id, {
    ...parsed.data,
    artifactUrl: parsed.data.artifactUrl,
  });
  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }
  return NextResponse.json({ job });
}
