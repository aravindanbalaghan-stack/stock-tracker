// NSE session timing. Deliberately dependency-free so it can be imported
// from client components — lib/nseLive.js pulls in the server-only NSE
// session helper, and importing that into the browser bundle would drag
// server code client-side.

const IST_TZ = "Asia/Kolkata";
const SESSION_OPEN = 9 * 60 + 15; // 09:15 IST
const SESSION_CLOSE = 15 * 60 + 30; // 15:30 IST

function istNow() {
  return new Date(new Date().toLocaleString("en-US", { timeZone: IST_TZ }));
}

export function istNowMinutes() {
  const now = istNow();
  return now.getHours() * 60 + now.getMinutes();
}

export function istToday() {
  return new Date().toLocaleDateString("en-CA", { timeZone: IST_TZ });
}

// NSE equity-segment trading holidays that fall on weekdays. This built-in
// list is what client code uses (and the server's fallback): the server
// also pulls NSE's own holiday master (lib/marketCalendar.js) and merges it
// in. Add next year's dates here when NSE publishes them (usually in
// December) — until then the server-side NSE fetch covers them.
export const NSE_HOLIDAYS = new Set([
  // 2025
  "2025-02-26", "2025-03-14", "2025-03-31", "2025-04-10", "2025-04-14", "2025-04-18",
  "2025-05-01", "2025-08-15", "2025-08-27", "2025-10-02", "2025-10-21", "2025-10-22",
  "2025-11-05", "2025-12-25",
  // 2026
  "2026-01-15", "2026-01-26", "2026-03-03", "2026-03-26", "2026-03-31", "2026-04-03",
  "2026-04-14", "2026-05-01", "2026-05-28", "2026-06-26", "2026-09-14", "2026-10-02",
  "2026-10-20", "2026-11-10", "2026-11-24", "2026-12-25",
]);

/** Weekend or a listed NSE holiday — a date with no regular session. */
export function isNonTradingDate(date, extraHolidays) {
  const d = new Date(`${date}T00:00:00Z`).getUTCDay();
  if (d === 0 || d === 6) return true;
  return NSE_HOLIDAYS.has(date) || !!extraHolidays?.has(date);
}

/** Whether today (IST) is an NSE trading day. */
export function isTradingDayToday(extraHolidays) {
  return !isNonTradingDate(istToday(), extraHolidays);
}

/**
 * Whether NSE is currently in its regular session: a trading day (not a
 * weekend or holiday) between 09:15 and 15:30 IST.
 */
export function marketIsOpen(extraHolidays) {
  if (!isTradingDayToday(extraHolidays)) return false;
  const mins = istNowMinutes();
  return mins >= SESSION_OPEN && mins <= SESSION_CLOSE;
}

/** How far through the session we are, 0-1. */
export function sessionProgress() {
  const mins = istNowMinutes();
  if (mins <= SESSION_OPEN) return 0;
  if (mins >= SESSION_CLOSE) return 1;
  return (mins - SESSION_OPEN) / (SESSION_CLOSE - SESSION_OPEN);
}
