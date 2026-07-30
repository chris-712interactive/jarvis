"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Job, Project } from "@/lib/db/schema";

type JobWithProject = Job & { project: Project | null };

function StatusChip() {
  return (
    <span
      className="live-dot lane-pulse mt-1.5 shrink-0 bg-signal"
      aria-hidden
    />
  );
}

export function NeedsYouSection({
  projects,
  jobs,
}: {
  projects: Project[];
  jobs: JobWithProject[];
}) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const empty = projects.length === 0 && jobs.length === 0;

  async function resolveProject(projectId: string) {
    setPendingId(`p-${projectId}`);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ needsYou: null }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? "Could not clear project alert");
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Resolve failed");
    } finally {
      setPendingId(null);
    }
  }

  async function resolveJob(jobId: string, title: string) {
    setPendingId(`j-${jobId}`);
    setError(null);
    try {
      const res = await fetch(`/api/jobs/${jobId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "done",
          summary: `Approved / resolved by operator. (${title})`,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? "Could not resolve job");
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Resolve failed");
    } finally {
      setPendingId(null);
    }
  }

  return (
    <section id="needs-you" className="mx-auto w-full max-w-[1400px] px-5 py-16 sm:px-8">
      <div className="mb-8 flex items-end justify-between gap-4 border-b border-beam/15 pb-4">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-signal">
            01 // priority
          </p>
          <h2 className="mt-2 font-[family-name:var(--font-display)] text-3xl font-bold tracking-tight sm:text-4xl">
            Needs you
          </h2>
        </div>
        <p className="hidden max-w-sm text-right text-sm text-ink-soft sm:block">
          Approve here — Obsidian notes do not clear this queue.
        </p>
      </div>

      {error ? (
        <p className="mb-4 text-sm text-signal">{error}</p>
      ) : null}

      {empty ? (
        <div className="hud-frame px-5 py-8">
          <p className="font-mono text-sm uppercase tracking-[0.18em] text-flight">
            all clear
          </p>
          <p className="mt-2 max-w-lg text-ink-soft">
            Failures and decision points surface here the moment they require you.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {projects.map((project) => (
            <li key={`p-${project.id}`} className="hud-frame hud-frame-signal px-4 py-4 sm:px-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex items-start gap-3">
                  <StatusChip />
                  <div>
                    <Link
                      href={`/projects/${project.id}`}
                      className="font-[family-name:var(--font-display)] text-lg font-bold tracking-tight hover:text-signal"
                    >
                      {project.name}
                    </Link>
                    <p className="mt-1 max-w-2xl text-sm leading-relaxed text-ink-soft">
                      {project.needsYou}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3 pl-5 sm:pl-0">
                  <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-signal">
                    project alert
                  </span>
                  <button
                    type="button"
                    onClick={() => void resolveProject(project.id)}
                    disabled={pendingId === `p-${project.id}`}
                    className="btn-ghost !px-3 !py-1.5 !text-[10px] uppercase tracking-[0.16em] disabled:opacity-50"
                  >
                    {pendingId === `p-${project.id}` ? "…" : "Resolve"}
                  </button>
                </div>
              </div>
            </li>
          ))}
          {jobs.map((job) => (
            <li key={`j-${job.id}`} className="hud-frame hud-frame-signal px-4 py-4 sm:px-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex items-start gap-3">
                  <StatusChip />
                  <div>
                    <p className="font-[family-name:var(--font-display)] text-lg font-bold tracking-tight">
                      {job.title}
                    </p>
                    <p className="mt-1 max-w-2xl text-sm leading-relaxed text-ink-soft">
                      {job.summary || "Needs a decision."}
                      {job.project ? (
                        <>
                          {" "}
                          <Link
                            href={`/projects/${job.project.id}`}
                            className="font-medium text-beam underline decoration-beam/40 underline-offset-2 hover:decoration-beam"
                          >
                            {job.project.name}
                          </Link>
                        </>
                      ) : null}
                    </p>
                    {job.emailFrom ? (
                      <p className="mt-2 font-mono text-[11px] text-ink-soft">
                        email // {job.emailFrom}
                        {job.emailReplySent
                          ? " · reply sent"
                          : job.emailReplyDraft
                            ? " · draft reply ready"
                            : " · triage"}
                      </p>
                    ) : null}
                    {job.emailReplyDraft ? (
                      <pre className="mt-3 max-h-40 overflow-y-auto whitespace-pre-wrap border border-beam/15 bg-[color-mix(in_oklab,var(--panel)_80%,transparent)] px-3 py-2 font-mono text-[11px] leading-relaxed text-ink-soft">
                        {job.emailReplyDraft}
                      </pre>
                    ) : null}
                  </div>
                </div>
                <div className="flex items-center gap-3 pl-5 sm:pl-0">
                  <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-signal">
                    {job.status.replace("_", " ")}
                  </span>
                  <button
                    type="button"
                    onClick={() => void resolveJob(job.id, job.title)}
                    disabled={pendingId === `j-${job.id}`}
                    className="btn-ghost !px-3 !py-1.5 !text-[10px] uppercase tracking-[0.16em] disabled:opacity-50"
                  >
                    {pendingId === `j-${job.id}`
                      ? "…"
                      : job.emailFrom && job.emailReplyDraft && !job.emailReplySent
                        ? "Approve & reply"
                        : job.emailFrom && !job.emailReplyDraft
                          ? "Resolve"
                          : "Approve"}
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
