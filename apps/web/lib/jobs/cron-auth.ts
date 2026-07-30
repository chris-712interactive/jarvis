import { NextResponse } from "next/server";

/** Shared cron auth: Bearer CRON_SECRET. Open in non-production when unset. */
export function authorizeCron(request: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    return process.env.NODE_ENV !== "production";
  }
  const header = request.headers.get("authorization")?.trim();
  return header === `Bearer ${secret}`;
}

export function cronUnauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}
