import { openai } from "@ai-sdk/openai";
import type { Project } from "@/lib/db/schema";

export function isChatConfigured() {
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}

export function getChatModel() {
  if (!isChatConfigured()) {
    throw new Error("OPENAI_API_KEY is not configured");
  }
  const modelId = process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini";
  return openai(modelId);
}

export function buildSystemPrompt(project: Project | null) {
  const grounding = project
    ? [
        `Active lane: ${project.name} (id: ${project.id}).`,
        `Goal: ${project.goal || "(none set)"}.`,
        `Status: ${project.status}. Interrupt: ${project.interruptLevel}.`,
        project.needsYou ? `Needs human: ${project.needsYou}` : "No open needs-you flag.",
        project.vaultPath
          ? `Obsidian vault path: ${project.vaultPath}`
          : "No Obsidian vault configured for this lane.",
        project.notes ? `Inline hub notes: ${project.notes}` : "",
      ]
        .filter(Boolean)
        .join("\n")
    : "No lane selected. For project-specific questions, ask which lane or use list_projects.";

  return `You are the conversational operator for a personal command center HUD.
Speak like a concise Iron Man-style systems aide: calm, precise, brief. No fluff.
You are not branding yourself with a name in every sentence — just help.

Rules:
- Ground answers in a named project/lane when possible.
- Prefer action and facts over essays.
- Use tools for live status, jobs, and Obsidian notes — do not invent vault contents.
- After any tool calls, always finish with a short spoken-style answer the user can hear aloud.
- Never end on a silent tool call. If tools return nothing useful, say that plainly.
- Read-only only in this phase. Do not claim you merged PRs, sent messages, or started agents unless a tool confirms it.
- If something needs a human decision, say so plainly.
- Ask at most one clarifying question when context is ambiguous.

${grounding}`;
}
