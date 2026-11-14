"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { useSortableRows } from "@/lib/useSortableRows";
import { usePersistentState } from "@/lib/usePersistentState";
import SortableTh from "@/components/SortableTh";
import SymbolLink from "@/components/SymbolLink";
import { volumeFigures } from "@/lib/liveVolume";
import { fmt, fmtVolume, fmtTurnover } from "@/lib/format";
import TableFrame from "@/components/ui/TableFrame";

// How many <SortableTh>/<th> cells the header row has — the date-group
// separator row spans all of them. Kept as a named constant rather than a
// magic number so a future column addition is an obvious two-line diff.
const COLUMN_COUNT = 14;

function formatGroupDate(dateKey) {
  if (!dateKey) return "Added before this was tracked";
  const today = new Date();
  const todayKey = today.toISOString().slice(0, 10);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayKey = yesterday.toISOString().slice(0, 10);
  if (dateKey === todayKey) return "Added today";
  if (dateKey === yesterdayKey) return "Added yesterday";
  const d = new Date(`${dateKey}T00:00:00`);
  return `Added ${d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric" })}`;
}

function GroupHeaderRow({ dateKey, count }) {
  return (
    <tr style={{ background: "var(--surface-2)" }}>
      <td colSpan={COLUMN_COUNT} className="py-1.5 px-4">
        <span className="text-[11px] font-medium uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
          {formatGroupDate(dateKey)}
        </span>
        <span className="text-[11px] ml-2" style={{ color: "var(--text-faint)" }}>
          {count} stock{count === 1 ? "" : "s"}
        </span>
      </td>
    </tr>
  );
}
function DayRangeBar({ low, high, price }) {
  if (low == null || high == null || price == null || high === low) {
    return <div className="h-1 rounded-full w-24" style={{ background: "var(--border)" }} />;
  }
  const pct = Math.min(100, Math.max(0, ((price - low) / (high - low)) * 100));
  return (
    <div className="relative h-1 rounded-full w-24" style={{ background: "var(--border)" }}>
      <div
        className="absolute top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full"
        style={{ left: `calc(${pct}% - 3px)`, background: "var(--accent)" }}
      />
    </div>
  );
}

function AddedCell({ addedPrice, currentPrice }) {
  if (addedPrice == null) {
    return <span className="text-xs" style={{ color: "var(--text-faint)" }}>—</span>;
  }
  const sinceAdded =
    currentPrice != null ? ((currentPrice - addedPrice) / addedPrice) * 100 : null;
  const up = (sinceAdded ?? 0) >= 0;
  return (
    <div className="flex flex-col items-end">
      <span className="font-mono text-sm" style={{ color: "var(--text)" }}>₹{fmt(addedPrice)}</span>
      {sinceAdded != null && (
        <span className="text-[10px] font-mono" style={{ color: up ? "var(--gain)" : "var(--loss)" }}>
          {up ? "+" : ""}{fmt(sinceAdded)}% since
        </span>
      )}
    </div>
  );
}

function NotesCell({ symbol, notes, onNotesChange }) {
  const [value, setValue] = useState(notes ?? "");

  function commit() {
    if (value !== (notes ?? "")) onNotesChange(symbol, value);
  }

  return (
    <input
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
      placeholder="Add a note…"
      className="w-full rounded px-2 py-1 text-xs outline-none border bg-transparent"
      style={{ borderColor: "var(--border)", color: "var(--text)" }}
    />
  );
}

function AccumulationCell({ status }) {
  if (!status || status.inAccumulation == null) {
    return <span className="text-xs" style={{ color: "var(--text-faint)" }}>—</span>;
  }
  const { inAccumulation, firstYes } = status;
  const title = inAccumulation
    ? firstYes
      ? `First flagged in accumulation on ${firstYes}`
      : "Currently reads as accumulation"
    : "Not currently reading as accumulation — delivery % above threshold on fewer than the required days of the last 20";
  return (
    <span
      title={title}
      className="text-xs font-medium px-1.5 py-0.5 rounded border cursor-default"
      style={{
        borderColor: inAccumulation ? "var(--gain)" : "var(--border)",
        color: inAccumulation ? "var(--gain)" : "var(--text-faint)",
      }}
    >
      {inAccumulation ? "Yes" : "No"}
    </span>
  );
}

// Turnover in ₹ Cr, compact: 0.84 Cr / 12.3 Cr / 1,240 Cr.
function VolRatioCell({ ratio }) {
  if (ratio == null) return <span style={{ color: "var(--text-faint)" }}>—</span>;
  const color = ratio >= 2 ? "var(--accent)" : ratio >= 1 ? "var(--text)" : "var(--text-faint)";
  return <span style={{ color }}>{ratio.toFixed(2)}×</span>;
}

