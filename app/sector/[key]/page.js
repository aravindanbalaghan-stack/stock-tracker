"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSortableRows } from "@/lib/useSortableRows";
import SortableTh from "@/components/SortableTh";
import SymbolLink from "@/components/SymbolLink";
import { Panel, SectionTitle, ErrorState, LoadingState } from "@/components/ui/Chrome";
import SectorSyncPanel from "@/components/SectorSyncPanel";

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
function Signed({ value, digits = 2 }) {
  if (value == null) return <span style={{ color: "var(--text-faint)" }}>—</span>;
  return (
    <span style={{ color: value >= 0 ? "var(--gain)" : "var(--loss)" }}>
      {value >= 0 ? "+" : ""}
      {fmt(value, digits)}%
    </span>
  );
}
function Stat({ label, value, sub }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-wider" style={{ color: "var(--text-faint)" }}>
        {label}
      </span>
      <span className="font-mono text-lg" style={{ color: "var(--text)" }}>
        {value}
      </span>
      {sub && (
        <span className="text-[10px]" style={{ color: "var(--text-faint)" }}>
          {sub}
        </span>
      )}
    </div>
  );
}

function AddStockForm({ sectorKey, onAdded }) {
  const [symbol, setSymbol] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  async function submit(e) {
    e.preventDefault();
    const clean = symbol.trim().toUpperCase();
    if (!clean) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/sector-overrides", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sector: sectorKey, symbol: clean }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Couldn't add that stock");
      if (json.added) {
        setSymbol("");
        setMsg({ tone: "good", text: `${clean} added — it will appear in this sector everywhere in the app.` });
        onAdded?.();
      } else {
        setMsg({ tone: "neutral", text: json.message });
      }
    } catch (err) {
      setMsg({ tone: "bad", text: err.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <form onSubmit={submit} className="flex items-center gap-2 flex-wrap">
        <input
          value={symbol}
          onChange={(e) => setSymbol(e.target.value.toUpperCase())}
          placeholder="Add a symbol, e.g. TATACHEM"
          className="rounded-[var(--radius-sm)] px-2.5 py-1.5 text-sm font-mono border w-56"
          style={{ background: "var(--surface-2)", borderColor: "var(--border)", color: "var(--text)" }}
        />
        <button
          type="submit"
          disabled={busy || !symbol.trim()}
          className="rounded-[var(--radius-sm)] px-3 py-1.5 text-sm font-medium disabled:opacity-40"
          style={{ background: "var(--accent)", color: "var(--surface)" }}
        >
          {busy ? "Adding…" : "Add to sector"}
        </button>
      </form>
      {msg && (
        <p
          className="text-xs mt-2"
          style={{
            color: msg.tone === "bad" ? "var(--loss)" : msg.tone === "good" ? "var(--gain)" : "var(--text-muted)",
          }}
        >
          {msg.text}
        </p>
      )}
    </div>
  );
}

function BackButton() {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => {
        // Return to wherever you came from, tab and scroll intact. Only
        // falls back to the dashboard when there's no history to go back
        // to — e.g. the page was opened directly from a link.
        if (typeof window !== "undefined" && window.history.length > 1) router.back();
        else router.push("/");
      }}
      className="text-xs px-2 py-1 rounded border"
      style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}
    >
      ← Back
    </button>
  );
}

