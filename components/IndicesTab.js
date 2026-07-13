"use client";

import { useEffect, useState } from "react";

function fmt(n, digits = 2) {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return n.toLocaleString("en-IN", { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

function IndexRow({ item, rank }) {
  const up = (item.changePercent ?? 0) >= 0;
  return (
    <div
      className="flex items-center justify-between px-4 py-3 border-b last:border-b-0"
      style={{ borderColor: "var(--border)" }}
    >
      <div className="flex items-center gap-3">
        {rank && (
          <span
            className="font-display text-sm w-5 text-center"
            style={{ color: "var(--accent)" }}
          >
            {rank}
          </span>
        )}
        <div className="flex flex-col">
          <span className="text-sm" style={{ color: "var(--text)" }}>
            {item.name}
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
          All tracked indices
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
