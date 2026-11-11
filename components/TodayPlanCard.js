"use client";

// Home → Today's plan: the latest Analysis entry at a glance (bias, levels,
// ideas, lesson), or a prompt to write today's.

import { useEffect, useState } from "react";
import SymbolLink from "@/components/SymbolLink";
import { SectionTitle } from "@/components/ui/Chrome";
import { marketIsOpen, isTradingDayToday } from "@/lib/marketHours";

const TONE = { Bullish: "var(--gain)", Bearish: "var(--loss)", Neutral: "var(--accent)" };

export default function TodayPlanCard({ onOpenAnalysis }) {
  const [data, setData] = useState(null);
  useEffect(() => {
    fetch("/api/analysis?summary=1")
      .then((r) => (r.ok ? r.json() : null))
      .then(setData)
      .catch(() => setData(null));
  }, []);
  if (!data) return null;
  const e = data.latest;
  const isToday = e?.date === data.today;

  return (
    <section>
      <SectionTitle
        meta={
          <button type="button" onClick={onOpenAnalysis} className="hover:underline" style={{ color: "var(--accent)" }}>
            Open Analysis →
          </button>
        }
      >
        {isToday ? "Today's plan" : "Your plan"}
      </SectionTitle>
      {!e || (!isToday && isTradingDayToday()) ? (
        <div className="rounded-[var(--radius)] border border-dashed p-4 flex flex-wrap items-center justify-between gap-3" style={{ borderColor: "var(--border)" }}>
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            {e ? `Last analysis: ${e.date}. ` : ""}
            {marketIsOpen() ? "Market's open — " : ""}write today&apos;s view: bias, levels and ideas. Panel grades it against what the market does next.
          </p>
          <button type="button" onClick={onOpenAnalysis} className="text-xs px-3 py-1.5 rounded font-medium" style={{ background: "var(--accent)", color: "var(--bg)" }}>
            Write today&apos;s analysis
          </button>
        </div>
      ) : (
        <div className="rounded-[var(--radius)] border p-3 grid gap-3 md:grid-cols-[auto_1fr]" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
          <div className="flex flex-col gap-1.5 min-w-[13rem]">
            {[
              ["nifty", "NIFTY 50"],
              ["bankNifty", "BANK NIFTY"],
            ].map(([id, label]) => (
              <p key={id} className="text-xs flex items-baseline justify-between gap-3">
                <span style={{ color: "var(--text-muted)" }}>{label}</span>
                <span className="font-semibold" style={{ color: TONE[e.bias?.[id]] ?? "var(--text-faint)" }}>
                  {e.bias?.[id] || "—"}
                </span>
                <span className="font-mono text-[10px]" style={{ color: "var(--text-faint)" }}>
                  {e.levels?.[id]?.support ?? "—"} / {e.levels?.[id]?.resistance ?? "—"}
                </span>
              </p>
            ))}
            {!isToday && (
              <p className="text-[10px]" style={{ color: "var(--text-faint)" }}>
                from {e.date}
              </p>
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            {e.ideas?.length ? (
              <div className="flex flex-wrap gap-2">
                {e.ideas.slice(0, 8).map((i) => (
                  <span key={i.id} className="text-xs px-2 py-1 rounded inline-flex items-center gap-1.5" style={{ background: "var(--surface-2)" }}>
                    <span style={{ color: i.direction === "Long" ? "var(--gain)" : "var(--loss)" }}>{i.direction === "Long" ? "▲" : "▼"}</span>
                    <SymbolLink symbol={i.symbol} className="text-xs" showEvents={false} />
                    <span className="font-mono text-[10px]" style={{ color: "var(--text-faint)" }}>
                      {i.entry ?? "mkt"}
                      {i.stop ? ` · SL ${i.stop}` : ""}
                      {i.target ? ` · T ${i.target}` : ""}
                    </span>
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-xs" style={{ color: "var(--text-faint)" }}>
                No ideas written.
              </p>
            )}
            {e.context && (
              <p className="text-xs line-clamp-2" style={{ color: "var(--text-muted)" }} title={e.context}>
                {e.context}
              </p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
