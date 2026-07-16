"use client";

import { useEffect, useRef, useState } from "react";

function fmt(n, digits = 2) {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return n.toLocaleString("en-IN", { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

function fmtVolume(n) {
  if (!n) return "—";
  if (n >= 1e7) return `${(n / 1e7).toFixed(2)}Cr`;
  if (n >= 1e5) return `${(n / 1e5).toFixed(2)}L`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(n);
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

function Row({ quote, meta, onRemove, onNotesChange }) {
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
          <span className="font-mono text-sm" style={{ color: "var(--text)" }}>
            {quote.symbol}
          </span>
          <span className="text-xs truncate max-w-[160px]" style={{ color: "var(--text-muted)" }}>
            {quote.name}
          </span>
        </div>
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
        {fmtVolume(quote.volume)}
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

export default function WatchlistTable({ quotes, meta, onRemove, onNotesChange }) {
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

  return (
    <div className="rounded-lg border overflow-hidden overflow-x-auto" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
      <table className="w-full border-collapse">
        <thead>
          <tr className="text-left border-b" style={{ borderColor: "var(--border)" }}>
            <th className="py-2 pl-4 pr-2 text-xs font-medium uppercase tracking-wider" style={{ color: "var(--text-faint)" }}>
              Symbol
            </th>
            <th className="py-2 px-2 text-xs font-medium uppercase tracking-wider text-right" style={{ color: "var(--text-faint)" }}>
              LTP
            </th>
            <th className="py-2 px-2 text-xs font-medium uppercase tracking-wider text-right" style={{ color: "var(--text-faint)" }}>
              Chg
            </th>
            <th className="py-2 px-2 text-xs font-medium uppercase tracking-wider text-right" style={{ color: "var(--text-faint)" }}>
              Chg %
            </th>
            <th className="py-2 px-2 text-xs font-medium uppercase tracking-wider text-right hidden sm:table-cell" style={{ color: "var(--text-faint)" }}>
              Added
            </th>
            <th className="py-2 px-2 text-xs font-medium uppercase tracking-wider hidden md:table-cell" style={{ color: "var(--text-faint)" }}>
              Day range
            </th>
            <th className="py-2 px-2 text-xs font-medium uppercase tracking-wider text-right hidden lg:table-cell" style={{ color: "var(--text-faint)" }}>
              Volume
            </th>
            <th className="py-2 px-2 text-xs font-medium uppercase tracking-wider hidden lg:table-cell" style={{ color: "var(--text-faint)" }}>
              Notes
            </th>
            <th className="py-2 pl-2 pr-4"></th>
          </tr>
        </thead>
        <tbody>
          {quotes.map((q) => (
            <Row
              quote={q}
              meta={meta?.[q.symbol]}
              key={q.symbol}
              onRemove={onRemove}
              onNotesChange={onNotesChange}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}
