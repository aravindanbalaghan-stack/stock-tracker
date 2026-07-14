"use client";

import { useEffect, useState } from "react";

function fmt(n, digits = 2) {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return n.toLocaleString("en-IN", { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

// Indices we have a constituent list for — only these get the "top 5
// stocks in this index" expand/drill-down.
const DRILLABLE = new Set([
  "^NSEI", "^NSEBANK", "^CNXIT", "^CNXAUTO", "^CNXPHARMA", "^CNXFMCG",
  "^CNXMETAL", "^CNXREALTY", "^CNXENERGY", "^CNXPSUBANK", "^CNXFIN",
]);

function ConstituentRow({ row }) {
  const up = (row.changePercent ?? 0) >= 0;
  return (
    <div className="flex items-center justify-between px-3 py-1.5">
      <span className="font-mono text-xs" style={{ color: "var(--text)" }}>{row.symbol}</span>
      <div className="flex items-center gap-3">
        <span className="font-mono text-xs" style={{ color: "var(--text-muted)" }}>₹{fmt(row.price)}</span>
        <span className="font-mono text-xs w-16 text-right" style={{ color: up ? "var(--gain)" : "var(--loss)" }}>
          {up ? "+" : ""}{fmt(row.changePercent)}%
        </span>
      </div>
    </div>
  );
}

function IndexRow({ item, rank }) {
  const up = (item.changePercent ?? 0) >= 0;
  const drillable = DRILLABLE.has(item.symbol);
  const [expanded, setExpanded] = useState(false);
  const [constituents, setConstituents] = useState(null);
  const [loadingConstituents, setLoadingConstituents] = useState(false);

  async function toggle() {
    if (!drillable) return;
    if (expanded) {
      setExpanded(false);
      return;
    }
    setExpanded(true);
    if (!constituents) {
      setLoadingConstituents(true);
      try {
        const res = await fetch(`/api/index-stocks?index=${encodeURIComponent(item.symbol)}`);
        const json = await res.json();
        setConstituents(res.ok ? json.top5 : []);
      } catch {
        setConstituents([]);
      } finally {
        setLoadingConstituents(false);
      }
    }
  }

  return (
    <div className="border-b last:border-b-0" style={{ borderColor: "var(--border)" }}>
      <div
        className={`flex items-center justify-between px-4 py-3 ${drillable ? "cursor-pointer hover:bg-white/5" : ""}`}
        onClick={toggle}
      >
        <div className="flex items-center gap-3">
          {rank && (
            <span className="font-display text-sm w-5 text-center" style={{ color: "var(--accent)" }}>
              {rank}
            </span>
          )}
          <div className="flex flex-col">
            <span className="text-sm flex items-center gap-1.5" style={{ color: "var(--text)" }}>
              {item.name}
              {drillable && (
                <span className="text-[10px]" style={{ color: "var(--text-faint)" }}>
                  {expanded ? "▲" : "▼"}
                </span>
              )}
            </span>
            <span className="font-mono text-[11px]" style={{ color: "var(--text-faint)" }}>
              {item.symbol}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <span className="font-mono text-sm" style={{ color: "var(--text)" }}>
            {fmt(item.price)}
          </span>
          <span
            className="font-mono text-sm w-20 text-right"
            style={{ color: up ? "var(--gain)" : "var(--loss)" }}
          >
            {up ? "+" : ""}
            {fmt(item.changePercent)}%
          </span>
        </div>
      </div>

      {expanded && (
        <div className="pb-2" style={{ background: "var(--surface-2)" }}>
          <div className="px-4 pt-2 pb-1 text-[10px] uppercase tracking-wider" style={{ color: "var(--text-faint)" }}>
            Top 5 in this index today
          </div>
          {loadingConstituents ? (
            <div className="px-4 py-2 text-xs" style={{ color: "var(--text-muted)" }}>Loading…</div>
          ) : constituents && constituents.length > 0 ? (
            constituents.map((row) => <ConstituentRow row={row} key={row.symbol} />)
          ) : (
            <div className="px-4 py-2 text-xs" style={{ color: "var(--text-muted)" }}>No data available.</div>
          )}
        </div>
      )}
    </div>
  );
}

export default function IndicesTab() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/indices");
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error || "Failed to load indices");
        if (!cancelled) setData(json);
      } catch (err) {
        if (!cancelled) setError(err.message);
      }
    }
    load();
    const id = setInterval(load, 30000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  if (error) {
    return (
      <div className="rounded-md border px-4 py-3 text-sm" style={{ borderColor: "var(--loss)", background: "var(--loss-dim)", color: "var(--text)" }}>
        {error}
      </div>
    );
  }

  if (!data) {
    return <div className="py-16 text-center text-sm" style={{ color: "var(--text-muted)" }}>Loading indices…</div>;
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="font-display text-lg mb-2" style={{ color: "var(--text)" }}>
          Top 5 performing indices today
        </h2>
        <div className="rounded-lg border overflow-hidden" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
          {data.top5.map((item, i) => (
            <IndexRow item={item} rank={i + 1} key={item.symbol} />
          ))}
        </div>
      </div>

      <div>
        <h3 className="text-xs uppercase tracking-wider mb-2" style={{ color: "var(--text-faint)" }}>
          All tracked indices — tap one to see its top 5 stocks today
        </h3>
        <div className="rounded-lg border overflow-hidden" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
          {[...data.all]
            .sort((a, b) => (b.changePercent ?? -Infinity) - (a.changePercent ?? -Infinity))
            .map((item) => (
              <IndexRow item={item} key={item.symbol} />
            ))}
        </div>
      </div>
    </div>
  );
}
