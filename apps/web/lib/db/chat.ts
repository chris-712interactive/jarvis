import { asc, desc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getDb } from "./index";
import { conversations, messages } from "./schema";

export async function createConversation(input?: {
  projectId?: string | null;
  title?: string;
}) {
  const db = getDb();
  const now = new Date();
  const row = {
    id: nanoid(),
    projectId: input?.projectId ?? null,
    title: input?.title?.trim() || "Command chat",
    createdAt: now,
    updatedAt: now,
  };
  await db.insert(conversations).values(row);
  return row;
}

export async function getConversation(id: string) {
  const db = getDb();
  const rows = await db
    .select()
    .from(conversations)
    .where(eq(conversations.id, id))
    .limit(1);
  return rows[0] ?? null;
}

export async function listConversations(projectId?: string | null) {
  const db = getDb();
  if (projectId) {
    return db
      .select()
      .from(conversations)
      .where(eq(conversations.projectId, projectId))
      .orderBy(desc(conversations.updatedAt));
  }
  return db.select().from(conversations).orderBy(desc(conversations.updatedAt));
}

export async function listMessages(conversationId: string) {
  const db = getDb();
  return db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(asc(messages.createdAt));
}

export async function addMessage(input: {
  conversationId: string;
  role: "user" | "assistant" | "system";
  content: string;
  id?: string;
}) {
  const db = getDb();
  const row = {
    id: input.id ?? nanoid(),
    conversationId: input.conversationId,
    role: input.role,
    content: input.content,
    createdAt: new Date(),
  };
  await db.insert(messages).values(row);
  await db
    .update(conversations)
    .set({ updatedAt: new Date() })
    .where(eq(conversations.id, input.conversationId));
  return row;
}

export async function ensureConversation(input: {
  conversationId?: string | null;
  projectId?: string | null;
  title?: string;
}) {
  if (input.conversationId) {
    const existing = await getConversation(input.conversationId);
    if (existing) return existing;
  }
  return createConversation({
    projectId: input.projectId,
    title: input.title,
  });
}
