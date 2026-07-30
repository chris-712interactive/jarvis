import Link from "next/link";
import { notFound } from "next/navigation";
import { SiteHeader } from "@/components/site-header";
import { ProjectForm } from "@/components/project-form";
import { VaultNotesPanel } from "@/components/vault-notes-panel";
import { getProject, listJobs, seedIfEmpty } from "@/lib/db/queries";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

export default async function ProjectDetailPage({ params }: Params) {
  await seedIfEmpty();
  const { id } = await params;
  const project = await getProject(id);
  if (!project) notFound();

  const projectJobs = await listJobs({ projectId: project.id });

  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-[1400px] flex-1 px-5 py-14 sm:px-8">
        <Link
          href="/"
          className="font-mono text-xs uppercase tracking-[0.2em] text-ink-soft transition-colors hover:text-beam"
        >
          ← command center
        </Link>

        <div className="mt-8 grid gap-8 xl:grid-cols-[1.05fr_0.95fr]">
          <div className="space-y-8">
            <section className="hud-frame px-5 py-6 sm:px-6">
              <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-beam">
                {project.status} {"//"} {project.interruptLevel}
              </p>
              <h1 className="mt-3 font-[family-name:var(--font-display)] text-4xl font-extrabold tracking-tight sm:text-5xl">
                {project.name}
              </h1>
              <p className="mt-4 max-w-xl text-lg leading-relaxed text-ink-soft">
                {project.goal || "No goal set yet — assign an objective."}
              </p>
              {project.needsYou ? (
                <div className="mt-6 border-l-2 border-signal pl-4">
                  <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-signal">
                    needs you
                  </p>
                  <p className="mt-2 text-sm text-ink">{project.needsYou}</p>
                </div>
              ) : null}
              {project.repoUrl ? (
                <p className="mt-6 text-sm">
                  <a
                    href={project.repoUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="font-mono text-beam underline decoration-beam/40 underline-offset-4 hover:decoration-beam"
                  >
                    {project.repoUrl}
                  </a>
                </p>
              ) : null}
              {project.vaultPath ? (
                <p className="mt-3 font-mono text-[11px] uppercase tracking-[0.16em] text-ink-soft">
                  vault // {project.vaultPath}
                </p>
              ) : null}
              {project.gaPropertyId ? (
                <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.16em] text-ink-soft">
                  ga4 // {project.gaPropertyId}
                </p>
              ) : null}
              {project.contentChannel || project.dailyContent ? (
                <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.16em] text-ink-soft">
                  content // {project.contentChannel || "channel"}
                  {project.dailyContent ? " · daily on" : " · daily off"}
                </p>
              ) : null}
              {project.notes ? (
                <p className="mt-6 whitespace-pre-wrap text-sm leading-relaxed text-ink-soft">
                  {project.notes}
                </p>
              ) : null}

              <div className="mt-10">
                <h2 className="font-[family-name:var(--font-display)] text-2xl font-bold tracking-tight">
                  Lane jobs
                </h2>
                {projectJobs.length === 0 ? (
                  <p className="mt-4 font-mono text-xs uppercase tracking-[0.16em] text-ink-soft">
                    hangar empty
                  </p>
                ) : (
                  <ul className="mt-4 space-y-3">
                    {projectJobs.map((job) => (
                      <li
                        key={job.id}
                        className="border border-line bg-[color-mix(in_oklab,var(--panel)_90%,transparent)] px-4 py-3"
                        style={{
                          clipPath:
                            "polygon(8px 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%, 0 8px)",
                        }}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <p className="font-medium">{job.title}</p>
                          <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-soft/80">
                            {job.status.replace("_", " ")}
                          </span>
                        </div>
                        {job.summary ? (
                          <p className="mt-1 text-sm text-ink-soft">{job.summary}</p>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>

            <VaultNotesPanel projectId={project.id} vaultPath={project.vaultPath} />
          </div>

          <section className="hud-frame px-5 py-6 sm:px-6">
            <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-beam">
              {"//"} reconfigure
            </p>
            <h2 className="mt-2 font-[family-name:var(--font-display)] text-2xl font-bold tracking-tight">
              Edit lane
            </h2>
            <p className="mt-2 text-sm text-ink-soft">
              Update goals, blockers, vault path, and interrupt level.
            </p>
            <div className="mt-6">
              <ProjectForm
                mode="edit"
                projectId={project.id}
                initial={{
                  name: project.name,
                  goal: project.goal,
                  status: project.status,
                  repoUrl: project.repoUrl ?? "",
                  notes: project.notes,
                  vaultPath: project.vaultPath ?? "",
                  needsYou: project.needsYou ?? "",
                  gaPropertyId: project.gaPropertyId ?? "",
                  contentChannel: project.contentChannel ?? "",
                  contentBrief: project.contentBrief ?? "",
                  dailyContent: Boolean(project.dailyContent),
                  interruptLevel: project.interruptLevel,
                }}
              />
            </div>
          </section>
        </div>
      </main>
    </>
  );
}
