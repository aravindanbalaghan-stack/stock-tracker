// Which trading day an analysis entry is about.
//
// You write your analysis in the evening: the review is about the session
// that just closed, the plan ("Before the open") about the NEXT session.
// So, by the clock in India:
//   • after 15:30 on a trading day          → evening of today
//   • before 15:30, or on a weekend/holiday → evening of the last trading day
// and the plan date is always the trading day after that evening.

import { isNonTradingDate } from "@/lib/marketHours";

export const CLOSE_MINUTES = 15 * 60 + 30;

function istNow() {
  const d = new Date(Date.now() + 19800 * 1000);
  return { date: d.toISOString().slice(0, 10), minutes: d.getUTCHours() * 60 + d.getUTCMinutes() };
}

export function shiftTradingDay(date, dir) {
  const d = new Date(`${date}T00:00:00Z`);
  for (let i = 0; i < 12; i++) {
    d.setUTCDate(d.getUTCDate() + dir);
    const iso = d.toISOString().slice(0, 10);
    if (!isNonTradingDate(iso)) return iso;
  }
  return date;
}

export const nextTradingDay = (date) => shiftTradingDay(date, 1);
export const prevTradingDay = (date) => shiftTradingDay(date, -1);

/** The trading day whose evening it is now (the session your review is about). */
export function currentEvening() {
  const { date, minutes } = istNow();
  if (!isNonTradingDate(date) && minutes >= CLOSE_MINUTES) return date;
  return prevTradingDay(date);
}

/** The session your plan is for right now. */
export function currentPlanDate() {
  return nextTradingDay(currentEvening());
}

const DAY = new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
/** "Mon 17 Nov" */
export function dayLabel(iso) {
  return iso ? DAY.format(new Date(`${iso}T00:00:00Z`)) : "";
}
