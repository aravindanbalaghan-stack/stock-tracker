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

/**
 * Whether NSE is currently in its regular session.
 *
 * Weekends are excluded; trading HOLIDAYS are not, because there's no
 * holiday calendar in the app. So on a holiday this returns true during
 * market hours even though nothing is trading. Callers that care should
 * corroborate with whether live data actually came back rather than
 * treating this as authoritative.
 */
export function marketIsOpen() {
  const now = istNow();
  const day = now.getDay();
  if (day === 0 || day === 6) return false;
  const mins = now.getHours() * 60 + now.getMinutes();
  return mins >= SESSION_OPEN && mins <= SESSION_CLOSE;
}

/** How far through the session we are, 0-1. */
export function sessionProgress() {
  const mins = istNowMinutes();
  if (mins <= SESSION_OPEN) return 0;
  if (mins >= SESSION_CLOSE) return 1;
  return (mins - SESSION_OPEN) / (SESSION_CLOSE - SESSION_OPEN);
}
