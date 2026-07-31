"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type LaneDeploy = {
  id: string;
  name: string;
  productionUrl: string | null;
  deployHost: string | null;
  status: string | null;
  detail: string;
  checkedAt: string | Date | null;
};

type OverviewResponse = {
  lanes: LaneDeploy[];
  counts: {
    total: number;
    ok: number;
    building: number;
    degraded: number;
    down: number;
    unknown: number;
  };
  at: string;
};

function statusTone(status: string | null | undefined) {
  if (status === "ok") return "text-flight border-flight/35";
  if (status === "building") return "text-beam border-beam/35";
  if (status === "down" || status === "degraded") {
    return "text-signal border-signal/40";
  }
  return "text-ink-soft border-ink-soft/25";
}

function statusDot(status: string | null | undefined) {
  if (status === "ok") return "bg-flight";
  if (status === "building") return "bg-beam";
  if (status === "down" || status === "degraded") return "bg-signal";
  return "bg-ink-soft/40";
}

function shouldPulse(status: string | null | undefined) {
  return status === "ok" || status === "building";
}

export function ProductionStrip({
  initialLanes,
}: {
  initialLanes: LaneDeploy[];
}) {
  const [lanes, setLanes] = useState(initialLanes);

  useEffect(() => {
    setLanes(initialLanes);
  }, [initialLanes]);

  useEffect(() => {
    let cancelled = false;

    async function refresh() {
      try {
        const res = await fetch("/api/deploy/overview", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as OverviewResponse;
        if (!cancelled) setLanes(data.lanes);
      } catch {
        // keep last good snapshot
      }
    }

    const timer = window.setInterval(refresh, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  if (lanes.length === 0) {
    return (
      <section className="mx-auto w-full max-w-[1400px] px-5 py-6 sm:px-8">
        <div className="hud-frame px-4 py-4">
          <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-beam">
            production // offline map
          </p>
          <p className="mt-2 text-sm text-ink-soft">
            Add a production URL or Vercel/Railway project id on a lane to light
            this rail. Webhooks keep it current between cron ticks.
          </p>
        </div>
      </section>
    );
  }

  const down = lanes.filter(
    (lane) => lane.status === "down" || lane.status === "degraded",
  ).length;
  const building = lanes.filter((lane) => lane.status === "building").length;
  const ok = lanes.filter((lane) => lane.status === "ok").length;

  return (
    <section
      id="production"
      className="mx-auto w-full max-w-[1400px] px-5 py-6 sm:px-8"
    >
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.32em] text-beam">
            00 // production
          </p>
          <h2 className="mt-1 font-[family-name:var(--font-display)] text-2xl font-bold tracking-tight">
            Live environments
          </h2>
        </div>
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-soft">
          {ok} ok · {building} building · {down} alert · {lanes.length} monitored
        </p>
      </div>

      <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {lanes.map((lane) => (
          <li key={lane.id}>
            <Link
              href={`/projects/${lane.id}`}
              className={`hud-frame flex h-full flex-col gap-2 px-4 py-3 transition-transform duration-300 hover:-translate-y-0.5 ${statusTone(lane.status)}`}
              title={lane.detail || undefined}
            >
              <div className="flex items-start justify-between gap-3">
                <span className="font-[family-name:var(--font-display)] text-base font-bold tracking-tight text-ink">
                  {lane.name}
                </span>
                <span className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.16em]">
                  <span
                    className={`live-dot ${statusDot(lane.status)} ${
                      shouldPulse(lane.status) ? "lane-pulse" : ""
                    }`}
                  />
                  {lane.status || "unknown"}
                </span>
              </div>
              <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-soft">
                {lane.deployHost || "host?"}
                {lane.productionUrl ? " · url" : ""}
              </p>
              {lane.detail ? (
                <p className="line-clamp-2 text-xs leading-relaxed text-ink-soft">
                  {lane.detail}
                </p>
              ) : null}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
