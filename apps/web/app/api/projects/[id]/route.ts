import { NextResponse } from "next/server";
import {
  deleteProject,
  getProject,
  seedIfEmpty,
  updateProject,
} from "@/lib/db/queries";
import { updateProjectSchema } from "@/lib/validation";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  await seedIfEmpty();
  const { id } = await params;
  const project = await getProject(id);
  if (!project) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ project });
}

export async function PATCH(request: Request, { params }: Params) {
  await seedIfEmpty();
  const { id } = await params;
  const body = await request.json().catch(() => null);
  const parsed = updateProjectSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid project", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const project = await updateProject(id, {
    ...parsed.data,
    repoUrl: parsed.data.repoUrl,
    vaultPath: parsed.data.vaultPath,
    needsYou: parsed.data.needsYou,
    gaPropertyId: parsed.data.gaPropertyId,
    gscSiteUrl: parsed.data.gscSiteUrl,
    productionUrl: parsed.data.productionUrl,
    deployHost: parsed.data.deployHost,
    deployProjectId: parsed.data.deployProjectId,
    contentChannel: parsed.data.contentChannel,
    contentBrief: parsed.data.contentBrief,
    dailyContent: parsed.data.dailyContent,
    instagramUserId: parsed.data.instagramUserId,
    emailSenders: parsed.data.emailSenders,
  });
  if (!project) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ project });
}

export async function DELETE(_request: Request, { params }: Params) {
  await seedIfEmpty();
  const { id } = await params;
  const ok = await deleteProject(id);
  if (!ok) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
