import {
  convertToModelMessages,
  stepCountIs,
  streamText,
  type UIMessage,
} from "ai";
import { NextResponse } from "next/server";
import {
  addMessage,
  ensureConversation,
  listMessages,
} from "@/lib/db/chat";
import { getProject, listProjects, seedIfEmpty } from "@/lib/db/queries";
import { buildSystemPrompt, getChatModel, isChatConfigured } from "@/lib/chat/model";
import { createOperatorTools } from "@/lib/chat/tools";

export const runtime = "nodejs";
export const maxDuration = 60;

function textFromUiMessage(message: UIMessage) {
  return message.parts
    .map((part) => {
      if (part.type === "text") return part.text;
      return "";
    })
    .filter(Boolean)
    .join("\n")
    .trim();
}

function formatChatError(error: unknown): string {
  if (error == null) return "Unknown chat error";
  if (typeof error === "string") return error;

  if (error instanceof Error) {
    const enriched = error as Error & {
      statusCode?: number;
      responseBody?: string;
      data?: { error?: { message?: string } } | { message?: string };
      cause?: unknown;
    };

    const nested =
      (typeof enriched.data === "object" &&
        enriched.data &&
        "error" in enriched.data &&
        enriched.data.error?.message) ||
      (typeof enriched.data === "object" &&
        enriched.data &&
        "message" in enriched.data &&
        enriched.data.message) ||
      null;

    const parts = [
      nested || enriched.message || "Chat error",
      enriched.statusCode ? `HTTP ${enriched.statusCode}` : null,
    ].filter(Boolean);

    let message = parts.join(" — ");

    // Common setup failures → actionable hints
    const lower = message.toLowerCase();
    if (lower.includes("incorrect api key") || lower.includes("invalid api key")) {
      message +=
        " Check OPENAI_API_KEY in apps/web/.env.local and restart npm run dev.";
    } else if (lower.includes("model") && lower.includes("not found")) {
      message +=
        " Set OPENAI_MODEL in apps/web/.env.local to a model your key can use (e.g. gpt-4o-mini).";
    } else if (lower.includes("quota") || lower.includes("billing")) {
      message += " Your OpenAI account may need billing/credits.";
    } else if (lower.includes("rate limit")) {
      message += " Rate limited — wait a moment and try again.";
    }

    return message;
  }

  try {
    return JSON.stringify(error);
  } catch {
    return "Chat error";
  }
}

export async function POST(request: Request) {
  await seedIfEmpty();

  if (!isChatConfigured()) {
    return NextResponse.json(
      {
        error:
          "Chat is not configured. Add OPENAI_API_KEY to apps/web/.env.local and restart the dev server.",
      },
      { status: 503 },
    );
  }

  const body = await request.json().catch(() => null);
  if (!body || !Array.isArray(body.messages)) {
    return NextResponse.json({ error: "Invalid chat payload" }, { status: 400 });
  }

  const messages = body.messages as UIMessage[];
  const projectId =
    typeof body.projectId === "string" && body.projectId.trim()
      ? body.projectId.trim()
      : null;
  const conversationId =
    typeof body.conversationId === "string" && body.conversationId.trim()
      ? body.conversationId.trim()
      : null;

  const project = projectId ? await getProject(projectId) : null;
  if (projectId && !project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  try {
    const conversation = await ensureConversation({
      conversationId,
      projectId: project?.id ?? null,
      title: project ? `${project.name} chat` : "Command chat",
    });

    const latestUser = [...messages].reverse().find((m) => m.role === "user");
    if (latestUser) {
      const content = textFromUiMessage(latestUser);
      if (content) {
        const existing = await listMessages(conversation.id);
        const alreadySaved = existing.some(
          (m) =>
            m.role === "user" && m.content === content && m.id === latestUser.id,
        );
        if (!alreadySaved) {
          await addMessage({
            id: latestUser.id,
            conversationId: conversation.id,
            role: "user",
            content,
          });
        }
      }
    }

    let modelMessages;
    try {
      modelMessages = await convertToModelMessages(messages);
    } catch (error) {
      console.error("[chat] convertToModelMessages failed", error);
      return NextResponse.json(
        { error: `Could not parse chat messages: ${formatChatError(error)}` },
        { status: 400 },
      );
    }

    const result = streamText({
      model: getChatModel(),
      system: buildSystemPrompt(project, await listProjects()),
      messages: modelMessages,
      tools: createOperatorTools(project?.id ?? null),
      stopWhen: stepCountIs(8),
      temperature: 0.4,
      onError: ({ error }) => {
        console.error("[chat] streamText error", error);
      },
      onFinish: async ({ text }) => {
        const content = text.trim();
        if (!content) return;
        await addMessage({
          conversationId: conversation.id,
          role: "assistant",
          content,
        });
      },
    });

    return result.toUIMessageStreamResponse({
      headers: {
        "X-Conversation-Id": conversation.id,
      },
      // AI SDK defaults to hiding details behind "An error occurred."
      onError: formatChatError,
    });
  } catch (error) {
    console.error("[chat] route failure", error);
    return NextResponse.json(
      { error: formatChatError(error) },
      { status: 500 },
    );
  }
}
