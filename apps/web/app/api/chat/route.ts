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
import { getProject, seedIfEmpty } from "@/lib/db/queries";
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
        (m) => m.role === "user" && m.content === content && m.id === latestUser.id,
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

  const result = streamText({
    model: getChatModel(),
    system: buildSystemPrompt(project),
    messages: await convertToModelMessages(messages),
    tools: createOperatorTools(project?.id ?? null),
    stopWhen: stepCountIs(8),
    temperature: 0.4,
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
  });
}
