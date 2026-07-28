import { getState } from "@/lib/store";
import {
  addProjectAction,
  setStatusAction,
  toggleNeedsYouAction,
} from "./actions";
import type { Job, Project } from "@/lib/types";

export const dynamic = "force-dynamic";

function StatusPill({ status }: { status: Project["status"] }) {
  const tone =
    status === "active"
      ? "bg-emerald-500/15 text-emerald-300"
      : status === "paused"
      ? "bg-amber-500/15 text-amber-300"
      : "bg-slate-500/15 text-slate-300";
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${tone}`}>
      {status}
    </span>
  );
}

function JobRow({ job, projectName }: { job: Job; projectName: string }) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-edge bg-panel px-4 py-3">
      <div>
        <div className="text-sm font-medium">{job.title}</div>
        <div className="text-xs text-muted">
          {projectName} · {job.kind}
        </div>
      </div>
      <span className="rounded-full bg-sky-500/15 px-2 py-0.5 text-xs font-medium text-sky-300">
        {job.status}
      </span>
    </div>
  );
}

export default async function DashboardPage() {
  const state = await getState();
  const projectName = (id: string) =>
    state.projects.find((p) => p.id === id)?.name ?? "unassigned";

  const needsYou = state.projects.filter((p) => p.needsYou);
  const inFlight = state.jobs.filter(
    (j) => j.status === "running" || j.status === "queued"
  );

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <header className="mb-10">
        <div className="flex items-baseline justify-between">
          <h1 className="text-3xl font-semibold tracking-tight">Jarvis</h1>
          <span className="text-sm text-muted">Command Center</span>
        </div>
        <p className="mt-2 text-lg text-muted">What needs me?</p>
      </header>

      <section className="mb-10">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">
          Needs you
        </h2>
        {needsYou.length === 0 ? (
          <p className="rounded-lg border border-edge bg-panel px-4 py-6 text-sm text-muted">
            Nothing needs you right now.
          </p>
        ) : (
          <div className="space-y-2">
            {needsYou.map((p) => (
              <div
                key={p.id}
                className="flex items-center justify-between rounded-lg border border-rose-500/30 bg-rose-500/5 px-4 py-3"
              >
                <div>
                  <div className="text-sm font-medium">{p.name}</div>
                  <div className="text-xs text-muted">{p.goal}</div>
                </div>
                <form action={toggleNeedsYouAction}>
                  <input type="hidden" name="id" value={p.id} />
                  <button className="rounded-md border border-edge px-3 py-1 text-xs hover:bg-edge">
                    Resolve
                  </button>
                </form>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="mb-10">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">
          In flight
        </h2>
        {inFlight.length === 0 ? (
          <p className="rounded-lg border border-edge bg-panel px-4 py-6 text-sm text-muted">
            No background jobs running.
          </p>
        ) : (
          <div className="space-y-2">
            {inFlight.map((j) => (
              <JobRow key={j.id} job={j} projectName={projectName(j.projectId)} />
            ))}
          </div>
        )}
      </section>

      <section className="mb-10">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">
          Projects
        </h2>
        <div className="space-y-2">
          {state.projects.map((p) => (
            <div
              key={p.id}
              className="flex items-center justify-between rounded-lg border border-edge bg-panel px-4 py-3"
            >
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{p.name}</span>
                  <StatusPill status={p.status} />
                  {p.needsYou && (
                    <span className="rounded-full bg-rose-500/15 px-2 py-0.5 text-xs font-medium text-rose-300">
                      needs you
                    </span>
                  )}
                </div>
                <div className="text-xs text-muted">
                  {p.goal || "No goal set"}
                  {p.source ? ` · ${p.source}` : ""}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <form action={toggleNeedsYouAction}>
                  <input type="hidden" name="id" value={p.id} />
                  <button className="rounded-md border border-edge px-3 py-1 text-xs hover:bg-edge">
                    {p.needsYou ? "Clear flag" : "Flag"}
                  </button>
                </form>
                <form action={setStatusAction}>
                  <input type="hidden" name="id" value={p.id} />
                  <input
                    type="hidden"
                    name="status"
                    value={p.status === "active" ? "paused" : "active"}
                  />
                  <button className="rounded-md border border-edge px-3 py-1 text-xs hover:bg-edge">
                    {p.status === "active" ? "Pause" : "Activate"}
                  </button>
                </form>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">
          Add a project
        </h2>
        <form
          action={addProjectAction}
          className="grid gap-3 rounded-lg border border-edge bg-panel p-4 sm:grid-cols-3"
        >
          <input
            name="name"
            required
            placeholder="Name (e.g. carline-dad)"
            className="rounded-md border border-edge bg-ink px-3 py-2 text-sm outline-none focus:border-sky-500"
          />
          <input
            name="goal"
            placeholder="Current goal"
            className="rounded-md border border-edge bg-ink px-3 py-2 text-sm outline-none focus:border-sky-500"
          />
          <input
            name="source"
            placeholder="Source (repo / doc)"
            className="rounded-md border border-edge bg-ink px-3 py-2 text-sm outline-none focus:border-sky-500"
          />
          <div className="sm:col-span-3">
            <button className="rounded-md bg-sky-500 px-4 py-2 text-sm font-medium text-ink hover:bg-sky-400">
              Create project
            </button>
          </div>
        </form>
      </section>
    </main>
  );
}
