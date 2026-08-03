import { NextResponse } from "next/server";
import { getJob, getProject, seedIfEmpty } from "@/lib/db/queries";
import { readVaultBinary, VaultError } from "@/lib/vault/notes";

export const runtime = "nodejs";

type Params = { params: Promise<{ jobId: string }> };

/**
 * Public image URL for Meta Instagram Content Publishing.
 * Requires a matching mediaToken on the job (no session cookies).
 */
export async function GET(request: Request, { params }: Params) {
  await seedIfEmpty();
  const { jobId } = await params;
  const url = new URL(request.url);
  const token = url.searchParams.get("token")?.trim() || "";

  if (!token) {
    return NextResponse.json({ error: "Missing token" }, { status: 401 });
  }

  const job = await getJob(jobId);
  if (!job || !job.mediaPath || !job.mediaToken) {
    return NextResponse.json({ error: "Media not found" }, { status: 404 });
  }
  if (job.mediaToken !== token) {
    return NextResponse.json({ error: "Invalid token" }, { status: 403 });
  }

  const project = await getProject(job.projectId);
  if (!project?.vaultPath) {
    return NextResponse.json({ error: "Vault unavailable" }, { status: 404 });
  }

  try {
    const media = readVaultBinary(project.vaultPath, job.mediaPath);
    return new NextResponse(new Uint8Array(media.bytes), {
      status: 200,
      headers: {
        "Content-Type": media.mimeType,
        "Cache-Control": "private, max-age=300",
        "Content-Length": String(media.bytes.byteLength),
      },
    });
  } catch (error) {
    const message =
      error instanceof VaultError
        ? error.message
        : error instanceof Error
          ? error.message
          : "Failed to read media";
    const status = error instanceof VaultError ? error.status : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
