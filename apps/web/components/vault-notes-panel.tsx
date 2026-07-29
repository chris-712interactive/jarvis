"use client";

import { useCallback, useEffect, useState } from "react";

type VaultStatus = {
  configured: boolean;
  root: string | null;
  exists: boolean;
  readable: boolean;
  noteCount: number | null;
  error: string | null;
};

type NoteMeta = {
  path: string;
  title: string;
  bytes: number;
  updatedAt: string;
};

type SearchHit = {
  path: string;
  title: string;
  line: number;
  snippet: string;
};

type NoteBody = NoteMeta & {
  content: string;
  truncated: boolean;
};

export function VaultNotesPanel({
  projectId,
  vaultPath,
}: {
  projectId: string;
  vaultPath: string | null;
}) {
  const [status, setStatus] = useState<VaultStatus | null>(null);
  const [notes, setNotes] = useState<NoteMeta[]>([]);
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [query, setQuery] = useState("");
  const [activePath, setActivePath] = useState<string | null>(null);
  const [activeNote, setActiveNote] = useState<NoteBody | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const loadIndex = useCallback(
    async (search?: string) => {
      setLoading(true);
      setError(null);
      try {
        const qs = search?.trim()
          ? `?q=${encodeURIComponent(search.trim())}`
          : "";
        const res = await fetch(`/api/projects/${projectId}/notes${qs}`);
        const data = await res.json().catch(() => null);
        if (!res.ok) {
          setError(data?.error ?? "Could not read vault");
          setStatus(data?.status ?? null);
          setNotes([]);
          setHits([]);
          return;
        }
        setStatus(data.status);
        if (search?.trim()) {
          setHits(data.hits ?? []);
          setNotes([]);
        } else {
          setNotes(data.notes ?? []);
          setHits([]);
        }
      } finally {
        setLoading(false);
      }
    },
    [projectId],
  );

  const openNote = useCallback(
    async (notePath: string) => {
      setActivePath(notePath);
      setError(null);
      const res = await fetch(
        `/api/projects/${projectId}/notes/read?path=${encodeURIComponent(notePath)}`,
      );
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error ?? "Could not open note");
        setActiveNote(null);
        return;
      }
      setActiveNote(data.note);
    },
    [projectId],
  );

  useEffect(() => {
    void loadIndex();
  }, [loadIndex, vaultPath]);

  if (!vaultPath) {
    return (
      <div className="hud-frame px-5 py-5">
        <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-beam">
          obsidian vault
        </p>
        <p className="mt-3 text-sm text-ink-soft">
          Set a local vault path on this project to browse markdown notes
          read-only. Example:{" "}
          <span className="font-mono text-beam">~/Documents/Obsidian/Work</span>
        </p>
      </div>
    );
  }

  return (
    <div className="hud-frame px-5 py-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-beam">
            obsidian vault
          </p>
          <p className="mt-2 font-mono text-[11px] text-ink-soft break-all">
            {status?.root ?? vaultPath}
          </p>
        </div>
        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-flight">
          {status?.readable
            ? `${String(status.noteCount ?? 0).padStart(2, "0")} notes`
            : "offline"}
        </p>
      </div>

      {status?.error ? (
        <p className="mt-3 text-sm text-signal">{status.error}</p>
      ) : null}

      <form
        className="mt-4 flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void loadIndex(query);
        }}
      >
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="field !py-2"
          placeholder="Search vault…"
          aria-label="Search vault"
        />
        <button type="submit" className="btn-ghost !px-3 !py-2 !text-[11px] uppercase tracking-[0.14em]">
          Find
        </button>
        {query ? (
          <button
            type="button"
            className="btn-ghost !px-3 !py-2 !text-[11px] uppercase tracking-[0.14em]"
            onClick={() => {
              setQuery("");
              void loadIndex();
            }}
          >
            Clear
          </button>
        ) : null}
      </form>

      {error ? <p className="mt-3 text-sm text-signal">{error}</p> : null}
      {loading ? (
        <p className="mt-4 font-mono text-[10px] uppercase tracking-[0.2em] text-ink-soft">
          scanning…
        </p>
      ) : null}

      <div className="mt-4 grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
        <ul className="max-h-72 space-y-1 overflow-y-auto border border-beam/15 p-2">
          {hits.length > 0
            ? hits.map((hit) => (
                <li key={`${hit.path}:${hit.line}`}>
                  <button
                    type="button"
                    onClick={() => void openNote(hit.path)}
                    className={`w-full px-2 py-2 text-left transition-colors hover:bg-beam/10 ${
                      activePath === hit.path ? "bg-beam/10" : ""
                    }`}
                  >
                    <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-beam">
                      {hit.path}:{hit.line}
                    </p>
                    <p className="mt-1 text-sm text-ink-soft">{hit.snippet}</p>
                  </button>
                </li>
              ))
            : notes.map((note) => (
                <li key={note.path}>
                  <button
                    type="button"
                    onClick={() => void openNote(note.path)}
                    className={`w-full px-2 py-2 text-left transition-colors hover:bg-beam/10 ${
                      activePath === note.path ? "bg-beam/10" : ""
                    }`}
                  >
                    <p className="text-sm font-medium text-ink">{note.title}</p>
                    <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.16em] text-ink-soft">
                      {note.path}
                    </p>
                  </button>
                </li>
              ))}
          {!loading && notes.length === 0 && hits.length === 0 ? (
            <li className="px-2 py-3 text-sm text-ink-soft">No notes found.</li>
          ) : null}
        </ul>

        <div className="max-h-72 overflow-y-auto border border-beam/15 p-3">
          {activeNote ? (
            <>
              <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-beam">
                {activeNote.path}
                {activeNote.truncated ? " // truncated" : ""}
              </p>
              <pre className="mt-3 whitespace-pre-wrap font-mono text-xs leading-relaxed text-ink-soft">
                {activeNote.content}
              </pre>
            </>
          ) : (
            <p className="text-sm text-ink-soft">Select a note to read.</p>
          )}
        </div>
      </div>
    </div>
  );
}
