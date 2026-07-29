"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { useEffect, useMemo, useRef, useState } from "react";
import { usePushToTalk } from "@/hooks/use-push-to-talk";
import { useWakeWordAmbient } from "@/hooks/use-wake-word";
import {
  AMBIENT_STORAGE_KEY,
  DEFAULT_WAKE_WORD,
  WAKE_WORD_STORAGE_KEY,
} from "@/lib/speech/browser";
import type { Project } from "@/lib/db/schema";

function messageText(message: UIMessage) {
  return message.parts
    .map((part) => {
      if (part.type === "text") return part.text;
      return "";
    })
    .filter(Boolean)
    .join("\n")
    .trim();
}

function toolLabel(partType: string) {
  return partType.replace(/^tool-/, "").replaceAll("_", " ");
}

function phaseLabel(phase: string, pushListening: boolean, busy: boolean) {
  if (busy) return "streaming";
  if (pushListening) return "listening";
  if (phase === "watching") return "ambient";
  if (phase === "armed") return "wake heard";
  if (phase === "capturing") return "capturing";
  return "ready";
}

export function ChatPanel({ projects }: { projects: Project[] }) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [ambientEnabled, setAmbientEnabled] = useState(false);
  const [wakeWord, setWakeWord] = useState(DEFAULT_WAKE_WORD);
  const [hydrated, setHydrated] = useState(false);

  const projectIdRef = useRef(projectId);
  const conversationIdRef = useRef(conversationId);
  const busyRef = useRef(false);
  const sendMessageRef = useRef<(payload: { text: string }) => Promise<void>>(
    async () => undefined,
  );
  const clearErrorRef = useRef<() => void>(() => undefined);
  projectIdRef.current = projectId;
  conversationIdRef.current = conversationId;

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        prepareSendMessagesRequest: ({
          messages,
          id,
          body,
          headers,
          credentials,
          api,
        }) => ({
          api,
          headers,
          credentials,
          body: {
            ...body,
            id,
            messages,
            projectId: projectIdRef.current || null,
            conversationId: conversationIdRef.current,
          },
        }),
        fetch: async (input, init) => {
          const response = await fetch(input, init);
          const nextId = response.headers.get("X-Conversation-Id");
          if (nextId) {
            conversationIdRef.current = nextId;
            setConversationId(nextId);
          }
          return response;
        },
      }),
    [],
  );

  const { messages, sendMessage, status, setMessages, error, clearError, stop } =
    useChat({ transport });

  const busy = status === "submitted" || status === "streaming";
  busyRef.current = busy;
  sendMessageRef.current = sendMessage;
  clearErrorRef.current = clearError;

  const [pushListening, setPushListening] = useState(false);

  const {
    supported: speechSupported,
    listening,
    speechError,
    toggle: toggleMic,
    stop: stopMic,
  } = usePushToTalk({
    enabled:
      open &&
      configured !== false &&
      !busy &&
      !ambientEnabled &&
      hydrated,
    onTranscript: (text) => {
      setInput(text);
    },
    onComplete: (text) => {
      const trimmed = text.trim();
      if (!trimmed || busyRef.current || configured === false) return;
      setInput("");
      clearErrorRef.current();
      void sendMessageRef.current({ text: trimmed });
    },
  });

  useEffect(() => {
    setPushListening(listening);
  }, [listening]);

  const {
    phase: ambientPhase,
    partial: ambientPartial,
    speechError: ambientError,
    listening: ambientListening,
  } = useWakeWordAmbient({
    enabled: hydrated && ambientEnabled && configured !== false,
    paused: busy || listening,
    wakeWord,
    onWake: () => {
      setOpen(true);
    },
    onPartialCommand: (text) => {
      setInput(text);
    },
    onCommand: (text) => {
      const trimmed = text.trim();
      if (!trimmed || busyRef.current || configured === false) return;
      setOpen(true);
      setInput("");
      clearErrorRef.current();
      void sendMessageRef.current({ text: trimmed });
    },
  });

  useEffect(() => {
    try {
      const storedAmbient = window.localStorage.getItem(AMBIENT_STORAGE_KEY);
      const storedWake = window.localStorage.getItem(WAKE_WORD_STORAGE_KEY);
      if (storedAmbient === "1") setAmbientEnabled(true);
      if (storedWake?.trim()) setWakeWord(storedWake.trim().toLowerCase());
    } catch {
      // ignore storage failures
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(
        AMBIENT_STORAGE_KEY,
        ambientEnabled ? "1" : "0",
      );
    } catch {
      // ignore
    }
  }, [ambientEnabled, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(WAKE_WORD_STORAGE_KEY, wakeWord);
    } catch {
      // ignore
    }
  }, [wakeWord, hydrated]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/chat/status")
      .then(async (res) => {
        const data = await res.json().catch(() => null);
        if (!cancelled) setConfigured(Boolean(data?.configured));
      })
      .catch(() => {
        if (!cancelled) setConfigured(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    conversationIdRef.current = null;
    setConversationId(null);
    setMessages([]);
    clearError();
    stopMic({ send: false });
  }, [projectId, setMessages, clearError, stopMic]);

  useEffect(() => {
    if (!open) stopMic({ send: false });
  }, [open, stopMic]);

  useEffect(() => {
    if (busy) stopMic({ send: false });
  }, [busy, stopMic]);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    stopMic({ send: false });
    setInput("");
    clearError();
    await sendMessage({ text });
  }

  function toggleAmbient() {
    if (!speechSupported || configured === false) return;
    setAmbientEnabled((value) => {
      const next = !value;
      if (next) {
        stopMic({ send: false });
        setOpen(true);
      }
      return next;
    });
  }

  const statusText = phaseLabel(
    ambientEnabled ? ambientPhase : "off",
    pushListening,
    busy,
  );

  return (
    <>
      {ambientEnabled && !open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="fixed bottom-5 left-5 z-40 flex items-center gap-2 border border-flight/40 bg-[color-mix(in_oklab,var(--panel-strong)_92%,transparent)] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.2em] text-flight backdrop-blur-md"
        >
          <span className="live-dot bg-flight" />
          ambient // {ambientPhase}
          {ambientPartial ? ` // ${ambientPartial.slice(0, 28)}` : ""}
        </button>
      ) : null}

      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="fixed bottom-5 right-5 z-40 btn-primary !px-4 !py-3 shadow-[0_0_24px_color-mix(in_oklab,var(--beam)_35%,transparent)]"
      >
        {open ? "Close uplink" : "Open uplink"}
      </button>

      {open ? (
        <section className="fixed bottom-20 right-5 z-40 flex h-[min(72vh,680px)] w-[min(440px,calc(100vw-2rem))] flex-col overflow-hidden border border-beam/35 bg-[color-mix(in_oklab,var(--panel-strong)_94%,transparent)] shadow-[0_0_40px_color-mix(in_oklab,var(--beam)_18%,transparent)] backdrop-blur-xl">
          <header className="flex items-center justify-between gap-3 border-b border-beam/20 px-4 py-3">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-beam">
                operator uplink
              </p>
              <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.18em] text-ink-soft">
                {statusText}
                <span className="boot-blink text-flight">_</span>
              </p>
            </div>
            <select
              value={projectId}
              onChange={(event) => setProjectId(event.target.value)}
              className="field !w-auto !py-1.5 !text-xs"
              aria-label="Active lane"
            >
              <option value="">All lanes</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </header>

          <div className="flex items-center gap-2 border-b border-beam/15 px-4 py-2">
            <button
              type="button"
              onClick={toggleAmbient}
              disabled={configured === false || !speechSupported}
              className={`!px-3 !py-1.5 !text-[10px] uppercase tracking-[0.16em] disabled:opacity-50 ${
                ambientEnabled ? "btn-signal" : "btn-ghost"
              }`}
              aria-pressed={ambientEnabled}
              title={`Always-on wake word (“${wakeWord}”)`}
            >
              {ambientEnabled ? "Ambient on" : "Ambient off"}
            </button>
            <label className="flex min-w-0 flex-1 items-center gap-2">
              <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.16em] text-ink-soft">
                wake
              </span>
              <input
                value={wakeWord}
                onChange={(event) => setWakeWord(event.target.value)}
                onBlur={() =>
                  setWakeWord(
                    wakeWord.toLowerCase().trim() || DEFAULT_WAKE_WORD,
                  )
                }
                className="field !py-1.5 !text-xs"
                disabled={configured === false}
                aria-label="Wake word"
              />
            </label>
          </div>

          <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
            {configured === false ? (
              <div className="hud-frame px-3 py-3 text-sm text-ink-soft">
                <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-signal">
                  uplink offline
                </p>
                <p className="mt-2">
                  Add <span className="font-mono text-beam">OPENAI_API_KEY</span> to{" "}
                  <span className="font-mono text-beam">apps/web/.env.local</span>{" "}
                  and restart <span className="font-mono">npm run dev</span>.
                </p>
              </div>
            ) : null}

            {messages.length === 0 && configured !== false ? (
              <p className="text-sm text-ink-soft">
                {ambientEnabled
                  ? `Ambient on — say “${wakeWord}” then your command.`
                  : "Type, tap Mic, or enable Ambient for always-on wake word."}
              </p>
            ) : null}

            {ambientEnabled &&
            (ambientPhase === "armed" || ambientPhase === "capturing") ? (
              <div className="hud-frame hud-frame-flight px-3 py-3 text-sm">
                <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-flight">
                  {ambientPhase === "armed"
                    ? "wake confirmed // awaiting command"
                    : "capturing command"}
                </p>
                <p className="mt-2 text-ink">
                  {ambientPartial || "Go ahead…"}
                </p>
              </div>
            ) : null}

            {messages.map((message) => {
              const text = messageText(message);
              const toolParts = message.parts.filter((part) =>
                part.type.startsWith("tool-"),
              );
              return (
                <div
                  key={message.id}
                  className={`rounded-sm border px-3 py-2 text-sm ${
                    message.role === "user"
                      ? "border-beam/30 bg-beam/10"
                      : "border-flight/25 bg-flight/5"
                  }`}
                >
                  <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink-soft">
                    {message.role === "user" ? "you" : "operator"}
                  </p>
                  {toolParts.length > 0 ? (
                    <ul className="mt-2 space-y-1">
                      {toolParts.map((part, index) => (
                        <li
                          key={`${message.id}-tool-${index}`}
                          className="font-mono text-[10px] uppercase tracking-[0.16em] text-flight"
                        >
                          tool // {toolLabel(part.type)}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {text ? (
                    <p className="mt-2 whitespace-pre-wrap leading-relaxed text-ink">
                      {text}
                    </p>
                  ) : null}
                </div>
              );
            })}

            {error ? (
              <p className="text-sm text-signal">
                {error.message || "Uplink failed."}
              </p>
            ) : null}
            {speechError ? <p className="text-sm text-signal">{speechError}</p> : null}
            {ambientError ? (
              <p className="text-sm text-signal">{ambientError}</p>
            ) : null}
            {!speechSupported ? (
              <p className="text-xs text-ink-soft">
                Voice needs Chrome or Edge. Typing still works.
              </p>
            ) : null}
            {ambientEnabled && ambientListening ? (
              <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-flight">
                mic live // watching for “{wakeWord}”
              </p>
            ) : null}
          </div>

          <form onSubmit={onSubmit} className="border-t border-beam/20 p-3">
            <div className="flex gap-2">
              <button
                type="button"
                onClick={toggleMic}
                disabled={
                  configured === false ||
                  busy ||
                  !speechSupported ||
                  ambientEnabled
                }
                className={`shrink-0 !px-3 !py-2 !text-[11px] uppercase tracking-[0.14em] disabled:opacity-50 ${
                  listening ? "btn-signal" : "btn-ghost"
                }`}
                aria-pressed={listening}
                title={
                  ambientEnabled
                    ? "Disable Ambient to use manual Mic"
                    : listening
                      ? "Stop listening and send"
                      : "Start microphone (tap again to send)"
                }
              >
                {listening ? "Stop" : "Mic"}
              </button>
              <input
                value={input}
                onChange={(event) => setInput(event.target.value)}
                className="field !py-2"
                placeholder={
                  ambientPhase === "capturing" || ambientPhase === "armed"
                    ? "Capturing command…"
                    : listening
                      ? "Listening…"
                      : projectId
                        ? "Ask about this lane…"
                        : "Ask across lanes…"
                }
                disabled={configured === false}
              />
              {busy ? (
                <button
                  type="button"
                  onClick={() => stop()}
                  className="btn-ghost !px-3 !py-2 !text-[11px] uppercase tracking-[0.14em]"
                >
                  Stop
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={
                    !input.trim() ||
                    configured === false ||
                    listening ||
                    ambientPhase === "capturing"
                  }
                  className="btn-primary !px-3 !py-2 !text-[11px] uppercase tracking-[0.14em] disabled:opacity-50"
                >
                  Send
                </button>
              )}
            </div>
          </form>
        </section>
      ) : null}
    </>
  );
}
