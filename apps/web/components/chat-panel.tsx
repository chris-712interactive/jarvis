"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { useEffect, useMemo, useRef, useState } from "react";
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

export function ChatPanel({ projects }: { projects: Project[] }) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [configured, setConfigured] = useState<boolean | null>(null);

  const projectIdRef = useRef(projectId);
  const conversationIdRef = useRef(conversationId);
  projectIdRef.current = projectId;
  conversationIdRef.current = conversationId;

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        prepareSendMessagesRequest: ({ messages, id, body, headers, credentials, api }) => ({
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
  }, [projectId, setMessages, clearError]);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    clearError();
    await sendMessage({ text });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="fixed bottom-5 right-5 z-40 btn-primary !px-4 !py-3 shadow-[0_0_24px_color-mix(in_oklab,var(--beam)_35%,transparent)]"
      >
        {open ? "Close uplink" : "Open uplink"}
      </button>

      {open ? (
        <section className="fixed bottom-20 right-5 z-40 flex h-[min(70vh,640px)] w-[min(420px,calc(100vw-2rem))] flex-col overflow-hidden border border-beam/35 bg-[color-mix(in_oklab,var(--panel-strong)_94%,transparent)] shadow-[0_0_40px_color-mix(in_oklab,var(--beam)_18%,transparent)] backdrop-blur-xl">
          <header className="flex items-center justify-between gap-3 border-b border-beam/20 px-4 py-3">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-beam">
                operator uplink
              </p>
              <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.18em] text-ink-soft">
                {busy ? "streaming" : "ready"}
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
                Ask for priority status, lane goals, or search the Obsidian vault.
              </p>
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
          </div>

          <form onSubmit={onSubmit} className="border-t border-beam/20 p-3">
            <div className="flex gap-2">
              <input
                value={input}
                onChange={(event) => setInput(event.target.value)}
                className="field !py-2"
                placeholder={projectId ? "Ask about this lane…" : "Ask across lanes…"}
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
                  disabled={!input.trim() || configured === false}
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
