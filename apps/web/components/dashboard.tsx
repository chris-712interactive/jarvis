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

function StatusChip({ tone }: { tone: "signal" | "flight" | "muted" }) {
  const color =
    tone === "signal"
      ? "bg-signal"
      : tone === "flight"
        ? "bg-flight"
        : "bg-ink-soft/35";
  return (
    <span
      className={`live-dot mt-1.5 shrink-0 ${color} ${tone !== "muted" ? "lane-pulse" : ""}`}
      aria-hidden
    />
  );
}

function SectionLabel({
  children,
  tone = "beam",
}: {
  children: React.ReactNode;
  tone?: "beam" | "signal" | "flight";
}) {
  const color =
    tone === "signal"
      ? "text-signal"
      : tone === "flight"
        ? "text-flight-deep"
        : "text-beam";
  return (
    <p
      className={`font-mono text-[11px] uppercase tracking-[0.28em] ${color}`}
    >
      {"//"}
      {children}
    </p>
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
      ? "Hey — you've got company."
      : inFlightCount > 0
        ? "Engines are humming."
        : "Ready when you are.";

  const support =
    needsCount > 0
      ? `${needsCount} thing${needsCount === 1 ? "" : "s"} need a human call. Everything else can keep flying.`
      : inFlightCount > 0
        ? `${inFlightCount} job${inFlightCount === 1 ? "" : "s"} spinning across ${projectCount} lane${projectCount === 1 ? "" : "s"} while you do literally anything else.`
        : "Spin up a project lane and I’ll hold the board — coffee runs count as deep work.";

  const tickerItems = [
    `lanes:${projectCount}`,
    `alerts:${needsCount}`,
    `inflight:${inFlightCount}`,
    "mode:command",
    "voice:coming_soon",
    "agents:standby",
    "fun:enabled",
  ];

  return (
    <section className="relative mx-auto flex min-h-[78vh] w-full max-w-6xl flex-col justify-center px-5 pb-14 pt-16 sm:px-8 sm:pt-20">
      <div className="orbit-ring hidden md:block" aria-hidden />

      <div className="relative">
        <div className="animate-rise inline-flex items-center gap-2 border border-flight/40 bg-white/50 px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.22em] text-flight-deep">
          <span className="live-dot bg-flight" />
          live uplink
        </div>

        <p className="animate-rise-delay-1 brand-mark mt-6 font-[family-name:var(--font-display)] text-6xl font-extrabold uppercase leading-[0.9] tracking-[0.04em] sm:text-8xl md:text-9xl">
          Jarvis
        </p>

        <h1 className="animate-rise-delay-2 mt-6 max-w-2xl font-[family-name:var(--font-display)] text-3xl font-bold leading-tight tracking-tight text-ink sm:text-5xl">
          {headline}
        </h1>

        <p className="animate-rise-delay-3 mt-5 max-w-xl text-base leading-relaxed text-ink-soft sm:text-lg">
          {support}
        </p>

        <div className="animate-rise-delay-4 mt-8 flex flex-wrap gap-3">
          <a href="#needs-you" className="btn-signal">
            Check alerts
          </a>
          <Link href="/projects/new" className="btn-ghost">
            Open a new lane
          </Link>
        </div>
      </div>

      <div className="animate-rise-delay-4 relative mt-14 hud-frame px-4 py-3">
        <div className="ticker font-mono text-xs uppercase tracking-[0.2em] text-ink-soft">
          <div className="ticker-track">
            {[...tickerItems, ...tickerItems].map((item, i) => (
              <span key={`${item}-${i}`} className="inline-flex items-center gap-2">
                <span className="inline-block h-1.5 w-1.5 rotate-45 bg-beam" />
                {item}
              </span>
            ))}
          </div>
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
    <section id="needs-you" className="mx-auto w-full max-w-6xl px-5 py-14 sm:px-8">
      <div className="mb-6">
        <SectionLabel tone="signal">priority queue</SectionLabel>
        <h2 className="mt-2 font-[family-name:var(--font-display)] text-3xl font-bold tracking-tight sm:text-4xl">
          Needs you
        </h2>
        <p className="mt-2 max-w-xl text-ink-soft">
          Only the stuff that actually requires a human. Merge? Publish? Call it?
        </p>
      </div>

      {empty ? (
        <div className="hud-frame px-5 py-8">
          <p className="font-mono text-sm uppercase tracking-[0.18em] text-flight-deep">
            all clear // no blockers
          </p>
          <p className="mt-2 max-w-lg text-ink-soft">
            Nice. When something fails or needs a decision, it drops in here with
            a little drama.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {projects.map((project) => (
            <li key={`p-${project.id}`} className="hud-frame hud-frame-signal px-4 py-4 sm:px-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex items-start gap-3">
                  <StatusChip tone="signal" />
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
                <span className="pl-5 font-mono text-[11px] uppercase tracking-[0.2em] text-signal sm:pl-0">
                  project alert
                </span>
              </div>
            </li>
          ))}
          {jobs.map((job) => (
            <li key={`j-${job.id}`} className="hud-frame hud-frame-signal px-4 py-4 sm:px-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex items-start gap-3">
                  <StatusChip tone="signal" />
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
                  </div>
                </div>
                <span className="pl-5 font-mono text-[11px] uppercase tracking-[0.2em] text-signal sm:pl-0">
                  {job.status.replace("_", " ")}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function InFlightSection({ jobs }: { jobs: JobWithProject[] }) {
  return (
    <section id="in-flight" className="mx-auto w-full max-w-6xl px-5 py-14 sm:px-8">
      <div className="mb-6">
        <SectionLabel tone="flight">async workforce</SectionLabel>
        <h2 className="mt-2 font-[family-name:var(--font-display)] text-3xl font-bold tracking-tight sm:text-4xl">
          In flight
        </h2>
        <p className="mt-2 max-w-xl text-ink-soft">
          These keep moving while you’re elsewhere. Come back when they’re loud.
        </p>
      </div>

      {jobs.length === 0 ? (
        <div className="hud-frame hud-frame-flight px-5 py-8">
          <p className="font-mono text-sm uppercase tracking-[0.18em] text-flight-deep">
            hangar empty // waiting for launch
          </p>
          <p className="mt-2 max-w-lg text-ink-soft">
            Queue a mission and this lane lights up. Phase 3 wires the real
            agent dispatch.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {jobs.map((job) => (
            <li
              key={job.id}
              className="sweep-bar hud-frame hud-frame-flight px-4 py-4 sm:px-5"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-3">
                  <StatusChip tone="flight" />
                  <div>
                    <p className="font-[family-name:var(--font-display)] text-lg font-bold tracking-tight">
                      {job.title}
                    </p>
                    <p className="mt-1 text-sm text-ink-soft">
                      {job.project?.name ?? "Unknown project"}
                      {job.summary ? ` — ${job.summary}` : ""}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3 pl-5 sm:pl-0">
                  <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-flight-deep">
                    {job.status}
                  </span>
                  <span className="font-mono text-xs text-ink-soft/70">
                    {formatRelative(job.updatedAt)}
                  </span>
                </div>
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
    <section id="projects" className="mx-auto w-full max-w-6xl px-5 py-14 sm:px-8">
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <SectionLabel>mission board</SectionLabel>
          <h2 className="mt-2 font-[family-name:var(--font-display)] text-3xl font-bold tracking-tight sm:text-4xl">
            Project lanes
          </h2>
          <p className="mt-2 max-w-xl text-ink-soft">
            Every active outcome stream. Tap in, update the goal, keep rolling.
          </p>
        </div>
        <Link href="/projects/new" className="btn-ghost hidden sm:inline-flex">
          + Add
        </Link>
      </div>

      {projects.length === 0 ? (
        <p className="text-ink-soft">No projects yet — go make one.</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {projects.map((project, index) => (
            <li key={project.id}>
              <Link
                href={`/projects/${project.id}`}
                className="group hud-frame block h-full px-5 py-5 transition-transform duration-300 hover:-translate-y-1"
              >
                <div className="flex items-start justify-between gap-3">
                  <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-beam">
                    lane {String(index + 1).padStart(2, "0")}
                  </span>
                  <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-soft/70">
                    {project.status}
                  </span>
                </div>
                <p className="mt-3 font-[family-name:var(--font-display)] text-2xl font-bold tracking-tight">
                  {project.name}
                </p>
                <p className="mt-2 line-clamp-2 text-sm text-ink-soft">
                  {project.goal || "No goal set yet — give me something to chase."}
                </p>
                <p className="mt-4 font-mono text-xs uppercase tracking-[0.18em] text-ink-soft transition-colors group-hover:text-flight-deep">
                  enter lane →
                </p>
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
    <section className="mx-auto w-full max-w-6xl px-5 py-14 sm:px-8">
      <SectionLabel>mission log</SectionLabel>
      <h2 className="mt-2 font-[family-name:var(--font-display)] text-3xl font-bold tracking-tight sm:text-4xl">
        Recent wins
      </h2>
      <ul className="mt-6 space-y-3">
        {jobs.map((job) => (
          <li
            key={job.id}
            className="flex items-start gap-3 border-l-2 border-beam/50 pl-4 text-sm"
          >
            <StatusChip tone="muted" />
            <div>
              <p className="font-medium text-ink">{job.title}</p>
              <p className="font-mono text-xs uppercase tracking-[0.14em] text-ink-soft">
                {job.project?.name ?? "Project"} · {formatRelative(job.updatedAt)}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
