import { NextResponse } from "next/server";
import { getProject, seedIfEmpty } from "@/lib/db/queries";
import { readVaultNote, VaultError } from "@/lib/vault/notes";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  await seedIfEmpty();
  const { id } = await params;
  const project = await getProject(id);
  if (!project) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const notePath = new URL(request.url).searchParams.get("path")?.trim() ?? "";
  if (!notePath) {
    return NextResponse.json({ error: "path query is required" }, { status: 400 });
  }

  try {
    const note = readVaultNote(project.vaultPath, notePath);
    return NextResponse.json({ projectId: project.id, note });
  } catch (error) {
    if (error instanceof VaultError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
