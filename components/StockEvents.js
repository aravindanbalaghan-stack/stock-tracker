"use client";

// Stock page → Events: upcoming results / corporate actions, and the ones
// from the last 30 days, from NSE's event calendar and corporate actions.

import { useEffect, useState } from "react";
import { SectionTitle, Panel } from "@/components/ui/Chrome";

const TYPE_TONE = {
  Results: "var(--accent)",
  Dividend: "var(--gain)",
  Bonus: "var(--gain)",
  Split: "var(--tier-low)",
  Rights: "var(--tier-low)",
  Buyback: "var(--gain)",
};

function label(date, today) {
  const d = Math.round((new Date(`${date}T00:00:00Z`) - new Date(`${today}T00:00:00Z`)) / 86400000);
  if (d === 0) return "today";
  if (d === 1) return "tomorrow";
  if (d === -1) return "yesterday";
  return d > 0 ? `in ${d} days` : `${-d} days ago`;
}

function Row({ e, today }) {
  return (
    <li className="flex items-start gap-3 py-2 border-b last:border-b-0" style={{ borderColor: "var(--border)" }}>
      <div className="w-24 shrink-0">
        <p className="font-mono text-xs" style={{ color: "var(--text)" }}>
          {new Date(`${e.date}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })}
        </p>
        <p className="text-[10px]" style={{ color: "var(--text-faint)" }}>
          {label(e.date, today)}
        </p>
      </div>
      <span
        className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded shrink-0"
        style={{ color: TYPE_TONE[e.type] ?? "var(--text-muted)", background: "var(--surface-2)" }}
      >
        {e.type}
      </span>
      <div className="min-w-0">
        <p className="text-xs" style={{ color: "var(--text)" }}>
          {e.title}
        </p>
        {e.detail && (
          <p className="text-[11px] mt-0.5" style={{ color: "var(--text-muted)" }}>
            {e.detail}
          </p>
        )}
      </div>
    </li>
  );
}

export default function StockEvents({ symbol }) {
  const [loaded, setLoaded] = useState({ key: null, data: null });
  const data = loaded.key === symbol ? loaded.data : null;

  useEffect(() => {
    let alive = true;
    fetch(`/api/events?symbol=${encodeURIComponent(symbol)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => alive && setLoaded({ key: symbol, data: j }))
      .catch(() => alive && setLoaded({ key: symbol, data: null }));
    return () => {
      alive = false;
    };
  }, [symbol]);

  if (!data) return null;
  const none = !data.upcoming?.length && !data.recent?.length;

  return (
    <div>
      <SectionTitle meta={data.status === "unavailable" ? "NSE event feed unreachable right now" : "From NSE · next 60 days and last 30"}>
        Events
      </SectionTitle>
      <Panel>
        {none ? (
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            {data.status === "unavailable"
              ? "Couldn't reach NSE's event calendar — try again later."
              : "No results, dividends, splits, bonuses or other corporate events announced for this stock in that window."}
          </p>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <p className="text-[11px] uppercase tracking-wide mb-1" style={{ color: "var(--text-faint)" }}>
                Upcoming
              </p>
              {data.upcoming.length ? (
                <ul>
                  {data.upcoming.map((e, i) => (
                    <Row key={i} e={e} today={data.today} />
                  ))}
                </ul>
              ) : (
                <p className="text-xs" style={{ color: "var(--text-faint)" }}>
                  Nothing announced yet.
                </p>
              )}
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wide mb-1" style={{ color: "var(--text-faint)" }}>
                Recent
              </p>
              {data.recent.length ? (
                <ul>
                  {data.recent.map((e, i) => (
                    <Row key={i} e={e} today={data.today} />
                  ))}
                </ul>
              ) : (
                <p className="text-xs" style={{ color: "var(--text-faint)" }}>
                  None in the last 30 days.
                </p>
              )}
            </div>
          </div>
        )}
      </Panel>
    </div>
  );
}
