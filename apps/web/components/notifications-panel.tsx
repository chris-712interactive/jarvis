"use client";

import { useCallback, useEffect, useState } from "react";
import type { InterruptLevel } from "@/lib/db/schema";

type NotificationRow = {
  id: string;
  title: string;
  body: string;
  level: InterruptLevel;
  read: boolean;
  createdAt: string | Date;
  projectId: string | null;
  jobId: string | null;
};

function formatWhen(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);
  const diff = Date.now() - date.getTime();
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
  return date.toLocaleDateString();
}

export function NotificationsPanel() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationRow[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/notifications");
      if (!res.ok) return;
      const data = (await res.json()) as {
        notifications: NotificationRow[];
        unreadCount: number;
      };
      setItems(data.notifications);
      setUnreadCount(data.unreadCount);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => {
      void load();
    }, 5000);
    return () => window.clearInterval(id);
  }, [load]);

  async function markRead(id: string) {
    await fetch(`/api/notifications/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ read: true }),
    });
    await load();
  }

  async function markAllRead() {
    await fetch("/api/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ markAllRead: true }),
    });
    await load();
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => {
          setOpen((v) => !v);
          if (!open) void load();
        }}
        className="relative inline-flex items-center gap-2 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.22em] text-ink-soft transition-colors hover:text-beam"
        aria-expanded={open}
        aria-label="Notifications"
      >
        Alerts
        {unreadCount > 0 ? (
          <span className="inline-flex min-w-[1.25rem] items-center justify-center bg-signal px-1 py-0.5 font-[family-name:var(--font-display)] text-[11px] font-bold tabular-nums text-[var(--void)]">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="absolute right-0 top-full z-40 mt-2 w-[min(92vw,22rem)] border border-beam/25 bg-[color-mix(in_oklab,var(--panel-strong)_96%,black)] shadow-[0_18px_50px_rgba(0,0,0,0.55)]">
          <div className="flex items-center justify-between gap-3 border-b border-beam/15 px-4 py-3">
            <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-beam">
              notifications
            </p>
            <button
              type="button"
              onClick={() => void markAllRead()}
              className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-soft hover:text-flight disabled:opacity-40"
              disabled={unreadCount === 0}
            >
              Clear
            </button>
          </div>

          <ul className="max-h-80 overflow-y-auto">
            {loading && items.length === 0 ? (
              <li className="px-4 py-6 text-sm text-ink-soft">Loading…</li>
            ) : items.length === 0 ? (
              <li className="px-4 py-6 text-sm text-ink-soft">
                No signals yet. Async jobs will report here.
              </li>
            ) : (
              items.map((item) => (
                <li
                  key={item.id}
                  className={`border-b border-beam/10 px-4 py-3 ${
                    item.read ? "opacity-60" : ""
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-[family-name:var(--font-display)] text-sm font-bold tracking-tight text-ink">
                        {item.title}
                      </p>
                      {item.body ? (
                        <p className="mt-1 text-xs leading-relaxed text-ink-soft">
                          {item.body}
                        </p>
                      ) : null}
                      <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.18em] text-ink-soft/70">
                        {item.level} · {formatWhen(item.createdAt)}
                      </p>
                    </div>
                    {!item.read ? (
                      <button
                        type="button"
                        onClick={() => void markRead(item.id)}
                        className="shrink-0 font-mono text-[10px] uppercase tracking-[0.16em] text-flight hover:text-beam"
                      >
                        Ack
                      </button>
                    ) : null}
                  </div>
                </li>
              ))
            )}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
