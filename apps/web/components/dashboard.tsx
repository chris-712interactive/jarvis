import Link from "next/link";
import type { Job, Project } from "@/lib/db/schema";

type JobWithProject = Job & { project: Project | null };

function formatRelative(date: Date) {
  const delta = Date.now() - date.getTime();
  const mins = Math.round(delta / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

function StatusDot({ tone }: { tone: "signal" | "flight" | "muted" }) {
  const color =
    tone === "signal"
      ? "bg-signal"
      : tone === "flight"
        ? "bg-flight"
        : "bg-ink-soft/40";
  return (
    <span
      className={`inline-block h-2 w-2 rounded-full ${color} ${tone !== "muted" ? "lane-pulse" : ""}`}
      aria-hidden
    />
  );
}

export function Hero({
  needsCount,
  inFlightCount,
  projectCount,
}: {
  needsCount: number;
  inFlightCount: number;
  projectCount: number;
}) {
  const headline =
    needsCount > 0
      ? "Something needs you."
      : inFlightCount > 0
        ? "Work is moving."
        : "All quiet on the lanes.";

  const support =
    needsCount > 0
      ? `${needsCount} item${needsCount === 1 ? "" : "s"} waiting for a decision. Everything else can keep running.`
      : inFlightCount > 0
        ? `${inFlightCount} job${inFlightCount === 1 ? "" : "s"} in flight across ${projectCount} project${projectCount === 1 ? "" : "s"}.`
        : "Add a project or queue a job — Jarvis will hold the board while you focus.";

  return (
    <section className="relative mx-auto flex min-h-[72vh] w-full max-w-6xl flex-col justify-center px-6 pb-16 pt-20 sm:px-8 sm:pt-24">
      <div className="pointer-events-none absolute inset-0 jarvis-grid opacity-70" />
      <div className="relative">
        <p className="animate-rise font-[family-name:var(--font-display)] text-5xl font-extrabold tracking-tight text-ink sm:text-7xl md:text-8xl">
          Jarvis
        </p>
        <h1 className="animate-rise-delay-1 mt-6 max-w-2xl font-[family-name:var(--font-display)] text-3xl font-semibold leading-tight tracking-tight text-ink-soft sm:text-4xl md:text-5xl">
          {headline}
        </h1>
        <p className="animate-rise-delay-2 mt-5 max-w-xl text-base leading-relaxed text-ink-soft/85 sm:text-lg">
          {support}
        </p>
        <div className="animate-rise-delay-3 mt-8 flex flex-wrap gap-3">
          <a
            href="#needs-you"
            className="rounded-md bg-signal px-4 py-2.5 text-sm font-semibold text-white transition-transform duration-300 hover:-translate-y-0.5"
          >
            Review what needs you
          </a>
          <Link
            href="/projects/new"
            className="rounded-md border border-line bg-white/50 px-4 py-2.5 text-sm font-medium text-ink transition-colors hover:bg-white"
          >
            Add a project
          </Link>
        </div>
      </div>
    </section>
  );
}

export function NeedsYouSection({
  projects,
  jobs,
}: {
  projects: Project[];
  jobs: JobWithProject[];
}) {
  const empty = projects.length === 0 && jobs.length === 0;

  return (
    <section id="needs-you" className="mx-auto w-full max-w-6xl px-6 py-16 sm:px-8">
      <div className="mb-8 flex items-end justify-between gap-4">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-signal">
            Needs you
          </p>
          <h2 className="mt-2 font-[family-name:var(--font-display)] text-3xl font-semibold tracking-tight">
            Decisions only you can make
          </h2>
        </div>
      </div>

      {empty ? (
        <p className="max-w-lg text-ink-soft/80">
          Nothing is blocked. When a job fails or asks for a merge, publish, or
          spend decision, it lands here.
        </p>
      ) : (
        <ul className="divide-y divide-line border-y border-line">
          {projects.map((project) => (
            <li key={`p-${project.id}`} className="flex flex-col gap-2 py-5 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex items-start gap-3">
                <StatusDot tone="signal" />
                <div>
                  <Link
                    href={`/projects/${project.id}`}
                    className="font-medium text-ink hover:underline"
                  >
                    {project.name}
                  </Link>
                  <p className="mt-1 max-w-2xl text-sm leading-relaxed text-ink-soft">
                    {project.needsYou}
                  </p>
                </div>
              </div>
              <span className="pl-5 font-mono text-[11px] uppercase tracking-[0.16em] text-ink-soft/70 sm:pl-0">
                project
              </span>
            </li>
          ))}
          {jobs.map((job) => (
            <li key={`j-${job.id}`} className="flex flex-col gap-2 py-5 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex items-start gap-3">
                <StatusDot tone="signal" />
                <div>
                  <p className="font-medium text-ink">{job.title}</p>
                  <p className="mt-1 max-w-2xl text-sm leading-relaxed text-ink-soft">
                    {job.summary || "Needs a decision."}
                    {job.project ? (
                      <>
                        {" "}
                        <Link
                          href={`/projects/${job.project.id}`}
                          className="underline decoration-line underline-offset-2 hover:text-ink"
                        >
                          {job.project.name}
                        </Link>
                      </>
                    ) : null}
                  </p>
                </div>
              </div>
              <span className="pl-5 font-mono text-[11px] uppercase tracking-[0.16em] text-ink-soft/70 sm:pl-0">
                {job.status.replace("_", " ")}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function InFlightSection({ jobs }: { jobs: JobWithProject[] }) {
  return (
    <section id="in-flight" className="mx-auto w-full max-w-6xl px-6 py-16 sm:px-8">
      <div className="mb-8">
        <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-flight">
          In flight
        </p>
        <h2 className="mt-2 font-[family-name:var(--font-display)] text-3xl font-semibold tracking-tight">
          Running while you do something else
        </h2>
      </div>

      {jobs.length === 0 ? (
        <p className="max-w-lg text-ink-soft/80">
          No queued or running jobs. Phase 3 will dispatch durable workers from
          chat; for now you can create jobs via the API.
        </p>
      ) : (
        <ul className="space-y-3">
          {jobs.map((job) => (
            <li
              key={job.id}
              className="sweep-bar flex flex-col gap-2 border border-line bg-white/40 px-4 py-4 backdrop-blur-sm sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex items-start gap-3">
                <StatusDot tone="flight" />
                <div>
                  <p className="font-medium">{job.title}</p>
                  <p className="mt-1 text-sm text-ink-soft">
                    {job.project?.name ?? "Unknown project"}
                    {job.summary ? ` — ${job.summary}` : ""}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3 pl-5 sm:pl-0">
                <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-flight">
                  {job.status}
                </span>
                <span className="text-xs text-ink-soft/70">
                  {formatRelative(job.updatedAt)}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function ProjectsSection({ projects }: { projects: Project[] }) {
  return (
    <section id="projects" className="mx-auto w-full max-w-6xl px-6 py-16 sm:px-8">
      <div className="mb-8 flex items-end justify-between gap-4">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-ink-soft/70">
            Projects
          </p>
          <h2 className="mt-2 font-[family-name:var(--font-display)] text-3xl font-semibold tracking-tight">
            Active lanes
          </h2>
        </div>
        <Link
          href="/projects/new"
          className="text-sm font-medium text-ink underline decoration-line underline-offset-4 hover:decoration-ink"
        >
          Add project
        </Link>
      </div>

      {projects.length === 0 ? (
        <p className="text-ink-soft/80">No projects yet.</p>
      ) : (
        <ul className="divide-y divide-line border-y border-line">
          {projects.map((project) => (
            <li key={project.id}>
              <Link
                href={`/projects/${project.id}`}
                className="group flex flex-col gap-2 py-5 transition-colors sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <div className="flex items-center gap-3">
                    <span className="font-[family-name:var(--font-display)] text-xl font-semibold tracking-tight group-hover:text-ink">
                      {project.name}
                    </span>
                    <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-soft/60">
                      {project.status}
                    </span>
                  </div>
                  <p className="mt-1 max-w-2xl text-sm text-ink-soft">
                    {project.goal || "No goal set yet."}
                  </p>
                </div>
                <span className="text-sm text-ink-soft/70 transition-transform duration-300 group-hover:translate-x-1">
                  Open →
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function RecentSection({ jobs }: { jobs: JobWithProject[] }) {
  if (jobs.length === 0) return null;
  return (
    <section className="mx-auto w-full max-w-6xl px-6 py-16 sm:px-8">
      <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-ink-soft/70">
        Recent outcomes
      </p>
      <h2 className="mt-2 font-[family-name:var(--font-display)] text-3xl font-semibold tracking-tight">
        Finished since you last looked
      </h2>
      <ul className="mt-8 space-y-4">
        {jobs.map((job) => (
          <li key={job.id} className="flex items-start gap-3 text-sm">
            <StatusDot tone="muted" />
            <div>
              <p className="font-medium text-ink">{job.title}</p>
              <p className="text-ink-soft">
                {job.project?.name ?? "Project"} · {formatRelative(job.updatedAt)}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