function DeliveryCell({ pct }) {
  if (pct == null) return <span style={{ color: "var(--text-faint)" }}>—</span>;
  const color = pct >= 70 ? "var(--tier-high)" : pct >= 50 ? "var(--tier-mid)" : "var(--text-muted)";
  return <span style={{ color }}>{pct.toFixed(1)}%</span>;
}

// Top 5 slot picker. Picking a slot another stock holds moves this one in
// and bumps that one off — the option label says who.
function TopRankCell({ symbol, rank, slotHolders, onChange }) {
  return (
    <select
      value={rank ?? ""}
      onChange={(e) => onChange(symbol, e.target.value ? Number(e.target.value) : null)}
      aria-label={`Top 5 slot for ${symbol}`}
      className="rounded-[var(--radius-sm)] px-1.5 py-1 text-xs border font-mono"
      style={{
        background: rank ? "var(--accent)" : "var(--surface-2)",
        color: rank ? "var(--bg)" : "var(--text-muted)",
        borderColor: rank ? "var(--accent)" : "var(--border)",
        fontWeight: rank ? 600 : 400,
      }}
      title={rank ? `#${rank} in your Top 5 — shown on Home` : "Add to your Top 5 on Home"}
    >
      <option value="">—</option>
      {[1, 2, 3, 4, 5].map((n) => {
        const holder = slotHolders[n];
        return (
          <option key={n} value={n}>
            #{n}
            {holder && holder !== symbol ? ` (replaces ${holder})` : ""}
          </option>
        );
      })}
    </select>
  );
}

// Where the volume figures come from: live feed, today's full session
// (after the close, before NSE's file), or NSE's end-of-day file.
function SourceTag({ vf }) {
  if (!vf) return null;
  const label = vf.source === "live" ? "live" : vf.source === "today" ? "today" : "EOD";
  return (
    <span className="block text-[10px]" style={{ color: vf.source === "live" ? "var(--gain)" : "var(--text-faint)" }} title={vf.asOf ? `Session ${vf.asOf}` : undefined}>
      {label}
    </span>
  );
}

function Row({ quote, meta, accumulation, onRemove, onNotesChange, onOpenDetail, slotHolders, onTopRankChange }) {
  const prevPrice = useRef(quote.price);
  const [flash, setFlash] = useState(null);

  useEffect(() => {
    if (prevPrice.current != null && quote.price != null && quote.price !== prevPrice.current) {
      setFlash(quote.price > prevPrice.current ? "flash-gain" : "flash-loss");
      const t = setTimeout(() => setFlash(null), 900);
      prevPrice.current = quote.price;
      return () => clearTimeout(t);
    }
    prevPrice.current = quote.price;
  }, [quote.price]);

  const up = (quote.change ?? 0) >= 0;
  const stale = quote.ok === false;

  return (
    <tr className={`border-b ${flash ?? ""}`} style={{ borderColor: "var(--border)" }}>
      <td className="py-3 pl-4 pr-2">
        <div className="flex flex-col">
          <SymbolLink symbol={quote.symbol} className="text-sm" />
          <span className="text-xs truncate max-w-[160px]" style={{ color: "var(--text-muted)" }}>
            {quote.name}
          </span>
          {meta?.source && (
            <span
              className="text-[10px] mt-0.5 truncate max-w-[160px]"
              style={{ color: "var(--text-faint)" }}
              title={`Added from ${meta.source}${
                meta.addedAt ? ` on ${new Date(meta.addedAt).toLocaleDateString("en-IN")}` : ""
              }`}
            >
              via {meta.source}
            </span>
          )}
        </div>
      </td>
      <td className="py-3 px-2">
        <TopRankCell symbol={quote.symbol} rank={meta?.topRank ?? null} slotHolders={slotHolders} onChange={onTopRankChange} />
      </td>
      <td className="py-3 px-2 text-right font-mono text-sm" style={{ color: "var(--text)" }}>
        {stale ? "—" : `₹${fmt(quote.price)}`}
      </td>
      <td className="py-3 px-2 text-right font-mono text-sm" style={{ color: up ? "var(--gain)" : "var(--loss)" }}>
        {stale ? "—" : `${up ? "+" : ""}${fmt(quote.change)}`}
      </td>
      <td className="py-3 px-2 text-right font-mono text-sm" style={{ color: up ? "var(--gain)" : "var(--loss)" }}>
        {stale ? "—" : `${up ? "+" : ""}${fmt(quote.changePercent)}%`}
      </td>
      <td className="py-3 px-2 hidden sm:table-cell">
        <AddedCell addedPrice={meta?.addedPrice} currentPrice={stale ? null : quote.price} />
      </td>
      <td className="py-3 px-2 hidden md:table-cell">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-mono" style={{ color: "var(--text-faint)" }}>
            {fmt(quote.dayLow)}
          </span>
          <DayRangeBar low={quote.dayLow} high={quote.dayHigh} price={quote.price} />
          <span className="text-[11px] font-mono" style={{ color: "var(--text-faint)" }}>
            {fmt(quote.dayHigh)}
          </span>
        </div>
      </td>
      <td className="py-3 px-2 text-right font-mono text-xs hidden lg:table-cell" style={{ color: "var(--text-muted)" }}>
        {fmtVolume(quote._vf?.volume ?? quote.volume)}
        <SourceTag vf={quote._vf} />
      </td>
      <td className="py-3 px-2 text-right font-mono text-xs hidden md:table-cell" style={{ color: "var(--text-muted)" }}>
        {quote._vf?.source !== "eod" && quote._vf?.turnoverCr != null ? "≈" : ""}
        {fmtTurnover(quote._vf?.turnoverCr ?? null)}
      </td>
      <td className="py-3 px-2 text-right font-mono text-xs hidden md:table-cell">
        <VolRatioCell ratio={quote._vf?.ratio ?? null} />
        {quote._vf?.source === "live" && (
          <span className="block text-[10px]" style={{ color: "var(--text-faint)" }}>
            so far{quote._vf.projectedRatio != null ? ` · ~${quote._vf.projectedRatio.toFixed(1)}× day` : ""}
          </span>
        )}
      </td>
      <td className="py-3 px-2 text-right font-mono text-xs hidden md:table-cell">
        <DeliveryCell pct={accumulation?.deliveryPct} />
      </td>
      <td className="py-3 px-2 hidden lg:table-cell">
        <AccumulationCell status={accumulation} />
      </td>
      <td className="py-3 px-2 hidden lg:table-cell" style={{ minWidth: "140px" }}>
        <NotesCell symbol={quote.symbol} notes={meta?.notes} onNotesChange={onNotesChange} />
      </td>
      <td className="py-3 pl-2 pr-4 text-right">
        <button
          onClick={() => onRemove(quote.symbol)}
          className="text-xs px-2 py-1 rounded border transition-colors hover:border-[var(--loss)] hover:text-[var(--loss)]"
          style={{ borderColor: "var(--border)", color: "var(--text-faint)" }}
          aria-label={`Remove ${quote.symbol} from watchlist`}
        >
          Remove
        </button>
      </td>
    </tr>
  );
}

