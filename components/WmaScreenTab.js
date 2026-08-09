"use client";

import { useEffect, useState } from "react";
import { useSortableRows } from "@/lib/useSortableRows";
import SortableTh from "@/components/SortableTh";
import { ScreenHeader, ErrorState, LoadingState } from "@/components/ui/Chrome";
import { DebutHeaderCells, DebutCells } from "@/components/DebutCells";
import SymbolLink from "@/components/SymbolLink";

function fmt(n, digits = 2) {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return n.toLocaleString("en-IN", { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

export default function WmaScreenTab() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/wma-screen");
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error || "Failed to load screen");
        if (!cancelled) setData(json);
      } catch (err) {
        if (!cancelled) setError(err.message);
      }
    }
    load();
    const id = setInterval(load, 5 * 60 * 1000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const { sorted, sort, onSort } = useSortableRows(data?.results, "distancePct", "asc");

  if (error) {
    return (
      <ErrorState>{error}</ErrorState>
    );
  }

  if (!data) {
    return (
      <LoadingState>
        Scanning {" "}{"~180"} stocks against their 30-week average — this can take a moment…
      </LoadingState>
    );
  }

  return (
    <div>
      <ScreenHeader
        title="30WMA watch"
        meta={`Near the 30-week average after a recent breakout · as of ${data.asOf ?? "—"}`}
      />
      <p className="text-xs mb-4" style={{ color: "var(--text-faint)" }}>
        Crossed above the 30WMA within the last {data.criteria?.crossLookbackDays ?? 7} trading days,
        currently within ±{data.criteria?.nearBandPct ?? 1}% of it, delivery % ≥ {data.criteria?.minDeliveryPct ?? 60}%.
      </p>

      {data.results.length === 0 ? (
        <div className="rounded-[var(--radius)] border py-12 text-center text-sm" style={{ borderColor: "var(--border)", background: "var(--surface)", color: "var(--text-muted)" }}>
          No stocks currently match all three conditions.
        </div>
      ) : (
        <div className="rounded-[var(--radius)] border overflow-hidden" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
         <div className="table-scroll">
          <table className="w-full border-collapse table-sticky">
            <thead>
              <tr className="text-left border-b" style={{ borderColor: "var(--border)" }}>
                <SortableTh label="Symbol" sortKey="symbol" sort={sort} onSort={onSort} align="left" className="pl-4" />
                <SortableTh label="Price" sortKey="price" sort={sort} onSort={onSort} />
                <SortableTh label="30WMA" sortKey="wma30" sort={sort} onSort={onSort} />
                <SortableTh label="Distance" sortKey="distancePct" sort={sort} onSort={onSort} />
                <SortableTh label="Deliv. %" sortKey="deliveryPct" sort={sort} onSort={onSort} />
                <DebutHeaderCells sort={sort} onSort={onSort} lastClassName="pr-4" />
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => {
                const above = r.distancePct >= 0;
                return (
                  <tr key={r.symbol} className="border-b last:border-b-0" style={{ borderColor: "var(--border)" }}>
                    <td className="py-2.5 pl-4 pr-2"><SymbolLink symbol={r.symbol} className="text-sm" /></td>
                    <td className="py-2.5 px-2 text-right font-mono text-sm" style={{ color: "var(--text)" }}>₹{fmt(r.price)}</td>
                    <td className="py-2.5 px-2 text-right font-mono text-sm" style={{ color: "var(--text-muted)" }}>₹{fmt(r.wma30)}</td>
                    <td className="py-2.5 px-2 text-right font-mono text-sm" style={{ color: above ? "var(--gain)" : "var(--loss)" }}>
                      {above ? "+" : ""}{fmt(r.distancePct)}%
                    </td>
                    <td className="py-2.5 px-2 text-right font-mono text-sm" style={{ color: "var(--accent)" }}>{fmt(r.deliveryPct)}%</td>
                    <DebutCells row={r} lastClassName="pr-4" />
                  </tr>
                );
              })}
            </tbody>
          </table>
         </div>
        </div>
      )}

      <p className="mt-3 text-xs" style={{ color: "var(--text-faint)" }}>
        Universe: Nifty 50 + Nifty Midcap 150 (~180 stocks). The 30WMA is treated as roughly flat across
        the lookback window, which is standard for this kind of screen since it only moves once a
        trading week completes.
      </p>
    </div>
  );
}
