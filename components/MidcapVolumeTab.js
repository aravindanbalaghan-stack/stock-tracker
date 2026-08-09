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

function fmtVolume(n) {
  if (!n) return "—";
  if (n >= 1e7) return `${(n / 1e7).toFixed(2)}Cr`;
  if (n >= 1e5) return `${(n / 1e5).toFixed(2)}L`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(n);
}

export default function MidcapVolumeTab() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/midcap-volume");
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error || "Failed to load midcap screen");
        if (!cancelled) setData(json);
      } catch (err) {
        if (!cancelled) setError(err.message);
      }
    }
    load();
    const id = setInterval(load, 45000); // live data now — refresh roughly as often as the watchlist
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const { sorted, sort, onSort } = useSortableRows(data?.results, "volumeRatio", "desc");

  if (error) {
    return (
      <ErrorState>{error}</ErrorState>
    );
  }

  if (!data) {
    return (
      <LoadingState>
        Scanning the midcap universe for unusual volume…
      </LoadingState>
    );
  }

  return (
    <div>
      <ScreenHeader
        title="Midcap movers"
        meta={`Trading above their 30-day average volume${data.fetchedAt ? ` · updated ${new Date(data.fetchedAt).toLocaleTimeString("en-IN")}` : ""}`}
      />

      {data.results.length === 0 ? (
        <div className="rounded-[var(--radius)] border py-12 text-center text-sm" style={{ borderColor: "var(--border)", background: "var(--surface)", color: "var(--text-muted)" }}>
          No midcap stocks are currently trading above their 30-day average volume.
        </div>
      ) : (
        <div className="rounded-[var(--radius)] border overflow-hidden" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
         <div className="table-scroll">
          <table className="w-full border-collapse table-sticky">
            <thead>
              <tr className="text-left border-b" style={{ borderColor: "var(--border)" }}>
                <SortableTh label="Symbol" sortKey="symbol" sort={sort} onSort={onSort} align="left" className="pl-4" />
                <SortableTh label="Close" sortKey="close" sort={sort} onSort={onSort} />
                <SortableTh label="Chg %" sortKey="changePercent" sort={sort} onSort={onSort} />
                <SortableTh label="Volume" sortKey="volume" sort={sort} onSort={onSort} />
                <SortableTh label="30d Avg" sortKey="avgVolume30d" sort={sort} onSort={onSort} />
                <SortableTh label="vs Avg" sortKey="volumeRatio" sort={sort} onSort={onSort} />
                <DebutHeaderCells sort={sort} onSort={onSort} lastClassName="pr-4" />
              </tr>
            </thead>
            <tbody>
              {sorted.map((r, i) => {
                const up = (r.changePercent ?? 0) >= 0;
                return (
                  <tr key={r.symbol} className="border-b last:border-b-0" style={{ borderColor: "var(--border)" }}>
                    <td className="py-2.5 pl-4 pr-2">
                      <div className="flex items-center gap-2">
                        <span className="text-xs w-5" style={{ color: "var(--accent)" }}>{i + 1}</span>
                        <SymbolLink symbol={r.symbol} className="text-sm" />
                      </div>
                    </td>
                    <td className="py-2.5 px-2 text-right font-mono text-sm" style={{ color: "var(--text)" }}>₹{fmt(r.close)}</td>
                    <td className="py-2.5 px-2 text-right font-mono text-sm" style={{ color: up ? "var(--gain)" : "var(--loss)" }}>
                      {r.changePercent == null ? "—" : `${up ? "+" : ""}${fmt(r.changePercent)}%`}
                    </td>
                    <td className="py-2.5 px-2 text-right font-mono text-xs" style={{ color: "var(--text-muted)" }}>{fmtVolume(r.volume)}</td>
                    <td className="py-2.5 px-2 text-right font-mono text-xs" style={{ color: "var(--text-faint)" }}>{fmtVolume(r.avgVolume30d)}</td>
                    <td className="py-2.5 px-2 text-right font-mono text-xs" style={{ color: "var(--accent)" }}>
                      {r.volumeRatio ? `${r.volumeRatio.toFixed(1)}×` : "—"}
                    </td>
                    <DebutCells row={r} lastClassName="pr-4" />
                  </tr>
                );
              })}
            </tbody>
          </table>
         </div>
        </div>
      )}
    </div>
  );
}
