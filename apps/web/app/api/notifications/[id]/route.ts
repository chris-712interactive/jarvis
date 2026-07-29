import { NextResponse } from "next/server";
import { markNotificationRead } from "@/lib/db/notifications";
import { seedIfEmpty } from "@/lib/db/queries";
import { updateNotificationSchema } from "@/lib/validation";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
  await seedIfEmpty();
  const { id } = await params;
  const body = await request.json().catch(() => null);
  const parsed = updateNotificationSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid notification patch", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const notification = await markNotificationRead(id, parsed.data.read);
  if (!notification) {
    return NextResponse.json({ error: "Notification not found" }, { status: 404 });
  }
  return NextResponse.json({ notification });
}
