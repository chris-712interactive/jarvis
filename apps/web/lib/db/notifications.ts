import { and, desc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getDb } from "./index";
import {
  notifications,
  type InterruptLevel,
  type Notification,
} from "./schema";

export type CreateNotificationInput = {
  title: string;
  body?: string;
  level?: InterruptLevel;
  projectId?: string | null;
  jobId?: string | null;
};

export async function createNotification(input: CreateNotificationInput) {
  const db = getDb();
  const row = {
    id: nanoid(),
    projectId: input.projectId ?? null,
    jobId: input.jobId ?? null,
    title: input.title.trim(),
    body: input.body?.trim() ?? "",
    level: input.level ?? "digest",
    read: false,
    createdAt: new Date(),
  };
  await db.insert(notifications).values(row);
  return row;
}

export async function listNotifications(filters?: {
  unreadOnly?: boolean;
  limit?: number;
}) {
  const db = getDb();
  const limit = filters?.limit ?? 40;
  if (filters?.unreadOnly) {
    return db
      .select()
      .from(notifications)
      .where(eq(notifications.read, false))
      .orderBy(desc(notifications.createdAt))
      .limit(limit);
  }
  return db
    .select()
    .from(notifications)
    .orderBy(desc(notifications.createdAt))
    .limit(limit);
}

export async function getUnreadNotificationCount() {
  const unread = await listNotifications({ unreadOnly: true, limit: 500 });
  return unread.length;
}

export async function markNotificationRead(id: string, read = true) {
  const db = getDb();
  const rows = await db
    .select()
    .from(notifications)
    .where(eq(notifications.id, id))
    .limit(1);
  const existing = rows[0];
  if (!existing) return null;
  await db
    .update(notifications)
    .set({ read })
    .where(eq(notifications.id, id));
  return { ...existing, read } satisfies Notification;
}

export async function markAllNotificationsRead() {
  const db = getDb();
  await db
    .update(notifications)
    .set({ read: true })
    .where(and(eq(notifications.read, false)));
}
