"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

const statuses = ["active", "paused", "archived"] as const;
const interrupts = ["silent", "digest", "nudge", "interrupt"] as const;

const fieldClass =
  "w-full rounded-md border border-line bg-white/70 px-3 py-2.5 text-ink outline-none transition focus:border-ink/40 focus:ring-4 focus:ring-[color-mix(in_oklab,var(--glow-a)_45%,transparent)]";

export function ProjectForm({
  mode = "create",
  projectId,
  initial,
}: {
  mode?: "create" | "edit";
  projectId?: string;
  initial?: {
    name: string;
    goal: string;
    status: (typeof statuses)[number];
    repoUrl: string;
    notes: string;
    needsYou: string;
    interruptLevel: (typeof interrupts)[number];
  };
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    const form = new FormData(event.currentTarget);
    const payload = {
      name: String(form.get("name") ?? ""),
      goal: String(form.get("goal") ?? ""),
      status: String(form.get("status") ?? "active"),
      repoUrl: String(form.get("repoUrl") ?? "") || null,
      notes: String(form.get("notes") ?? ""),
      needsYou: String(form.get("needsYou") ?? "") || null,
      interruptLevel: String(form.get("interruptLevel") ?? "digest"),
    };

    const url =
      mode === "edit" && projectId
        ? `/api/projects/${projectId}`
        : "/api/projects";
    const method = mode === "edit" ? "PATCH" : "POST";

    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setError(data?.error ?? "Could not save project");
      setPending(false);
      return;
    }

    const data = await res.json();
    router.push(`/projects/${data.project.id}`);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="mx-auto w-full max-w-xl space-y-5">
      <Field label="Name" htmlFor="name">
        <input
          id="name"
          name="name"
          required
          defaultValue={initial?.name}
          className={fieldClass}
          placeholder="Jarvis"
        />
      </Field>

      <Field label="Current goal" htmlFor="goal">
        <textarea
          id="goal"
          name="goal"
          rows={3}
          defaultValue={initial?.goal}
          className={fieldClass}
          placeholder="What does done look like right now?"
        />
      </Field>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Status" htmlFor="status">
          <select
            id="status"
            name="status"
            defaultValue={initial?.status ?? "active"}
            className={fieldClass}
          >
            {statuses.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Interrupt level" htmlFor="interruptLevel">
          <select
            id="interruptLevel"
            name="interruptLevel"
            defaultValue={initial?.interruptLevel ?? "digest"}
            className={fieldClass}
          >
            {interrupts.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <Field label="Repo URL" htmlFor="repoUrl">
        <input
          id="repoUrl"
          name="repoUrl"
          type="url"
          defaultValue={initial?.repoUrl}
          className={fieldClass}
          placeholder="https://github.com/..."
        />
      </Field>

      <Field label="Needs you (optional)" htmlFor="needsYou">
        <input
          id="needsYou"
          name="needsYou"
          defaultValue={initial?.needsYou}
          className={fieldClass}
          placeholder="One sentence for the Needs you lane"
        />
      </Field>

      <Field label="Notes" htmlFor="notes">
        <textarea
          id="notes"
          name="notes"
          rows={4}
          defaultValue={initial?.notes}
          className={fieldClass}
          placeholder="Conventions, links, context Jarvis should remember."
        />
      </Field>

      {error ? <p className="text-sm text-signal">{error}</p> : null}

      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-ink px-4 py-2.5 text-sm font-semibold text-paper transition-opacity disabled:opacity-60"
      >
        {pending ? "Saving…" : mode === "edit" ? "Save changes" : "Create project"}
      </button>
    </form>
  );
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-2" htmlFor={htmlFor}>
      <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-ink-soft/70">
        {label}
      </span>
      {children}
    </label>
  );
}
