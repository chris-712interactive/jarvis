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

function isValidTimeZone(timeZone: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export function getOperatorTimeZone() {
  const raw =
    process.env.BRIEFING_TZ?.trim() || process.env.TZ?.trim() || "UTC";
  if (isValidTimeZone(raw)) return raw;
  console.warn(
    `[cron-auth] Invalid timezone "${raw}" — falling back to UTC. Use an IANA name like America/Chicago.`,
  );
  return "UTC";
}

/** Local calendar parts in the operator timezone. */
export function getLocalHourParts(
  at: Date = new Date(),
  timeZone: string = getOperatorTimeZone(),
) {
  const safeZone = isValidTimeZone(timeZone) ? timeZone : "UTC";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: safeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
    weekday: "short",
  }).formatToParts(at);

  const lookup = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? "";

  const year = Number(lookup("year"));
  const month = Number(lookup("month"));
  const day = Number(lookup("day"));
  const hourRaw = Number(lookup("hour"));
  const weekdayName = lookup("weekday");
  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };

  return {
    timeZone: safeZone,
    year: Number.isFinite(year) ? year : at.getUTCFullYear(),
    month: Number.isFinite(month) ? month : at.getUTCMonth() + 1,
    day: Number.isFinite(day) ? day : at.getUTCDate(),
    date: `${lookup("year")}-${lookup("month")}-${lookup("day")}`,
    hour: Number.isFinite(hourRaw) ? hourRaw % 24 : at.getUTCHours(),
    /** 0 = Sunday … 6 = Saturday in the operator timezone. */
    weekday: weekdayMap[weekdayName] ?? at.getUTCDay(),
  };
}

export function localDayKey(at: Date = new Date(), timeZone?: string) {
  return getLocalHourParts(at, timeZone ?? getOperatorTimeZone()).date;
}

/**
 * ISO week key in the operator timezone, e.g. `2026-W31`.
 * Uses the local calendar date, then ISO week-numbering year/week.
 */
export function localWeekKey(at: Date = new Date(), timeZone?: string) {
  const parts = getLocalHourParts(at, timeZone ?? getOperatorTimeZone());
  const utcNoon = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, 12));
  const dayNum = utcNoon.getUTCDay() || 7; // Mon=1 … Sun=7
  utcNoon.setUTCDate(utcNoon.getUTCDate() + 4 - dayNum);
  const isoYear = utcNoon.getUTCFullYear();
  const yearStart = new Date(Date.UTC(isoYear, 0, 1));
  const weekNo = Math.ceil(
    ((utcNoon.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7,
  );
  return `${isoYear}-W${String(weekNo).padStart(2, "0")}`;
}
