"use client";

// Stock page → Technical View: the stock through the five front-row
// screens, one card each, with a summary strip on top. Green = matches the
// screen, amber = the screen's watch/early state, grey = doesn't match
// (the checklist says which rule), dashed = screen doesn't apply.

import { useEffect, useState } from "react";
import { ErrorState, LoadingState } from "@/components/ui/Chrome";
import { formatDayLabel } from "@/lib/periodLabel";

const STATUS = {
  match: { label: "Match", color: "var(--gain)", bg: "var(--gain-dim)", dot: "●" },
  watch: { label: "Watch", color: "var(--tier-mid)", bg: "var(--tier-mid-dim)", dot: "◐" },
  no: { label: "No", color: "var(--text-faint)", bg: "var(--surface-2)", dot: "○" },
  na: { label: "N/A", color: "var(--text-faint)", bg: "transparent", dot: "–" },
};

function Pill({ status, children }) {
  const s = STATUS[status] ?? STATUS.na;
  return (
    <span
      className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap"
      style={{ color: s.color, background: s.bg, border: status === "na" ? "1px dashed var(--border)" : "none" }}
    >
      <span aria-hidden>{s.dot}</span>
      {children ?? s.label}
    </span>
  );
}

function Card({ card }) {
  const s = STATUS[card.status] ?? STATUS.na;
  const [open, setOpen] = useState(card.status === "match" || card.status === "watch");
  return (
    <div
      className="rounded-[var(--radius)] border flex flex-col"
      style={{
        borderColor: card.status === "match" ? "var(--gain)" : card.status === "watch" ? "var(--tier-mid)" : "var(--border)",
        borderStyle: card.status === "na" ? "dashed" : "solid",
        background: "var(--surface)",
      }}
    >
      <button type="button" onClick={() => setOpen((v) => !v)} className="text-left p-3 flex flex-col gap-1.5">
        <span className="flex items-center justify-between gap-2">
          <span className="text-sm font-semibold" style={{ color: "var(--text)" }}>
            {card.label}
          </span>
          <Pill status={card.status} />
        </span>
        <span className="text-xs" style={{ color: card.status === "no" || card.status === "na" ? "var(--text-muted)" : s.color }}>
          {card.headline}
        </span>
      </button>

      {card.metrics?.length > 0 && (
        <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 px-3 pb-3">
          {card.metrics.map((m) => (
            <div key={m.label}>
              <p className="text-[10px] uppercase tracking-wide" style={{ color: "var(--text-faint)" }}>
                {m.label}
              </p>
              <p className="font-mono text-xs" style={{ color: "var(--text)" }}>
                {m.value}
              </p>
            </div>
          ))}
        </div>
      )}

      {card.checks?.length > 0 && (
        <div className="border-t px-3 py-2" style={{ borderColor: "var(--border)" }}>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="text-[11px] mb-1"
            style={{ color: "var(--accent)" }}
          >
            {open ? "Hide checklist ▴" : `Checklist · ${card.checks.filter((c) => c.pass).length}/${card.checks.length} ✓ ▾`}
          </button>
          {open && (
            <ul className="flex flex-col gap-1">
              {card.checks.map((c) => (
                <li key={c.label} className="flex gap-2 text-xs leading-snug">
                  <span style={{ color: c.pass ? "var(--gain)" : "var(--loss)" }} aria-label={c.pass ? "pass" : "fail"}>
                    {c.pass ? "✓" : "✗"}
                  </span>
                  <span>
                    <span style={{ color: "var(--text)" }}>{c.label}</span>
                    {c.value && <span style={{ color: "var(--text-faint)" }}> — {c.value}</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {card.note && (
        <p className="px-3 pb-3 text-[11px] leading-snug" style={{ color: "var(--text-faint)" }}>
          {card.note}
        </p>
      )}
    </div>
  );
}

export default function TechnicalView({ symbol }) {
  const [loaded, setLoaded] = useState({ key: null, data: null, error: null });
  const data = loaded.key === symbol ? loaded.data : null;
  const error = loaded.key === symbol ? loaded.error : null;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/technical-view?symbol=${encodeURIComponent(symbol)}`);
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error || "Couldn't build the technical view");
        if (!cancelled) setLoaded({ key: symbol, data: json, error: null });
      } catch (err) {
        if (!cancelled) setLoaded({ key: symbol, data: null, error: err.message });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [symbol]);

  if (error) return <ErrorState>{error}</ErrorState>;
  if (!data) return <LoadingState>Running {symbol} through the five screens…</LoadingState>;

  return (
    <div>
      {/* Summary strip — the whole picture at a glance */}
      <div
        className="rounded-[var(--radius)] border p-3 mb-3 flex flex-wrap items-center gap-x-4 gap-y-2"
        style={{ borderColor: "var(--border)", background: "var(--surface)" }}
      >
        <span className="text-sm" style={{ color: "var(--text)" }}>
          <span className="font-semibold" style={{ color: data.matches ? "var(--gain)" : "var(--text)" }}>
            {data.matches} of {data.cards.length}
          </span>{" "}
          screens match
          {data.watching > 0 && (
            <span style={{ color: "var(--tier-mid)" }}>
              {" "}
              · {data.watching} on watch
            </span>
          )}
        </span>
        <span className="flex flex-wrap gap-1.5">
          {data.cards.map((c) => (
            <Pill key={c.id} status={c.status}>
              {c.label}
            </Pill>
          ))}
        </span>
        <span className="text-[11px] ml-auto" style={{ color: "var(--text-faint)" }}>
          As of the {formatDayLabel(data.asOf)} close · same rules as the Screeners tab
        </span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {[...data.cards]
          .sort((a, b) => ["match", "watch", "no", "na"].indexOf(a.status) - ["match", "watch", "no", "na"].indexOf(b.status))
          .map((c) => (
            <Card key={c.id} card={c} />
          ))}
      </div>
    </div>
  );
}
