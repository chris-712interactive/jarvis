import { NextResponse } from "next/server";
import {
  getUnreadNotificationCount,
  listNotifications,
  markAllNotificationsRead,
} from "@/lib/db/notifications";
import { seedIfEmpty } from "@/lib/db/queries";

export const runtime = "nodejs";

export async function GET(request: Request) {
  await seedIfEmpty();
  const { searchParams } = new URL(request.url);
  const unreadOnly = searchParams.get("unread") === "1";
  const notifications = await listNotifications({
    unreadOnly,
    limit: 40,
  });
  const unreadCount = await getUnreadNotificationCount();
  return NextResponse.json({ notifications, unreadCount });
}

export async function PATCH(request: Request) {
  await seedIfEmpty();
  const body = await request.json().catch(() => null);
  if (body?.markAllRead === true) {
    await markAllNotificationsRead();
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: "Unsupported patch" }, { status: 400 });
}
