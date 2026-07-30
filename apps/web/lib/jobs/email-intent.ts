import { generateText } from "ai";
import { getChatModel, isChatConfigured } from "@/lib/chat/model";
import type { GmailMessage } from "@/lib/gmail/client";
import type { Project } from "@/lib/db/schema";

export type EmailIntent = "code" | "question" | "ambiguous";

export type EmailIntentResult = {
  intent: EmailIntent;
  confidence: number;
  reason: string;
};

function heuristicIntent(message: GmailMessage): EmailIntentResult {
  const text = `${message.subject}\n${message.bodyText}`.toLowerCase();

  const questionHints =
    /\b(how|what|why|when|where|who|which|status|update on|can you (explain|clarify|tell)|does it|is it|are we|do we)\b|\?/.test(
      text,
    );
  const codeHints =
    /\b(fix|bug|broken|crash|error|implement|add|change|update the code|refactor|pr\b|pull request|deploy|feature|patch|hotfix|build fails|failing test|regression)\b/.test(
      text,
    );

  if (codeHints && !questionHints) {
    return {
      intent: "code",
      confidence: 0.7,
      reason: "Heuristic: change/fix language without clear question framing",
    };
  }
  if (questionHints && !codeHints) {
    return {
      intent: "question",
      confidence: 0.7,
      reason: "Heuristic: question/status language without change verbs",
    };
  }
  if (codeHints && questionHints) {
    return {
      intent: "ambiguous",
      confidence: 0.45,
      reason: "Heuristic: both question and change signals",
    };
  }
  return {
    intent: "ambiguous",
    confidence: 0.3,
    reason: "Heuristic: no strong question or code signals",
  };
}

function parseIntentJson(raw: string): EmailIntentResult | null {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]) as {
      intent?: string;
      confidence?: number;
      reason?: string;
    };
    const intent = parsed.intent?.toLowerCase();
    if (intent !== "code" && intent !== "question" && intent !== "ambiguous") {
      return null;
    }
    const confidence = Number(parsed.confidence);
    return {
      intent,
      confidence: Number.isFinite(confidence)
        ? Math.min(Math.max(confidence, 0), 1)
        : 0.5,
      reason: (parsed.reason || "model").slice(0, 240),
    };
  } catch {
    return null;
  }
}

/** Classify whether an inbound email is a code change, a question, or ambiguous. */
export async function classifyEmailIntent(
  message: GmailMessage,
  project: Project,
): Promise<EmailIntentResult> {
  const fallback = heuristicIntent(message);

  if (!isChatConfigured()) {
    return fallback;
  }

  try {
    const { text } = await generateText({
      model: getChatModel(),
      temperature: 0,
      prompt: [
        `Classify an inbound email for project lane "${project.name}".`,
        project.goal?.trim() ? `Lane goal: ${project.goal.trim()}` : null,
        "",
        "Return ONLY JSON:",
        `{"intent":"code"|"question"|"ambiguous","confidence":0-1,"reason":"short"}`,
        "",
        "Definitions:",
        '- "code": asks to implement, fix, change, deploy, or otherwise modify the codebase',
        '- "question": asks for information, status, explanation, or clarification with no code change required',
        '- "ambiguous": unclear or mixed — needs a human to decide',
        "",
        `Subject: ${message.subject}`,
        `From: ${message.from}`,
        "Body:",
        (message.bodyText || message.snippet || "").slice(0, 4000),
      ]
        .filter(Boolean)
        .join("\n"),
    });

    const parsed = parseIntentJson(text.trim());
    if (!parsed) return fallback;

    // Low-confidence model answers fall back to heuristic when they disagree.
    if (parsed.confidence < 0.45 && parsed.intent !== fallback.intent) {
      return {
        ...fallback,
        reason: `Model unsure (${parsed.reason}); used heuristic`,
      };
    }
    return parsed;
  } catch (error) {
    console.warn("[email-intent] classification failed", error);
    return fallback;
  }
}

/** Draft a reply for a question email (operator approves before send). */
export async function draftQuestionReply(
  message: GmailMessage,
  project: Project,
): Promise<string> {
  const stub = [
    `Hi,`,
    ``,
    `Thanks for your note about "${message.subject}".`,
    ``,
    `[Draft — replace this with the answer before approving.]`,
    ``,
    `— Jarvis (on behalf of the operator)`,
  ].join("\n");

  if (!isChatConfigured()) return stub;

  try {
    const { text } = await generateText({
      model: getChatModel(),
      temperature: 0.4,
      prompt: [
        `Draft a concise, professional email reply for lane "${project.name}".`,
        project.goal?.trim() ? `Lane goal: ${project.goal.trim()}` : null,
        project.notes?.trim() ? `Lane notes: ${project.notes.trim()}` : null,
        "",
        "The inbound email is a QUESTION (not a code-change request).",
        "Answer helpfully from the given context only.",
        "If you lack facts, say what is unknown and ask one clarifying question.",
        "Do not invent code changes, timelines, or metrics.",
        "Output the email body only (no subject line, no markdown fences).",
        "Sign off as: — Jarvis (on behalf of the operator)",
        "",
        `Subject: ${message.subject}`,
        `From: ${message.from}`,
        "Body:",
        (message.bodyText || message.snippet || "").slice(0, 4000),
      ]
        .filter(Boolean)
        .join("\n"),
    });
    const body = text.trim();
    return body || stub;
  } catch (error) {
    console.warn("[email-intent] draft reply failed", error);
    return stub;
  }
}
