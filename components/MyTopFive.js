"use client";

// Home → My Top 5: the stocks given a Top 5 slot in the Watchlist, in slot
// order. Fed from the page's own live-quote poll, so it updates by itself;
// changing a slot in the Watchlist changes this straight away.

import SymbolLink from "@/components/SymbolLink";
import { SectionTitle, LoadingState } from "@/components/ui/Chrome";

function fmt(n, d = 2) {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return n.toLocaleString("en-IN", { maximumFractionDigits: d, minimumFractionDigits: d });
}
const tone = (v) => (v == null ? "var(--text-faint)" : v >= 0 ? "var(--gain)" : "var(--loss)");
const signed = (v, d = 2) => (v == null ? "—" : `${v >= 0 ? "+" : ""}${fmt(v, d)}%`);
function fmtTurnover(cr) {
  if (cr == null) return "—";
  if (cr >= 1000) return `₹${Math.round(cr).toLocaleString("en-IN")} Cr`;
  if (cr >= 10) return `₹${cr.toFixed(1)} Cr`;
  return `₹${cr.toFixed(2)} Cr`;
}

function RangeBar({ low, high, price }) {
  const ok = low != null && high != null && price != null && high > low;
  const pct = ok ? Math.min(100, Math.max(0, ((price - low) / (high - low)) * 100)) : null;
  return (
    <div>
      <div className="relative h-1 rounded-full" style={{ background: "var(--border)" }}>
        {pct != null && (
          <div
            className="absolute top-1/2 -translate-y-1/2 w-2 h-2 rounded-full"
            style={{ left: `calc(${pct}% - 4px)`, background: "var(--accent)" }}
          />
        )}
      </div>
      <div className="flex justify-between mt-1 text-[10px] font-mono" style={{ color: "var(--text-faint)" }}>
        <span>{fmt(low)}</span>
        <span>day range</span>
        <span>{fmt(high)}</span>
      </div>
    </div>
  );
}

function Card({ item }) {
  const q = item.quote;
  const live = q && q.ok !== false;
  const added = item.meta?.addedPrice;
  const sinceAdded = live && added ? ((q.price - added) / added) * 100 : null;
  return (
    <div className="rounded-[var(--radius)] border p-3 flex flex-col gap-2.5" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <span className="flex items-center gap-1.5">
            <span
              className="text-[10px] font-semibold font-mono px-1.5 py-0.5 rounded"
              style={{ background: "var(--accent)", color: "var(--bg)" }}
            >
              #{item.rank}
            </span>
            <SymbolLink symbol={item.symbol} className="text-sm" />
          </span>
          {q?.name && (
            <p className="text-[11px] truncate mt-0.5" style={{ color: "var(--text-muted)" }}>
              {q.name}
            </p>
          )}
        </div>
        <span
          className="font-mono text-xs px-1.5 py-0.5 rounded whitespace-nowrap"
          style={{
            color: tone(live ? q.changePercent : null),
            background: live ? (q.changePercent >= 0 ? "var(--gain-dim)" : "var(--loss-dim)") : "var(--surface-2)",
          }}
        >
          {live ? signed(q.changePercent) : "—"}
        </span>
      </div>

      <p className="font-mono text-xl" style={{ color: "var(--text)" }}>
        {live ? `₹${fmt(q.price)}` : "—"}
      </p>

      <RangeBar low={live ? q.dayLow : null} high={live ? q.dayHigh : null} price={live ? q.price : null} />

      <div className="grid grid-cols-3 gap-2 text-[11px]">
        <div>
          <p style={{ color: "var(--text-faint)" }}>Since added</p>
          <p className="font-mono" style={{ color: tone(sinceAdded) }}>
            {signed(sinceAdded, 1)}
          </p>
        </div>
        <div>
          <p style={{ color: "var(--text-faint)" }}>Deliv. %</p>
          <p className="font-mono" style={{ color: "var(--text-muted)" }}>
            {item.metrics?.deliveryPct == null ? "—" : `${fmt(item.metrics.deliveryPct, 1)}%`}
          </p>
        </div>
        <div>
          <p style={{ color: "var(--text-faint)" }}>Turnover</p>
          <p className="font-mono" style={{ color: "var(--text-muted)" }}>
            {fmtTurnover(item.metrics?.turnoverCr)}
          </p>
        </div>
      </div>

      {item.meta?.notes && (
        <p className="text-[11px] leading-snug line-clamp-2" style={{ color: "var(--text-muted)" }} title={item.meta.notes}>
          “{item.meta.notes}”
        </p>
      )}
    </div>
  );
}

export default function MyTopFive({ items, loading, onOpenWatchlist }) {
  return (
    <section>
      <SectionTitle meta={items.length ? "Live prices · pick or change slots in the Watchlist's Top 5 column" : null}>
        My Top 5
      </SectionTitle>
      {loading && !items.some((i) => i.quote) && items.length > 0 ? (
        <LoadingState>Loading live prices…</LoadingState>
      ) : items.length === 0 ? (
        <div
          className="rounded-[var(--radius)] border border-dashed p-4 flex flex-wrap items-center justify-between gap-3"
          style={{ borderColor: "var(--border)" }}
        >
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            No Top 5 picked yet. Give up to five watchlist stocks a slot (#1–#5) in the Watchlist&apos;s Top 5 column and
            they&apos;ll appear here.
          </p>
          <button
            type="button"
            onClick={onOpenWatchlist}
            className="text-xs px-3 py-1.5 rounded border"
            style={{ borderColor: "var(--accent)", color: "var(--accent)" }}
          >
            Open Watchlist
          </button>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {items.map((it) => (
            <Card key={it.symbol} item={it} />
          ))}
        </div>
      )}
    </section>
  );
}
