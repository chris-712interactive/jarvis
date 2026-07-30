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
        ? "text-flight"
        : "text-beam";
  return (
    <p className={`font-mono text-[10px] uppercase tracking-[0.32em] ${color}`}>
      {children}
    </p>
  );
}

function Metric({
  label,
  value,
  tone = "beam",
}: {
  label: string;
  value: string | number;
  tone?: "beam" | "signal" | "flight";
}) {
  const color =
    tone === "signal"
      ? "text-signal"
      : tone === "flight"
        ? "text-flight"
        : "text-beam";
  return (
    <div className="min-w-[4.5rem]">
      <p className="font-mono text-[9px] uppercase tracking-[0.28em] text-ink-soft/80">
        {label}
      </p>
      <p
        className={`mt-1 font-[family-name:var(--font-display)] text-2xl font-bold tabular-nums tracking-tight ${color}`}
      >
        {value}
      </p>
    </div>
  );
}

function RadialCore({
  needsCount,
  inFlightCount,
  projectCount,
}: {
  needsCount: number;
  inFlightCount: number;
  projectCount: number;
}) {
  const alertRatio = Math.min(needsCount / Math.max(projectCount, 1), 1);
  const flightRatio = Math.min(inFlightCount / Math.max(projectCount * 2, 1), 1);
  const alertArc = 220 * alertRatio;
  const flightArc = 220 * flightRatio;

  return (
    <div className="hud-core relative mx-auto aspect-square w-full max-w-[520px]">
      <svg
        className="hud-core-svg absolute inset-0 h-full w-full"
        viewBox="0 0 400 400"
        aria-hidden
      >
        <defs>
          <radialGradient id="coreGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="rgb(110, 243, 255)" stopOpacity="0.35" />
            <stop offset="45%" stopColor="rgb(77, 232, 255)" stopOpacity="0.08" />
            <stop offset="100%" stopColor="transparent" stopOpacity="0" />
          </radialGradient>
        </defs>

        <circle cx="200" cy="200" r="188" fill="url(#coreGlow)" />

        <circle
          cx="200"
          cy="200"
          r="175"
          fill="none"
          stroke="rgba(77,232,255,0.18)"
          strokeWidth="1"
          strokeDasharray="2 10"
          className="hud-spin-slow"
        />
        <circle
          cx="200"
          cy="200"
          r="152"
          fill="none"
          stroke="rgba(77,232,255,0.28)"
          strokeWidth="1.5"
        />
        <circle
          cx="200"
          cy="200"
          r="128"
          fill="none"
          stroke="rgba(61,255,210,0.22)"
          strokeWidth="1"
          strokeDasharray="18 14"
          className="hud-spin-reverse"
        />
        <circle
          cx="200"
          cy="200"
          r="96"
          fill="none"
          stroke="rgba(77,232,255,0.45)"
          strokeWidth="2"
        />
        <circle
          cx="200"
          cy="200"
          r="72"
          fill="none"
          stroke="rgba(110,243,255,0.2)"
          strokeWidth="8"
        />

        {/* Priority arc */}
        <circle
          cx="200"
          cy="200"
          r="152"
          fill="none"
          stroke="rgba(255,107,61,0.85)"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={`${alertArc} 999`}
          transform="rotate(-110 200 200)"
          className="hud-arc"
        />
        {/* Active arc */}
        <circle
          cx="200"
          cy="200"
          r="128"
          fill="none"
          stroke="rgba(61,255,210,0.9)"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={`${flightArc} 999`}
          transform="rotate(40 200 200)"
          className="hud-arc"
        />

        {/* Crosshair ticks */}
        <g stroke="rgba(77,232,255,0.55)" strokeWidth="1.5">
          <line x1="200" y1="18" x2="200" y2="42" />
          <line x1="200" y1="358" x2="200" y2="382" />
          <line x1="18" y1="200" x2="42" y2="200" />
          <line x1="358" y1="200" x2="382" y2="200" />
        </g>

        <circle cx="200" cy="200" r="28" fill="rgba(6,22,40,0.75)" stroke="rgba(110,243,255,0.7)" strokeWidth="2" />
        <circle cx="200" cy="200" r="10" fill="rgba(61,255,210,0.95)" className="hud-core-pulse" />
      </svg>

      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        <p className="font-mono text-[10px] uppercase tracking-[0.35em] text-ink-soft">
          {needsCount > 0 ? "attention" : inFlightCount > 0 ? "nominal" : "standby"}
        </p>
        <p className="mt-2 font-[family-name:var(--font-display)] text-5xl font-bold tabular-nums tracking-tight text-ink sm:text-6xl">
          {String(needsCount).padStart(2, "0")}
        </p>
        <p className="mt-1 max-w-[10rem] font-mono text-[10px] uppercase tracking-[0.22em] text-ink-soft">
          {needsCount === 1 ? "priority item" : "priority items"}
        </p>
      </div>
    </div>
  );
}