export default function WatchlistTable({
  quotes,
  meta,
  accumulation,
  metricsAsOf,
  onRemove,
  onNotesChange,
  onTopRankChange,
  onOpenDetail,
}) {
  // The bhavcopy-based columns live in `accumulation`, keyed by symbol —
  // merged onto each row here so they can be sorted like any quote field.
  // topRank sorts unpicked stocks last whichever way the column is sorted.
  const rows = quotes.map((q) => {
    const a = accumulation?.[q.symbol];
    const base = { ...q, topRank: meta?.[q.symbol]?.topRank ?? null };
    // Live during the session (and after the close until NSE's file lands),
    // NSE end-of-day otherwise — see lib/liveVolume.js. Merged onto the row
    // so sorting by these columns uses the same numbers that are shown.
    const vf = volumeFigures(q, a, metricsAsOf);
    return {
      ...base,
      _vf: vf,
      volume: vf.volume ?? q.volume,
      turnoverCr: vf.turnoverCr,
      volumeRatio30d: vf.ratio,
      deliveryPct: a?.deliveryPct ?? null,
    };
  });
  const slotHolders = {};
  for (const q of quotes) {
    const r = meta?.[q.symbol]?.topRank;
    if (r) slotHolders[r] = q.symbol;
  }
  const picked = Object.keys(slotHolders).length;
  const { sorted, sort, onSort } = useSortableRows(rows, null, "desc");
  const sessionNote = metricsAsOf ? ` — NSE end-of-day figures for ${metricsAsOf}` : " — NSE end-of-day figures";
  const [groupByDate, setGroupByDate] = usePersistentState("watchlist.groupByDate", false);

  if (quotes.length === 0) {
    return (
      <div
        className="rounded-lg border py-16 text-center"
        style={{ borderColor: "var(--border)", background: "var(--surface)" }}
      >
        <p className="font-display text-lg" style={{ color: "var(--text)" }}>
          Your watchlist is empty
        </p>
        <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>
          Add a stock above to start tracking live prices.
        </p>
      </div>
    );
  }

  // Bucket the already-sorted rows by the calendar day they were added,
  // most recent day first — a symbol with no addedAt (e.g. seeded before
  // this was tracked) falls into its own group at the very end regardless
  // of date order, rather than being mixed in as if it were "oldest".
  let groups = null;
  if (groupByDate) {
    const byKey = new Map();
    for (const q of sorted) {
      const addedAt = meta?.[q.symbol]?.addedAt;
      const key = addedAt ? addedAt.slice(0, 10) : null;
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push(q);
    }
    const orderedKeys = [...byKey.keys()].filter((k) => k !== null).sort((a, b) => (a < b ? 1 : -1));
    if (byKey.has(null)) orderedKeys.push(null);
    groups = orderedKeys.map((key) => ({ key, rows: byKey.get(key) }));
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="text-xs" style={{ color: "var(--text-muted)" }}>
          Top 5:{" "}
          <span className="font-mono" style={{ color: picked ? "var(--accent)" : "var(--text-faint)" }}>
            {picked}/5
          </span>{" "}
          picked — pick a slot in the Top 5 column and it shows on Home
        </span>
        <label className="flex items-center gap-1.5 text-xs cursor-pointer select-none" style={{ color: "var(--text-muted)" }}>
          <input
            type="checkbox"
            checked={groupByDate}
            onChange={(e) => setGroupByDate(e.target.checked)}
            className="accent-current"
          />
          Group by date added
        </label>
      </div>
      <div className="rounded-lg border overflow-hidden overflow-x-auto" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
        <TableFrame name="watchlist-table"><table className="w-full border-collapse">
          <thead>
            <tr className="text-left border-b" style={{ borderColor: "var(--border)" }}>
              <SortableTh label="Symbol" sortKey="symbol" sort={sort} onSort={onSort} align="left" className="pl-4" />
              <SortableTh
                label="Top 5"
                sortKey="topRank"
                sort={sort}
                onSort={onSort}
                align="left"
                title="Your Top 5 slot — these appear at the top of the Home tab, in this order"
              />
              <SortableTh label="LTP" sortKey="price" sort={sort} onSort={onSort} />
              <SortableTh label="Chg" sortKey="change" sort={sort} onSort={onSort} />
              <SortableTh label="Chg %" sortKey="changePercent" sort={sort} onSort={onSort} />
              <th className="py-2 px-2 text-xs font-medium uppercase tracking-wider text-right hidden sm:table-cell" style={{ color: "var(--text-faint)" }}>
                Added
              </th>
              <th className="py-2 px-2 text-xs font-medium uppercase tracking-wider hidden md:table-cell" style={{ color: "var(--text-faint)" }}>
                Day range
              </th>
              <SortableTh label="Volume" sortKey="volume" sort={sort} onSort={onSort} className="hidden lg:table-cell" />
              <SortableTh
                label="Turnover"
                sortKey="turnoverCr"
                sort={sort}
                onSort={onSort}
                className="hidden md:table-cell"
                title="Traded value for the session — live (≈ price × volume) while NSE is open, NSE's end-of-day figure otherwise"
              />
              <SortableTh
                label="Vol vs 30D"
                sortKey="volumeRatio30d"
                sort={sort}
                onSort={onSort}
                className="hidden md:table-cell"
                title="Volume ÷ the 30-session average. Live during the session (shown 'so far', with a rough full-day projection); NSE end-of-day otherwise"
              />
              <SortableTh
                label="Deliv. %"
                sortKey="deliveryPct"
                sort={sort}
                onSort={onSort}
                className="hidden md:table-cell"
                title={`Share of traded quantity marked for delivery${sessionNote}`}
              />
              <th className="py-2 px-2 text-xs font-medium uppercase tracking-wider hidden lg:table-cell" style={{ color: "var(--text-faint)" }} title="Delivery-based accumulation read — see the Delivery tab for the exact rule">
                Accum.
              </th>
              <th className="py-2 px-2 text-xs font-medium uppercase tracking-wider hidden lg:table-cell" style={{ color: "var(--text-faint)" }}>
                Notes
              </th>
              <th className="py-2 pl-2 pr-4"></th>
            </tr>
          </thead>
          <tbody>
            {groups
              ? groups.map((g) => (
                  <Fragment key={g.key ?? "unknown"}>
                    <GroupHeaderRow dateKey={g.key} count={g.rows.length} />
                    {g.rows.map((q) => (
                      <Row
                        quote={q}
                        meta={meta?.[q.symbol]}
                        accumulation={accumulation?.[q.symbol]}
                        key={q.symbol}
                        onRemove={onRemove}
                        onNotesChange={onNotesChange}
                        onOpenDetail={onOpenDetail}
                        slotHolders={slotHolders}
                        onTopRankChange={onTopRankChange}
                      />
                    ))}
                  </Fragment>
                ))
              : sorted.map((q) => (
                  <Row
                    quote={q}
                    meta={meta?.[q.symbol]}
                    accumulation={accumulation?.[q.symbol]}
                    key={q.symbol}
                    onRemove={onRemove}
                    onNotesChange={onNotesChange}
                    onOpenDetail={onOpenDetail}
                    slotHolders={slotHolders}
                    onTopRankChange={onTopRankChange}
                  />
                ))}
          </tbody>
        </table></TableFrame>
      </div>
    </div>
  );
}
