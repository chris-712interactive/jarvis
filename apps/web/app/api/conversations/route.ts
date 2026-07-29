import { NextResponse } from "next/server";
import {
  createConversation,
  getConversation,
  listConversations,
  listMessages,
} from "@/lib/db/chat";
import { seedIfEmpty } from "@/lib/db/queries";

export const runtime = "nodejs";

export async function GET(request: Request) {
  await seedIfEmpty();
  const url = new URL(request.url);
  const projectId = url.searchParams.get("projectId");
  const conversationId = url.searchParams.get("id");

  if (conversationId) {
    const conversation = await getConversation(conversationId);
    if (!conversation) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const messages = await listMessages(conversation.id);
    return NextResponse.json({ conversation, messages });
  }

  const conversations = await listConversations(projectId);
  return NextResponse.json({ conversations });
}

export async function POST(request: Request) {
  await seedIfEmpty();
  const body = await request.json().catch(() => null);
  const projectId =
    typeof body?.projectId === "string" && body.projectId.trim()
      ? body.projectId.trim()
      : null;
  const title =
    typeof body?.title === "string" && body.title.trim()
      ? body.title.trim()
      : undefined;

  const conversation = await createConversation({ projectId, title });
  return NextResponse.json({ conversation }, { status: 201 });
}
