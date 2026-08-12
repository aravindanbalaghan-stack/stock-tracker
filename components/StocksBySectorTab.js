"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import SymbolLink from "@/components/SymbolLink";
import SymbolSearchBox from "@/components/SymbolSearchBox";
import { formatDayLabel } from "@/lib/periodLabel";
import { ScreenHeader, Panel, ErrorState, LoadingState, EmptyState } from "@/components/ui/Chrome";

function fmt(n, d = 2) {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return n.toLocaleString("en-IN", { maximumFractionDigits: d, minimumFractionDigits: d });
}
function vol(n) {
  if (n == null) return "—";
  if (n >= 1e7) return `${(n / 1e7).toFixed(2)}Cr`;
  if (n >= 1e5) return `${(n / 1e5).toFixed(2)}L`;
  return n.toLocaleString("en-IN");
}

function StockRow({ s }) {
  const up = (s.changePercent ?? 0) >= 0;
  return (
    <tr className="border-b last:border-b-0" style={{ borderColor: "var(--border)" }}>
      <td className="py-1.5 pl-8 pr-2">
        <div className="flex items-center gap-1.5">
          <SymbolLink symbol={s.symbol} className="text-xs" />
          {s.isAdded && (
            <span
              className="text-[9px] px-1 py-0.5 rounded border"
              style={{ borderColor: "var(--accent)", color: "var(--accent)" }}
              title="Added to this sector manually"
            >
              added
            </span>
          )}
        </div>
      </td>
      <td className="py-1.5 px-2 text-right font-mono text-xs" style={{ color: "var(--text)" }}>
        ₹{fmt(s.close)}
      </td>
      <td className="py-1.5 px-2 text-right font-mono text-xs" style={{ color: up ? "var(--gain)" : "var(--loss)" }}>
        {s.changePercent == null ? "—" : `${up ? "+" : ""}${fmt(s.changePercent)}%`}
      </td>
      <td className="py-1.5 px-2 text-right font-mono text-xs" style={{ color: "var(--gain)" }}>
        {s.deliveryPct == null ? "—" : `${fmt(s.deliveryPct)}%`}
      </td>
      <td className="py-1.5 px-2 text-right font-mono text-xs" style={{ color: "var(--text-muted)" }}>
        {vol(s.volume)}
      </td>
      <td className="py-1.5 px-2 pr-4 text-right font-mono text-xs" style={{ color: "var(--accent)" }}>
        {s.volumeRatio == null ? "—" : `${fmt(s.volumeRatio)}×`}
      </td>
    </tr>
  );
}

function AddToSector({ sectorKey, sectorName, onAdded }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  async function add(symbol) {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/sector-overrides", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sector: sectorKey, symbol }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Couldn't add");
      setMsg(json.added ? `${symbol} added to ${sectorName}.` : json.message);
      if (json.added) onAdded?.();
    } catch (err) {
      setMsg(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="px-8 py-2.5 border-b" style={{ borderColor: "var(--border)", background: "var(--surface-2)" }}>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[10px] uppercase tracking-wider" style={{ color: "var(--text-faint)" }}>
          Missing a stock?
        </span>
        <SymbolSearchBox
          value=""
          onSelect={add}
          onClear={() => {}}
          placeholder={busy ? "Adding…" : "Search a symbol to add"}
          width="w-52"
        />
      </div>
      {msg && (
        <p className="text-[11px] mt-1.5" style={{ color: "var(--text-muted)" }}>
          {msg}
        </p>
      )}
    </div>
  );
}

