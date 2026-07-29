import { NextResponse } from "next/server";
import { getProject, seedIfEmpty } from "@/lib/db/queries";
import {
  getVaultStatus,
  listVaultNotes,
  searchVaultNotes,
  VaultError,
} from "@/lib/vault/notes";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  await seedIfEmpty();
  const { id } = await params;
  const project = await getProject(id);
  if (!project) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const url = new URL(request.url);
  const query = url.searchParams.get("q")?.trim() ?? "";
  const status = getVaultStatus(project.vaultPath);

  if (!status.configured) {
    return NextResponse.json({
      projectId: project.id,
      status,
      notes: [],
      hits: [],
    });
  }

  try {
    if (query) {
      const hits = searchVaultNotes(project.vaultPath, query);
      return NextResponse.json({
        projectId: project.id,
        status,
        query,
        hits,
      });
    }

    const notes = listVaultNotes(project.vaultPath);
    return NextResponse.json({
      projectId: project.id,
      status,
      notes,
    });
  } catch (error) {
    if (error instanceof VaultError) {
      return NextResponse.json(
        { error: error.message, status },
        { status: error.status },
      );
    }
    throw error;
  }
}
