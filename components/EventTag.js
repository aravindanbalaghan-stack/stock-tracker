"use client";

// Small "Event" tag beside a symbol when it has a corporate event (results,
// dividend, bonus, split…) in the next 14 days. Hover for what and when;
// the stock page lists them in full.

import { useUpcomingEvents } from "@/lib/useUpcomingEvents";

const WINDOW_DAYS = 14;

function daysUntil(date) {
  const now = new Date(new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }) + "T00:00:00Z");
  return Math.round((new Date(`${date}T00:00:00Z`) - now) / 86400000);
}

export default function EventTag({ symbol }) {
  const events = useUpcomingEvents(symbol).filter((e) => daysUntil(e.date) <= WINDOW_DAYS);
  if (!events.length) return null;
  const first = events[0];
  const d = daysUntil(first.date);
  const when = d <= 0 ? "today" : d === 1 ? "tomorrow" : `in ${d}d`;
  return (
    <span
      className="ml-1.5 inline-flex items-center text-[9px] font-semibold uppercase tracking-wide px-1 py-px rounded align-middle whitespace-nowrap"
      style={{ color: "var(--tier-low)", background: "var(--tier-low-dim)" }}
      title={events.map((e) => `${e.date} · ${e.type}: ${e.title}`).join("\n")}
    >
      {first.type === "Results" ? "Results" : "Event"} {when}
    </span>
  );
}