export default function StocksBySectorTab() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [expanded, setExpanded] = useState(() => new Set());
  const [query, setQuery] = useState("");
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/stocks-by-sector");
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error || "Couldn't load the sector directory");
        if (!cancelled) {
          setData(json);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError(err.message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadTick]);

  // Searching a symbol should reveal which sector(s) hold it, so matching
  // sectors auto-expand and non-matching stocks are filtered out.
  const q = query.trim().toUpperCase();
  const view = useMemo(() => {
    if (!data) return null;
    if (!q) return { sectors: data.sectors, matchedSymbols: null };
    const sectors = data.sectors
      .map((s) => ({ ...s, stocks: s.stocks.filter((x) => x.symbol.includes(q)) }))
      .filter((s) => s.stocks.length > 0 || s.name.toUpperCase().includes(q));
    return { sectors, matchedSymbols: q };
  }, [data, q]);

  function toggle(key) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  if (error) return <ErrorState>{error}</ErrorState>;
  if (!data) return <LoadingState>Building the sector directory from today&apos;s exchange data…</LoadingState>;

  const unclassifiedMatches = q
    ? data.unclassified.filter((s) => s.symbol.includes(q))
    : data.unclassified;

  return (
    <div>
      <ScreenHeader
        title="All stocks by sector"
        meta={`${data.classifiedCount.toLocaleString("en-IN")} classified across ${data.sectorCount} sectors · trading session of ${formatDayLabel(data.asOf)}`}
        actions={
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value.toUpperCase())}
            placeholder="Filter by symbol or sector…"
            className="rounded-[var(--radius-sm)] px-2.5 py-1.5 text-sm border w-56"
            style={{ background: "var(--surface-2)", borderColor: "var(--border)", color: "var(--text)" }}
          />
        }
      />

      {q && (
        <p className="text-xs mb-3" style={{ color: "var(--text-muted)" }}>
          {view.sectors.length === 0 && unclassifiedMatches.length === 0
            ? `Nothing matching “${q}”.`
            : `Showing sectors containing “${q}”. Expand one to see the match.`}
        </p>
      )}

      <div
        className="rounded-[var(--radius)] border overflow-hidden mb-6"
        style={{ borderColor: "var(--border)", background: "var(--surface)" }}
      >
        <table className="w-full border-collapse">
          <thead>
            <tr className="text-left border-b" style={{ borderColor: "var(--border)", background: "var(--surface-2)" }}>
              <th className="py-2 pl-4 pr-2 text-xs font-medium uppercase tracking-wider" style={{ color: "var(--text-faint)" }}>
                Sector
              </th>
              <th className="py-2 px-2 text-xs font-medium uppercase tracking-wider text-right" style={{ color: "var(--text-faint)" }}>
                Stocks
              </th>
              <th className="py-2 px-2 text-xs font-medium uppercase tracking-wider text-right" style={{ color: "var(--text-faint)" }}>
                Avg deliv. %
              </th>
              <th className="py-2 px-2 text-xs font-medium uppercase tracking-wider text-right" style={{ color: "var(--text-faint)" }} />
              <th className="py-2 px-2 text-xs font-medium uppercase tracking-wider text-right" style={{ color: "var(--text-faint)" }} />
              <th className="py-2 px-2 pr-4" />
            </tr>
          </thead>
          <tbody>
            {view.sectors.map((s) => {
              const isOpen = expanded.has(s.key) || (q && s.stocks.length > 0);
              return (
                <Fragment key={s.key}>
                  <tr
                    className="border-b cursor-pointer hover:bg-white/5"
                    style={{ borderColor: "var(--border)" }}
                    onClick={() => toggle(s.key)}
                  >
                    <td className="py-2.5 pl-4 pr-2">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] w-3" style={{ color: "var(--text-faint)" }}>
                          {isOpen ? "▾" : "▸"}
                        </span>
                        <Link
                          href={`/sector/${encodeURIComponent(s.key)}`}
                          onClick={(e) => e.stopPropagation()}
                          className="text-sm font-medium hover:underline"
                          style={{ color: "var(--text)" }}
                        >
                          {s.name}
                        </Link>
                        {s.addedCount > 0 && (
                          <span className="text-[10px]" style={{ color: "var(--accent)" }}>
                            +{s.addedCount} added
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-2.5 px-2 text-right font-mono text-xs" style={{ color: "var(--text-muted)" }}>
                      {s.tradingCount}/{s.listedCount}
                    </td>
                    <td className="py-2.5 px-2 text-right font-mono text-xs" style={{ color: "var(--text-muted)" }}>
                      {s.avgDeliveryPct == null ? "—" : `${fmt(s.avgDeliveryPct)}%`}
                    </td>
                    <td colSpan={3} />
                  </tr>

                  {isOpen && (
                    <>
                      <tr>
                        <td colSpan={6} className="p-0">
                          <AddToSector
                            sectorKey={s.key}
                            sectorName={s.name}
                            onAdded={() => setReloadTick((t) => t + 1)}
                          />
                        </td>
                      </tr>
                      <tr>
                        <td colSpan={6} className="p-0">
                          <table className="w-full border-collapse">
                            <thead>
                              <tr className="text-left border-b" style={{ borderColor: "var(--border)" }}>
                                <th className="py-1.5 pl-8 pr-2 text-[10px] uppercase tracking-wider" style={{ color: "var(--text-faint)" }}>
                                  Symbol
                                </th>
                                {["Close", "Chg %", "Deliv. %", "Volume", "Vol ×"].map((h) => (
                                  <th
                                    key={h}
                                    className="py-1.5 px-2 text-[10px] uppercase tracking-wider text-right"
                                    style={{ color: "var(--text-faint)" }}
                                  >
                                    {h}
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {s.stocks.length === 0 ? (
                                <tr>
                                  <td colSpan={6} className="py-2 pl-8 text-xs" style={{ color: "var(--text-faint)" }}>
                                    None of this sector&apos;s stocks traded today.
                                  </td>
                                </tr>
                              ) : (
                                s.stocks.map((st) => <StockRow key={st.symbol} s={st} />)
                              )}
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    </>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      <div>
        <div className="flex items-baseline justify-between gap-3 mb-2 flex-wrap">
          <h3 className="font-display text-sm font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
            In no sector yet
          </h3>
          <span className="text-xs" style={{ color: "var(--text-faint)" }}>
            {data.unclassifiedTotal.toLocaleString("en-IN")} stocks · showing the {data.unclassifiedShown} most traded
          </span>
        </div>
        {unclassifiedMatches.length === 0 ? (
          <EmptyState>{q ? `No unclassified stock matching “${q}”.` : "Everything trading today is classified."}</EmptyState>
        ) : (
          <Panel flush>
            <div className="table-scroll" style={{ maxHeight: "26rem" }}>
              <table className="w-full border-collapse table-sticky">
                <thead>
                  <tr className="text-left border-b" style={{ borderColor: "var(--border)" }}>
                    <th className="py-2 pl-4 pr-2 text-xs font-medium uppercase tracking-wider" style={{ color: "var(--text-faint)" }}>
                      Symbol
                    </th>
                    {["Close", "Chg %", "Deliv. %", "Volume", "Vol ×"].map((h) => (
                      <th key={h} className="py-2 px-2 text-xs font-medium uppercase tracking-wider text-right" style={{ color: "var(--text-faint)" }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {unclassifiedMatches.map((s) => (
                    <StockRow key={s.symbol} s={{ ...s, isAdded: false }} />
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        )}
        <p className="text-[11px] mt-2 leading-relaxed" style={{ color: "var(--text-faint)" }}>
          The sector lists are hand-maintained, so most of these simply haven&apos;t been classified —
          it isn&apos;t a judgement about them. Ordered by turnover, since those are the ones worth
          classifying first. To assign one, expand its sector above and search for it there; the change
          applies everywhere the app resolves sectors.
        </p>
      </div>
    </div>
  );
}