export function Hero({
  needsCount,
  inFlightCount,
  projectCount,
  topAlert,
}: {
  needsCount: number;
  inFlightCount: number;
  projectCount: number;
  topAlert?: { title: string; detail: string; href?: string };
}) {
  const statusLine =
    needsCount > 0
      ? "Human decision required"
      : inFlightCount > 0
        ? "Background protocols active"
        : "All lanes clear — awaiting objective";

  return (
    <section className="relative flex min-h-[calc(100svh-4.5rem)] w-full flex-col justify-between px-5 pb-8 pt-6 sm:px-8 sm:pb-10 sm:pt-8">
      <div className="mx-auto grid w-full max-w-[1400px] flex-1 items-center gap-8 lg:grid-cols-[1fr_minmax(280px,520px)_1fr] lg:gap-6">
        {/* Left peripheral */}
        <aside className="animate-rise order-2 space-y-4 lg:order-1">
          <SectionLabel tone="signal">priority feed</SectionLabel>
          {topAlert ? (
            <div className="hud-frame hud-frame-signal px-4 py-4">
              <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-signal">
                requires input
              </p>
              <p className="mt-3 font-[family-name:var(--font-display)] text-xl font-bold tracking-tight">
                {topAlert.href ? (
                  <Link href={topAlert.href} className="hover:text-signal">
                    {topAlert.title}
                  </Link>
                ) : (
                  topAlert.title
                )}
              </p>
              <p className="mt-2 text-sm leading-relaxed text-ink-soft">
                {topAlert.detail}
              </p>
              <a
                href="#needs-you"
                className="mt-4 inline-flex font-mono text-[10px] uppercase tracking-[0.22em] text-signal"
              >
                open queue →
              </a>
            </div>
          ) : (
            <div className="hud-frame px-4 py-4">
              <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-flight">
                queue clear
              </p>
              <p className="mt-3 text-sm leading-relaxed text-ink-soft">
                No blockers. Systems continue unsupervised.
              </p>
            </div>
          )}

          <div className="hidden gap-6 border-t border-beam/15 pt-4 lg:flex">
            <Metric label="Alerts" value={String(needsCount).padStart(2, "0")} tone="signal" />
            <Metric label="Active" value={String(inFlightCount).padStart(2, "0")} tone="flight" />
            <Metric label="Lanes" value={String(projectCount).padStart(2, "0")} />
          </div>
        </aside>

        {/* Center radial */}
        <div className="animate-rise-delay-1 order-1 lg:order-2">
          <RadialCore
            needsCount={needsCount}
            inFlightCount={inFlightCount}
            projectCount={projectCount}
          />
          <div className="mt-6 text-center">
            <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold tracking-tight text-ink sm:text-3xl">
              {statusLine}
            </h1>
            <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-ink-soft">
              {needsCount > 0
                ? "Review the priority feed, then return to deep work."
                : inFlightCount > 0
                  ? `${inFlightCount} process${inFlightCount === 1 ? "" : "es"} running across ${projectCount} lane${projectCount === 1 ? "" : "s"}.`
                  : "Initialize a project lane to begin tracking outcomes."}
            </p>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
              <a href="#needs-you" className="btn-signal !text-xs uppercase tracking-[0.14em]">
                Priority queue
              </a>
              <Link href="/projects/new" className="btn-ghost !text-xs uppercase tracking-[0.14em]">
                New lane
              </Link>
            </div>
          </div>
        </div>

        {/* Right peripheral */}
        <aside className="animate-rise-delay-2 order-3 space-y-4">
          <SectionLabel tone="flight">telemetry</SectionLabel>
          <div className="hud-frame hud-frame-flight px-4 py-4">
            <div className="flex items-center justify-between gap-3">
              <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-flight">
                in flight
              </p>
              <span className="font-[family-name:var(--font-display)] text-2xl font-bold tabular-nums text-flight">
                {String(inFlightCount).padStart(2, "0")}
              </span>
            </div>
            <div className="mt-4 h-1.5 overflow-hidden bg-flight/10">
              <div
                className="h-full bg-flight transition-all duration-700"
                style={{
                  width: `${Math.min(100, (inFlightCount / Math.max(projectCount * 2, 1)) * 100)}%`,
                }}
              />
            </div>
            <p className="mt-3 text-sm text-ink-soft">
              {inFlightCount > 0
                ? "Workers progressing. Interrupt only on threshold breach."
                : "Hangar empty. Queue a mission to illuminate this rail."}
            </p>
            <a
              href="#in-flight"
              className="mt-4 inline-flex font-mono text-[10px] uppercase tracking-[0.22em] text-flight"
            >
              inspect active →
            </a>
          </div>

          <div className="hud-frame px-4 py-4">
            <div className="flex items-center justify-between gap-3">
              <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-beam">
                project matrix
              </p>
              <span className="font-[family-name:var(--font-display)] text-2xl font-bold tabular-nums text-beam">
                {String(projectCount).padStart(2, "0")}
              </span>
            </div>
            <p className="mt-3 text-sm text-ink-soft">
              Outcome streams under watch. Enter a lane to reconfigure goals.
            </p>
            <a
              href="#projects"
              className="mt-4 inline-flex font-mono text-[10px] uppercase tracking-[0.22em] text-beam"
            >
              open matrix →
            </a>
          </div>
        </aside>
      </div>

      {/* Bottom telemetry strip */}
      <div className="animate-rise-delay-3 mx-auto mt-8 w-full max-w-[1400px]">
        <div className="hud-frame px-3 py-2.5 sm:px-4">
          <div className="ticker font-mono text-[10px] uppercase tracking-[0.22em] text-ink-soft">
            <div className="ticker-track">
              {[
                `priority:${needsCount}`,
                `active:${inFlightCount}`,
                `lanes:${projectCount}`,
                "link:stable",
                "voice:standby",
                "agents:armed",
                "mode:command",
                `priority:${needsCount}`,
                `active:${inFlightCount}`,
                `lanes:${projectCount}`,
                "link:stable",
                "voice:standby",
                "agents:armed",
                "mode:command",
              ].map((item, i) => (
                <span key={`${item}-${i}`} className="inline-flex items-center gap-2">
                  <span className="inline-block h-1 w-1 rotate-45 bg-beam" />
                  {item}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export { NeedsYouSection } from "./needs-you-panel";

export function InFlightSection({ jobs }: { jobs: JobWithProject[] }) {
  return (
    <section id="in-flight" className="mx-auto w-full max-w-[1400px] px-5 py-16 sm:px-8">
      <div className="mb-8 flex items-end justify-between gap-4 border-b border-beam/15 pb-4">
        <div>
          <SectionLabel tone="flight">02 // active</SectionLabel>
          <h2 className="mt-2 font-[family-name:var(--font-display)] text-3xl font-bold tracking-tight sm:text-4xl">
            In flight
          </h2>
        </div>
        <p className="hidden max-w-sm text-right text-sm text-ink-soft sm:block">
          Keep moving without babysitting.
        </p>
      </div>

      {jobs.length === 0 ? (
        <div className="hud-frame hud-frame-flight px-5 py-8">
          <p className="font-mono text-sm uppercase tracking-[0.18em] text-flight">
            hangar empty
          </p>
          <p className="mt-2 max-w-lg text-ink-soft">
            Queue a mission and this lane illuminates.
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
                    {job.artifactUrl?.startsWith("http") ? (
                      <a
                        href={job.artifactUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-2 inline-block font-mono text-[11px] text-flight underline-offset-2 hover:underline"
                      >
                        open agent →
                      </a>
                    ) : null}
                  </div>
                </div>
                <div className="flex items-center gap-3 pl-5 sm:pl-0">
                  <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-flight">
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
    <section id="projects" className="mx-auto w-full max-w-[1400px] px-5 py-16 sm:px-8">
      <div className="mb-8 flex items-end justify-between gap-4 border-b border-beam/15 pb-4">
        <div>
          <SectionLabel>03 // matrix</SectionLabel>
          <h2 className="mt-2 font-[family-name:var(--font-display)] text-3xl font-bold tracking-tight sm:text-4xl">
            Projects
          </h2>
        </div>
        <Link href="/projects/new" className="btn-ghost hidden !text-xs uppercase tracking-[0.14em] sm:inline-flex">
          + Add
        </Link>
      </div>

      {projects.length === 0 ? (
        <p className="text-ink-soft">No projects yet.</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {projects.map((project, index) => (
            <li key={project.id}>
              <Link
                href={`/projects/${project.id}`}
                className="group hud-frame block h-full px-5 py-5 transition-transform duration-300 hover:-translate-y-0.5"
              >
                <div className="flex items-start justify-between gap-3">
                  <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-beam">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-soft/70">
                    {project.status}
                  </span>
                </div>
                <p className="mt-3 font-[family-name:var(--font-display)] text-xl font-bold tracking-tight">
                  {project.name}
                </p>
                <p className="mt-2 line-clamp-2 text-sm text-ink-soft">
                  {project.goal || "No goal set — assign an objective."}
                </p>
                <p className="mt-4 font-mono text-[10px] uppercase tracking-[0.2em] text-ink-soft transition-colors group-hover:text-flight">
                  enter →
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
    <section className="mx-auto w-full max-w-[1400px] px-5 py-16 sm:px-8">
      <div className="mb-8 border-b border-beam/15 pb-4">
        <SectionLabel>04 // log</SectionLabel>
        <h2 className="mt-2 font-[family-name:var(--font-display)] text-3xl font-bold tracking-tight sm:text-4xl">
          Recent
        </h2>
      </div>
      <ul className="space-y-3">
        {jobs.map((job) => (
          <li
            key={job.id}
            className="flex items-start gap-3 border-l border-beam/40 pl-4 text-sm"
          >
            <StatusChip tone="muted" />
            <div>
              <p className="font-medium text-ink">{job.title}</p>
              <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-soft">
                {job.project?.name ?? "Project"} · {formatRelative(job.updatedAt)}
              </p>
              {job.artifactUrl ? (
                job.artifactUrl.startsWith("http") ? (
                  <a
                    href={job.artifactUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1 inline-block font-mono text-[11px] text-flight underline-offset-2 hover:underline"
                  >
                    {job.artifactUrl.includes("pull")
                      ? "pr // open →"
                      : "agent // open →"}
                  </a>
                ) : (
                  <p className="mt-1 font-mono text-[11px] text-flight">
                    vault // {job.artifactUrl}
                  </p>
                )
              ) : job.summary ? (
                <p className="mt-1 text-xs text-ink-soft line-clamp-2">{job.summary}</p>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
