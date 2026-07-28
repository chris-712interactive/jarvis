import { NextResponse } from "next/server";
import {
  createProject,
  listProjects,
  seedIfEmpty,
} from "@/lib/db/queries";
import { createProjectSchema } from "@/lib/validation";

export const runtime = "nodejs";

export async function GET() {
  await seedIfEmpty();
  const projects = await listProjects();
  return NextResponse.json({ projects });
}

export async function POST(request: Request) {
  await seedIfEmpty();
  const body = await request.json().catch(() => null);
  const parsed = createProjectSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid project", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const project = await createProject({
    ...parsed.data,
    repoUrl: parsed.data.repoUrl ?? null,
    needsYou: parsed.data.needsYou ?? null,
  });

  return NextResponse.json({ project }, { status: 201 });
}
