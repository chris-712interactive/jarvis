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

export function buildSystemPrompt(
  selectedProject: Project | null,
  allProjects: Project[] = [],
) {
  const lanes = allProjects.filter((p) => p.status !== "archived");
  const roster =
    lanes.length === 0
      ? "(no lanes yet)"
      : lanes
          .map((p) => {
            const vault = p.vaultPath ? `vault: ${p.vaultPath}` : "no vault";
            return `- ${p.name} [slug: ${p.slug}] (id: ${p.id}, ${vault})`;
          })
          .join("\n");

  const grounding = selectedProject
    ? [
        `UI dropdown soft-default: ${selectedProject.name} (id: ${selectedProject.id}).`,
        `Goal: ${selectedProject.goal || "(none set)"}.`,
        `Status: ${selectedProject.status}. Interrupt: ${selectedProject.interruptLevel}.`,
        selectedProject.needsYou
          ? `Needs human: ${selectedProject.needsYou}`
          : "No open needs-you flag.",
        selectedProject.vaultPath
          ? `Obsidian vault path: ${selectedProject.vaultPath}`
          : "No Obsidian vault configured for this lane.",
        selectedProject.notes ? `Inline hub notes: ${selectedProject.notes}` : "",
        "This dropdown is ONLY a fallback when the user did not name a lane.",
      ]
        .filter(Boolean)
        .join("\n")
    : "UI dropdown: All lanes (no soft-default). If the user does not name a lane, ask which lane owns the work before start_job.";

  return `You are the conversational operator for a personal command center HUD.
Speak like a concise Iron Man-style systems aide: calm, precise, brief. No fluff.
You are not branding yourself with a name in every sentence — just help.

Rules:
- Ground answers in a named project/lane when possible.
- Prefer action and facts over essays.
- Use tools for live status, jobs, Obsidian notes, and starting async work — do not invent vault contents or job outcomes.
- After any tool calls, always finish with a short spoken-style answer the user can hear aloud.
- Never end on a silent tool call. If tools return nothing useful, say that plainly.
- Lane routing (critical): If the user names a lane ("ForgeRep", "in the Forge Rep lane", "Carline Dad", etc.), you MUST pass that name as \`lane\` on start_job / write_vault_note / vault tools (or call resolve_lane first). Never put work on the UI dropdown lane when a different lane was named. Confirm the real projectName returned by the tool.
- Available lanes:
${roster}
- Async by default: for research, drafts, planning docs, ops tasks, or coding missions, call start_job so work appears under In flight. Confirm only the real job id/title/projectName returned by the tool.
- Planning / research / draft deliverables: start_job (kind research or ops). When the runner finishes it writes a markdown note into that lane's Obsidian vault under Jarvis Jobs/. Do not claim a note exists until a tool or job summary reports the path. For a short immediate note, write_vault_note is allowed.
- Never say a job started unless start_job returned started:true and an id. Never invent Obsidian paths.
- Do not claim you merged PRs, sent external messages, or dispatched real coding agents unless a tool confirms it. Code jobs currently land in Needs you until agents are wired.
- If the target lane has no vault path, say so and ask them to set one before promising Obsidian output.
- To clear Priority / Needs you items: use resolve_job (for job alerts) or clear_needs_you (for project flags). Editing Obsidian notes does not clear the hub queue — say so if the user expects that.
- If something needs a human decision, say so plainly.
- Ask at most one clarifying question when context is ambiguous.

${grounding}`;
}
