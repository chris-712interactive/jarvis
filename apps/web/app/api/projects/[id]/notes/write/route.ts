import { NextResponse } from "next/server";
import { z } from "zod";
import { getProject, seedIfEmpty } from "@/lib/db/queries";
import { writeVaultNote, VaultError } from "@/lib/vault/notes";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

const writeNoteSchema = z.object({
  path: z.string().trim().min(1).max(240),
  content: z.string().max(200_000),
  overwrite: z.boolean().optional().default(true),
});

export async function POST(request: Request, { params }: Params) {
  await seedIfEmpty();
  const { id } = await params;
  const project = await getProject(id);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  const parsed = writeNoteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid note write", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const note = writeVaultNote(
      project.vaultPath,
      parsed.data.path,
      parsed.data.content,
      { overwrite: parsed.data.overwrite },
    );
    return NextResponse.json({ note }, { status: 201 });
  } catch (error) {
    if (error instanceof VaultError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Vault write failed" }, { status: 500 });
  }
}
