"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { useEffect, useMemo, useRef, useState } from "react";
import { usePushToTalk } from "@/hooks/use-push-to-talk";
import { useWakeWordAmbient } from "@/hooks/use-wake-word";
import { signalJobsChanged } from "@/components/job-poller";
import {
  AMBIENT_STORAGE_KEY,
  DEFAULT_WAKE_WORD,
  SPEAK_REPLIES_STORAGE_KEY,
  WAKE_WORD_STORAGE_KEY,
  loadSpeechVoices,
  primeSpeechSynthesis,
  sanitizeVoiceCommand,
  speakText,
  stopSpeaking,
  textForSpeech,
} from "@/lib/speech/browser";
import type { Project } from "@/lib/db/schema";

function messageText(message: UIMessage) {
  return message.parts
    .map((part) => {
      if (part.type === "text" && "text" in part) {
        return String((part as { text?: string }).text ?? "");
      }
      // Some SDK builds expose plain content strings on parts.
      if (
        part &&
        typeof part === "object" &&
        "text" in part &&
        typeof (part as { text?: unknown }).text === "string"
      ) {
        return (part as { text: string }).text;
      }
      return "";
    })
    .filter(Boolean)
    .join("\n")
    .trim();
}

function toolLabel(partType: string) {
  return partType.replace(/^tool-/, "").replaceAll("_", " ");
}

