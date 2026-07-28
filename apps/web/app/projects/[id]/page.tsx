import Link from "next/link";
import { notFound } from "next/navigation";
import { SiteHeader } from "@/components/site-header";
import { ProjectForm } from "@/components/project-form";
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
      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-16 sm:px-8">
        <Link
          href="/"
          className="text-sm text-ink-soft transition-colors hover:text-ink"
        >
          ← Command center
        </Link>

        <div className="mt-8 grid gap-12 lg:grid-cols-[1.1fr_0.9fr]">
          <section>
            <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-ink-soft/70">
              {project.status} · {project.interruptLevel}
            </p>
            <h1 className="mt-3 font-[family-name:var(--font-display)] text-4xl font-bold tracking-tight sm:text-5xl">
              {project.name}
            </h1>
            <p className="mt-4 max-w-xl text-lg leading-relaxed text-ink-soft">
              {project.goal || "No goal set yet."}
            </p>
            {project.needsYou ? (
              <p className="mt-6 border-l-2 border-signal pl-4 text-sm text-ink">
                <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-signal">
                  Needs you
                </span>
                <span className="mt-2 block">{project.needsYou}</span>
              </p>
            ) : null}
            {project.repoUrl ? (
              <p className="mt-6 text-sm">
                <a
                  href={project.repoUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="underline decoration-line underline-offset-4 hover:decoration-ink"
                >
                  {project.repoUrl}
                </a>
              </p>
            ) : null}
            {project.notes ? (
              <p className="mt-6 whitespace-pre-wrap text-sm leading-relaxed text-ink-soft">
                {project.notes}
              </p>
            ) : null}

            <div className="mt-12">
              <h2 className="font-[family-name:var(--font-display)] text-2xl font-semibold tracking-tight">
                Jobs
              </h2>
              {projectJobs.length === 0 ? (
                <p className="mt-4 text-sm text-ink-soft">No jobs yet.</p>
              ) : (
                <ul className="mt-4 divide-y divide-line border-y border-line">
                  {projectJobs.map((job) => (
                    <li key={job.id} className="py-4">
                      <div className="flex items-center justify-between gap-3">
                        <p className="font-medium">{job.title}</p>
                        <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-soft/70">
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

          <section>
            <h2 className="font-[family-name:var(--font-display)] text-2xl font-semibold tracking-tight">
              Edit
            </h2>
            <p className="mt-2 text-sm text-ink-soft">
              Update the goal, blockers, and interrupt preference.
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
                  needsYou: project.needsYou ?? "",
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
