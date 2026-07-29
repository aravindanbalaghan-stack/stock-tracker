"use client";

import SortableTh from "@/components/SortableTh";

// The two listing-debut columns, shared so every screen renders them
// identically. See lib/debut.js for what the numbers mean — in
// particular, that the debut price is the listing-day open (not the IPO
// issue price) and is split/bonus-adjusted.

function fmt(n, digits = 2) {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return n.toLocaleString("en-IN", { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

export const DEBUT_OPEN_TITLE =
  "Price at which the stock opened on its first day of trading. Split/bonus-adjusted, so it won't match the original headline price for older listings.";

export const VS_DEBUT_TITLE =
  "Where the current price sits against that listing-day open.";

// Header cells — call these inside a <tr> alongside your other SortableTh.
export function DebutHeaderCells({ sort, onSort, lastClassName = "" }) {
  return (
    <>
      <SortableTh
        label="Debut ₹"
        sortKey="debutOpen"
        sort={sort}
        onSort={onSort}
        title={DEBUT_OPEN_TITLE}
      />
      <SortableTh
        label="vs Debut"
        sortKey="vsDebutPct"
        sort={sort}
        onSort={onSort}
        title={VS_DEBUT_TITLE}
        className={lastClassName}
      />
    </>
  );
}

// Body cells — call these inside a <tr> in the same column order.
export function DebutCells({ row, lastClassName = "" }) {
  const pct = row?.vsDebutPct;
  const above = pct != null && pct >= 0;

  return (
    <>
      <td className="py-2.5 px-2 text-right font-mono text-xs" style={{ color: "var(--text-muted)" }}>
        {row?.debutOpen == null ? (
          "—"
        ) : (
          <span title={row.debutDate ? `Listed ${row.debutDate}` : undefined}>₹{fmt(row.debutOpen)}</span>
        )}
      </td>
      <td className={`py-2.5 px-2 text-right ${lastClassName}`}>
        {pct == null ? (
          <span className="font-mono text-xs" style={{ color: "var(--text-faint)" }}>
            —
          </span>
        ) : (
          <span
            className="font-mono text-xs px-1.5 py-0.5 rounded whitespace-nowrap"
            style={{
              color: above ? "var(--gain)" : "var(--loss)",
              background: above ? "var(--gain-dim)" : "var(--loss-dim)",
            }}
            title={row.debutDate ? `Listed ${row.debutDate} at ₹${fmt(row.debutOpen)}` : undefined}
          >
            {above ? "▲" : "▼"} {above ? "+" : ""}
            {fmt(pct, 1)}%
          </span>
        )}
      </td>
    </>
  );
}

// How many extra columns these add — used for colSpan on expanded rows.
export const DEBUT_COLSPAN = 2;