function phaseLabel(
  phase: string,
  pushListening: boolean,
  busy: boolean,
  speaking: boolean,
) {
  if (speaking) return "speaking";
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
  const [projectId, setProjectId] = useState("");
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [ambientEnabled, setAmbientEnabled] = useState(false);
  const [speakReplies, setSpeakReplies] = useState(true);
  const [wakeWord, setWakeWord] = useState(DEFAULT_WAKE_WORD);
  const [hydrated, setHydrated] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [pushListening, setPushListening] = useState(false);
  const [ttsError, setTtsError] = useState<string | null>(null);

  const projectIdRef = useRef(projectId);
  const conversationIdRef = useRef(conversationId);
  const busyRef = useRef(false);
  const voiceOriginRef = useRef(false);
  const speakRepliesRef = useRef(true);
  const lastSpokenIdRef = useRef<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const sendMessageRef = useRef<(payload: { text: string }) => Promise<void>>(
    async () => undefined,
  );
  const clearErrorRef = useRef<() => void>(() => undefined);
  const speakAssistantRef = useRef<(message: UIMessage) => void>(() => undefined);
  projectIdRef.current = projectId;
  conversationIdRef.current = conversationId;
  speakRepliesRef.current = speakReplies;

  function speakAssistantMessage(message: UIMessage) {
    if (!speakRepliesRef.current) return;
    if (message.role !== "assistant") return;
    if (message.id === lastSpokenIdRef.current) return;

    const text = textForSpeech(messageText(message));
    if (!text) return;

    lastSpokenIdRef.current = message.id;
    voiceOriginRef.current = false;
    setTtsError(null);
    setSpeaking(true);
    void speakText(text)
      .catch((err) => {
        console.error("[uplink] speak failed", err);
        setTtsError(
          err instanceof Error ? err.message : "Browser speech failed",
        );
      })
      .finally(() => setSpeaking(false));
  }
  speakAssistantRef.current = speakAssistantMessage;

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
          if (!response.ok) {
            let message = `Chat failed (${response.status})`;
            try {
              const data = await response.clone().json();
              if (data?.error) message = String(data.error);
            } catch {
              // keep status message
            }
            throw new Error(message);
          }
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
    useChat({
      transport,
      onError: (err) => {
        console.error("[uplink]", err);
        voiceOriginRef.current = false;
      },
      onFinish: ({ message }) => {
        speakAssistantRef.current(message);
      },
    });

  const busy = status === "submitted" || status === "streaming";
  busyRef.current = busy;
  sendMessageRef.current = sendMessage;
  clearErrorRef.current = clearError;

  async function dispatchVoiceCommand(text: string) {
    const trimmed = sanitizeVoiceCommand(text);
    if (!trimmed || busyRef.current || configured !== true) return;
    voiceOriginRef.current = true;
    setOpen(true);
    setInput("");
    clearErrorRef.current();
    primeSpeechSynthesis();
    try {
      await sendMessageRef.current({ text: trimmed });
    } catch (err) {
      voiceOriginRef.current = false;
      console.error("[uplink] send failed", err);
    }
  }

  const {
    supported: speechSupported,
    listening,
    speechError,
    toggle: toggleMic,
    stop: stopMic,
  } = usePushToTalk({
    enabled:
      open && configured === true && !busy && !ambientEnabled && !speaking && hydrated,
    onTranscript: (text) => {
      setInput(text);
    },
    onComplete: (text) => {
      void dispatchVoiceCommand(text);
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
    enabled: hydrated && ambientEnabled && configured === true,
    paused: busy || listening || speaking,
    wakeWord,
    onWake: () => {
      setOpen(true);
    },
    onPartialCommand: (text) => {
      setInput(text);
    },
    onCommand: (text) => {
      void dispatchVoiceCommand(text);
    },
  });

  useEffect(() => {
    try {
      const storedAmbient = window.localStorage.getItem(AMBIENT_STORAGE_KEY);
      const storedWake = window.localStorage.getItem(WAKE_WORD_STORAGE_KEY);
      const storedSpeak = window.localStorage.getItem(SPEAK_REPLIES_STORAGE_KEY);
      if (storedAmbient === "1") setAmbientEnabled(true);
      if (storedWake?.trim()) setWakeWord(storedWake.trim().toLowerCase());
      // Default ON so typed and spoken replies are both heard.
      if (storedSpeak === "0") setSpeakReplies(false);
      else setSpeakReplies(true);
    } catch {
      // ignore storage failures
    }
    setHydrated(true);
    // Warm Chrome voices list early (async).
    void loadSpeechVoices();
  }, []);

  // When the uplink opens, prime synthesis on that user gesture.
  useEffect(() => {
    if (!open || !hydrated) return;
    primeSpeechSynthesis();
  }, [open, hydrated]);

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
      window.localStorage.setItem(
        SPEAK_REPLIES_STORAGE_KEY,
        speakReplies ? "1" : "0",
      );
    } catch {
      // ignore
    }
  }, [speakReplies, hydrated]);

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

  function resetConversation() {
    conversationIdRef.current = null;
    setConversationId(null);
    setMessages([]);
    clearError();
    stopMic({ send: false });
    stopSpeaking();
    setSpeaking(false);
    voiceOriginRef.current = false;
  }

  function onProjectSelect(nextId: string) {
    if (nextId === projectId) return;
    setProjectId(nextId);
    // Manual lane change starts a fresh thread.
    resetConversation();
  }

  useEffect(() => {
    if (!open) stopMic({ send: false });
  }, [open, stopMic]);

  useEffect(() => {
    if (busy) stopMic({ send: false });
  }, [busy, stopMic]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, busy, ambientPartial]);

  // After tool turns that touch jobs/vault, nudge the dashboard poller immediately.
  useEffect(() => {
    if (status !== "ready") return;
    const touched = messages.some((message) =>
      message.parts.some((part) => {
        const type = String(part.type);
        return (
          type.includes("start_job") ||
          type.includes("draft_daily_post") ||
          type.includes("ingest_emails") ||
          type.includes("write_vault_note") ||
          type.includes("resolve_job") ||
          type.includes("clear_needs_you") ||
          type.includes("get_job")
        );
      }),
    );
    if (touched) signalJobsChanged();
  }, [status, messages]);

  // If a job targeted a named lane, switch the uplink dropdown to that lane.
  useEffect(() => {
    if (status !== "ready") return;
    for (const message of [...messages].reverse()) {
      for (const part of message.parts) {
        if (
          !String(part.type).includes("start_job") &&
          !String(part.type).includes("draft_daily_post")
        ) {
          continue;
        }
        const output =
          part && typeof part === "object" && "output" in part
            ? (part as { output?: unknown }).output
            : null;
        if (!output || typeof output !== "object") continue;
        const fromJob = (output as { job?: { projectId?: string } }).job;
        const fromQueue = (
          output as { queued?: Array<{ projectId?: string }> }
        ).queued?.[0];
        const nextId =
          fromJob?.projectId?.trim() || fromQueue?.projectId?.trim();
        if (nextId && nextId !== projectIdRef.current) {
          // Keep the conversation — only sync the soft-default dropdown.
          setProjectId(nextId);
          return;
        }
      }
    }
  }, [status, messages]);

  // Backup speak path if onFinish didn't fire (SDK edge cases).
  useEffect(() => {
    if (status !== "ready") return;
    if (!speakReplies) {
      voiceOriginRef.current = false;
      return;
    }

    const lastAssistant = [...messages]
      .reverse()
      .find((message) => message.role === "assistant");
    if (!lastAssistant) {
      voiceOriginRef.current = false;
      return;
    }
    speakAssistantMessage(lastAssistant);
  }, [status, messages, speakReplies]);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    const text = input.trim();
    if (!text || busy || configured !== true) return;
    voiceOriginRef.current = false;
    primeSpeechSynthesis();
    stopMic({ send: false });
    setInput("");
    clearError();
    try {
      await sendMessage({ text });
    } catch (err) {
      console.error("[uplink] send failed", err);
    }
  }

  async function testVoice() {
    primeSpeechSynthesis();
    setTtsError(null);
    setSpeaking(true);
    try {
      await speakText("Operator uplink online. Speech is working.");
    } catch (err) {
      console.error("[uplink] test voice failed", err);
      setTtsError(
        err instanceof Error ? err.message : "Browser speech failed",
      );
    } finally {
      setSpeaking(false);
    }
  }

  function toggleAmbient() {
    if (!speechSupported || configured !== true) return;
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
    speaking,
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
        onClick={() =>
          setOpen((value) => {
            const next = !value;
            if (next) primeSpeechSynthesis();
            return next;
          })
        }
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
              onChange={(event) => onProjectSelect(event.target.value)}
              className="field !w-auto !py-1.5 !text-xs"
              aria-label="Soft-default lane (named lanes in chat win)"
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
              disabled={configured !== true || !speechSupported}
              className={`!px-3 !py-1.5 !text-[10px] uppercase tracking-[0.16em] disabled:opacity-50 ${
                ambientEnabled ? "btn-signal" : "btn-ghost"
              }`}
              aria-pressed={ambientEnabled}
              title={`Always-on wake word (“${wakeWord}”)`}
            >
              {ambientEnabled ? "Ambient on" : "Ambient off"}
            </button>
            <button
              type="button"
              onClick={() => {
                setSpeakReplies((value) => {
                  const next = !value;
                  if (!next) {
                    stopSpeaking();
                    setSpeaking(false);
                    setTtsError(null);
                  } else {
                    primeSpeechSynthesis();
                    setSpeaking(true);
                    void speakText("Speak on.")
                      .catch((err) => {
                        setTtsError(
                          err instanceof Error
                            ? err.message
                            : "Browser speech failed",
                        );
                      })
                      .finally(() => setSpeaking(false));
                  }
                  return next;
                });
              }}
              disabled={configured !== true}
              className={`!px-3 !py-1.5 !text-[10px] uppercase tracking-[0.16em] disabled:opacity-50 ${
                speakReplies ? "btn-signal" : "btn-ghost"
              }`}
              aria-pressed={speakReplies}
              title="Speak operator replies out loud"
            >
              {speakReplies ? "Speak on" : "Speak off"}
            </button>
            <button
              type="button"
              onClick={() => void testVoice()}
              disabled={configured !== true || speaking}
              className="btn-ghost !px-3 !py-1.5 !text-[10px] uppercase tracking-[0.16em] disabled:opacity-50"
              title="Play a short test phrase to verify browser speech"
            >
              Test voice
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
                disabled={configured !== true}
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
                  Wake word can hear you, but chat cannot answer without this key.
                </p>
              </div>
            ) : null}

            {messages.length === 0 && configured === true ? (
              <p className="text-sm text-ink-soft">
                {ambientEnabled
                  ? `Ambient on — say “${wakeWord}” then your command. Replies are spoken aloud.`
                  : speakReplies
                    ? "Type or tap Mic — replies are spoken aloud (Speak on)."
                    : "Type, tap Mic, or enable Ambient. Turn Speak on to hear replies."}
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
                  ) : message.role === "assistant" && busy ? (
                    <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.16em] text-ink-soft">
                      compiling reply…
                    </p>
                  ) : null}
                </div>
              );
            })}

            {busy && messages[messages.length - 1]?.role === "user" ? (
              <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-flight">
                operator working…
              </p>
            ) : null}

            {error ? (
              <div className="hud-frame hud-frame-signal px-3 py-3 text-sm">
                <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-signal">
                  uplink error
                </p>
                <p className="mt-2 whitespace-pre-wrap text-ink">
                  {error.message || "Uplink failed."}
                </p>
              </div>
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
            {ttsError ? (
              <p className="text-xs text-signal">
                Speech error: {ttsError}. Click <span className="font-mono">Test voice</span>{" "}
                (Chrome/Edge, tab not muted).
              </p>
            ) : null}
            {ambientEnabled && ambientListening && !busy && !speaking ? (
              <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-flight">
                mic live // watching for “{wakeWord}”
              </p>
            ) : null}
            <div ref={messagesEndRef} />
          </div>

          <form onSubmit={onSubmit} className="border-t border-beam/20 p-3">
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  // Interrupt TTS so a stuck "speaking" state cannot block replies.
                  stopSpeaking();
                  setSpeaking(false);
                  toggleMic();
                }}
                disabled={
                  configured !== true ||
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
                onFocus={() => {
                  // If Ambient was mid-capture, let the user take over typing.
                  if (speaking) {
                    stopSpeaking();
                    setSpeaking(false);
                  }
                }}
                className="field !py-2"
                placeholder={
                  ambientPhase === "capturing" || ambientPhase === "armed"
                    ? "Capturing command…"
                    : listening
                      ? "Listening…"
                      : speaking
                        ? "Reply anytime…"
                        : projectId
                          ? "Ask about this lane…"
                          : "Ask across lanes…"
                }
                disabled={configured !== true}
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
                    configured !== true ||
                    listening
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