export default function SectorPage({ params }) {
  const { key } = use(params);
  const sectorKey = decodeURIComponent(key);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [reloadTick, setReloadTick] = useState(0);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/sector-detail?key=${encodeURIComponent(sectorKey)}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Couldn't load this sector");
      setData(json);
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  }, [sectorKey]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!cancelled) await load();
    })();
    return () => {
      cancelled = true;
    };
  }, [load, reloadTick]);

  const { sorted, sort, onSort } = useSortableRows(data?.stocks, "vsSectorPct", "desc");

  async function removeAdded(symbol) {
    await fetch(
      `/api/sector-overrides?sector=${encodeURIComponent(sectorKey)}&symbol=${encodeURIComponent(symbol)}`,
      { method: "DELETE" }
    );
    setReloadTick((t) => t + 1);
  }

  return (
    <div className="min-h-screen px-4 md:px-8 py-6">
      <div className="flex items-center gap-3 mb-5 flex-wrap">
        <BackButton />
        <div>
          <h1 className="font-display text-2xl font-semibold" style={{ color: "var(--text)" }}>
            {data?.name ?? sectorKey}
          </h1>
          {data && (
            <p className="text-xs" style={{ color: "var(--text-faint)" }}>
              {data.reportingCount} of {data.constituentCount} stocks traded · {data.windowDays}-day window ·
              as of {data.asOf}
            </p>
          )}
        </div>
      </div>

      {error && <ErrorState>{error}</ErrorState>}
      {!data && !error && <LoadingState>Building the sector picture from exchange data…</LoadingState>}

      {data && (
        <div className="flex flex-col gap-6">
          <div>
            <SectionTitle meta={`Equal-weighted across ${data.reportingCount} stocks`}>
              Sector accumulation
            </SectionTitle>
            <Panel>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-5">
                <Stat
                  label={`${data.windowDays}-day move`}
                  value={<Signed value={data.sector.returnPct} />}
                  sub="average across constituents"
                />
                <Stat
                  label="Delivery %"
                  value={data.sector.deliveryPct == null ? "—" : `${fmt(data.sector.deliveryPct)}%`}
                  sub="volume-weighted over the window"
                />
                <Stat label="Volume today" value={vol(data.sector.volume)} />
                <Stat
                  label="vs 30d avg volume"
                  value={data.sector.volumeRatio == null ? "—" : `${fmt(data.sector.volumeRatio)}×`}
                  sub={`avg ${vol(data.sector.avgVolume)}`}
                />
                <Stat
                  label={data.benchmark ? `vs ${data.benchmark.label}` : "vs benchmark"}
                  value={data.benchmark ? <Signed value={data.benchmark.vsSectorPct} /> : "—"}
                  sub={
                    data.benchmark
                      ? `index ${data.benchmark.returnPct >= 0 ? "+" : ""}${fmt(data.benchmark.returnPct)}%`
                      : "index history unavailable"
                  }
                />
              </div>
              <p className="text-[11px] mt-3" style={{ color: "var(--text-faint)" }}>
                The move is equal-weighted so one heavyweight can&apos;t carry the sector, while delivery and
                volume are volume-weighted because those genuinely add up across a basket.{" "}
                {data.sector.outperformers} of {data.reportingCount} stocks beat the sector average.
                {data.benchmark?.label === "NIFTY 50" && (
                  <> The NIFTY 500 didn&apos;t resolve, so the comparison uses the NIFTY 50 instead.</>
                )}
              </p>
            </Panel>
          </div>

          <div>
            <SectionTitle meta="Sorted by outperformance vs the sector">
              Stocks — accumulation &amp; relative strength
            </SectionTitle>
            <Panel flush>
              <div className="table-scroll">
                <table className="w-full border-collapse table-sticky">
                  <thead>
                    <tr className="text-left border-b" style={{ borderColor: "var(--border)" }}>
                      <SortableTh label="Symbol" sortKey="symbol" sort={sort} onSort={onSort} align="left" className="pl-4" />
                      <SortableTh label="Close" sortKey="close" sort={sort} onSort={onSort} />
                      <SortableTh label={`${data.windowDays}d move`} sortKey="returnPct" sort={sort} onSort={onSort} />
                      <SortableTh
                        label="vs Sector"
                        sortKey="vsSectorPct"
                        sort={sort}
                        onSort={onSort}
                        title="This stock's window return minus the sector's average return"
                      />
                      <SortableTh
                        label={data.benchmark ? `vs ${data.benchmark.label}` : "vs Index"}
                        sortKey="vsBenchmarkPct"
                        sort={sort}
                        onSort={onSort}
                      />
                      <SortableTh label="Deliv. % today" sortKey="deliveryPct" sort={sort} onSort={onSort} />
                      <SortableTh
                        label="Deliv. % window"
                        sortKey="weightedDeliveryPct"
                        sort={sort}
                        onSort={onSort}
                        title="Volume-weighted delivery across the window — the same basis as the sector figure above"
                      />
                      <SortableTh
                        label={`Days >${data.accumulationThreshold}%`}
                        sortKey="daysAboveThreshold"
                        sort={sort}
                        onSort={onSort}
                        title="Sessions in the window where delivery cleared the accumulation threshold"
                      />
                      <SortableTh label="Volume" sortKey="volume" sort={sort} onSort={onSort} />
                      <SortableTh label="Vol ×" sortKey="volumeRatio" sort={sort} onSort={onSort} />
                      <th className="py-2 pl-2 pr-4"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {sorted.map((s) => (
                      <tr key={s.symbol} className="border-b last:border-b-0" style={{ borderColor: "var(--border)" }}>
                        <td className="py-2.5 pl-4 pr-2">
                          <div className="flex items-center gap-1.5">
                            <SymbolLink symbol={s.symbol} className="text-sm" />
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
                        <td className="py-2.5 px-2 text-right font-mono text-sm" style={{ color: "var(--text)" }}>
                          ₹{fmt(s.close)}
                        </td>
                        <td className="py-2.5 px-2 text-right font-mono text-xs">
                          <Signed value={s.returnPct} />
                        </td>
                        <td className="py-2.5 px-2 text-right font-mono text-xs">
                          <Signed value={s.vsSectorPct} />
                        </td>
                        <td className="py-2.5 px-2 text-right font-mono text-xs">
                          <Signed value={s.vsBenchmarkPct} />
                        </td>
                        <td className="py-2.5 px-2 text-right font-mono text-xs" style={{ color: "var(--gain)" }}>
                          {s.deliveryPct == null ? "—" : `${fmt(s.deliveryPct)}%`}
                        </td>
                        <td className="py-2.5 px-2 text-right font-mono text-xs" style={{ color: "var(--text-muted)" }}>
                          {s.weightedDeliveryPct == null ? "—" : `${fmt(s.weightedDeliveryPct)}%`}
                        </td>
                        <td className="py-2.5 px-2 text-right font-mono text-xs" style={{ color: "var(--text-muted)" }}>
                          {s.daysAboveThreshold}/{s.daysCounted}
                        </td>
                        <td className="py-2.5 px-2 text-right font-mono text-xs" style={{ color: "var(--text-muted)" }}>
                          {vol(s.volume)}
                        </td>
                        <td className="py-2.5 px-2 text-right font-mono text-xs" style={{ color: "var(--accent)" }}>
                          {s.volumeRatio == null ? "—" : `${fmt(s.volumeRatio)}×`}
                        </td>
                        <td className="py-2.5 pl-2 pr-4 text-right">
                          {s.isAdded && (
                            <button
                              type="button"
                              onClick={() => removeAdded(s.symbol)}
                              className="text-[10px] px-1.5 py-0.5 rounded border"
                              style={{ borderColor: "var(--border)", color: "var(--text-faint)" }}
                              title="Remove this manual addition"
                            >
                              Remove
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          </div>

          <div>
            <SectionTitle meta="Compare against Zerodha's sector lists">Check for missing stocks</SectionTitle>
            <SectorSyncPanel sectorKey={sectorKey} onApplied={() => setReloadTick((t) => t + 1)} />
          </div>

          <div>
            <SectionTitle meta="Applies everywhere in the app">Add one manually</SectionTitle>
            <Panel>
              <AddStockForm sectorKey={sectorKey} onAdded={() => setReloadTick((t) => t + 1)} />
              <p className="text-[11px] mt-3" style={{ color: "var(--text-faint)" }}>
                Sector lists here are hand-maintained rather than NSE&apos;s official classification, so
                genuine members can be missing. Anything you add is stored server-side and used by every
                sector screen from then on. It won&apos;t alter the built-in list — additions are kept
                separately and can be removed again from the table above.
              </p>
            </Panel>
          </div>
        </div>
      )}
    </div>
  );
}
