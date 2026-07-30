import { NextResponse } from "next/server";

/** Shared cron auth: Bearer CRON_SECRET, or ?secret=. Open in non-production when unset. */
export function authorizeCron(request: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    return process.env.NODE_ENV !== "production";
  }

  const header = request.headers.get("authorization")?.trim();
  if (header === `Bearer ${secret}`) return true;

  const url = new URL(request.url);
  if (url.searchParams.get("secret") === secret) return true;

  return false;
}

export function cronUnauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export function getOperatorTimeZone() {
  return process.env.BRIEFING_TZ?.trim() || process.env.TZ?.trim() || "UTC";
}

/** Local calendar parts in the operator timezone. */
export function getLocalHourParts(
  at: Date = new Date(),
  timeZone: string = getOperatorTimeZone(),
) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  }).formatToParts(at);

  const lookup = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? "";

  const year = Number(lookup("year"));
  const month = Number(lookup("month"));
  const day = Number(lookup("day"));
  const hourRaw = Number(lookup("hour"));

  return {
    timeZone,
    year: Number.isFinite(year) ? year : at.getUTCFullYear(),
    month: Number.isFinite(month) ? month : at.getUTCMonth() + 1,
    day: Number.isFinite(day) ? day : at.getUTCDate(),
    date: `${lookup("year")}-${lookup("month")}-${lookup("day")}`,
    hour: Number.isFinite(hourRaw) ? hourRaw % 24 : at.getUTCHours(),
  };
}

export function localDayKey(at: Date = new Date(), timeZone?: string) {
  return getLocalHourParts(at, timeZone ?? getOperatorTimeZone()).date;
}
