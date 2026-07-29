"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

type ProcessPayload = {
  claimed?: string[];
  finished?: string[];
  skipped?: string[];
};

/**
 * Tick the local job runner and refresh the RSC dashboard when work moves.
 * Keeps a slower poll even when hangar looks empty so chat-started jobs appear.
 */
export function JobPoller({ hasInFlight }: { hasInFlight: boolean }) {
  const router = useRouter();
  const busy = useRef(false);

  useEffect(() => {
    let cancelled = false;

    async function tick() {
      if (busy.current || cancelled) return;
      busy.current = true;
      try {
        const res = await fetch("/api/jobs/process", { method: "POST" });
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as ProcessPayload;
        const moved =
          (data.claimed?.length ?? 0) > 0 ||
          (data.finished?.length ?? 0) > 0 ||
          (data.skipped?.length ?? 0) > 0;
        if (moved || hasInFlight) {
          router.refresh();
        }
      } catch {
        // Ignore transient poll errors; next interval retries.
      } finally {
        busy.current = false;
      }
    }

    void tick();
    const id = window.setInterval(
      () => {
        void tick();
      },
      hasInFlight ? 2500 : 5000,
    );

    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [hasInFlight, router]);

  return null;
}
