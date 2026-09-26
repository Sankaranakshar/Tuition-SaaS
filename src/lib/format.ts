// Single source of truth for money and date rendering.
// All amounts render in rupees with Indian digit grouping. Never render a
// raw number or a dollar sign for money anywhere in the app.

import { civilDaysBetween, localDateKeyInZone } from "../../shared/timezone";

const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 2,
  minimumFractionDigits: 0,
});

/** Format an amount held in rupees (legacy fields). */
export function formatINR(rupees: number | null | undefined): string {
  return inr.format(rupees || 0);
}

/** Format an amount held in integer paise (canonical fields). */
export function formatPaise(paise: number | null | undefined): string {
  return inr.format((paise || 0) / 100);
}

export function formatDate(d: string | number | Date): string {
  return new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

export function formatTime(d: string | number | Date): string {
  return new Date(d).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
}

/** "today", "in 2 days", "12 days overdue" style relative rendering, counted
 *  in calendar days on the org's calendar (`zone`), not the viewer's. */
export function formatRelativeDays(d: string | number | Date, zone: string, now: Date = new Date()): string {
  const days = civilDaysBetween(localDateKeyInZone(now, zone), localDateKeyInZone(new Date(d), zone));
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  return days > 0 ? `in ${days} days` : `${-days} days ago`;
}
