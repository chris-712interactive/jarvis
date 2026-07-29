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
- Use tools for live status, jobs, Obsidian notes, and starting async work — do not invent vault contents or job outcomes.
- After any tool calls, always finish with a short spoken-style answer the user can hear aloud.
- Never end on a silent tool call. If tools return nothing useful, say that plainly.
- Async by default: for research, drafts, ops tasks, or coding missions that take more than a quick answer, call start_job so work continues under In flight while the user is busy. Confirm the job id/title briefly.
- Do not claim you merged PRs, sent external messages, or dispatched real coding agents unless a tool confirms it. Code jobs currently land in Needs you until agents are wired.
- If something needs a human decision, say so plainly.
- Ask at most one clarifying question when context is ambiguous.

${grounding}`;
}
