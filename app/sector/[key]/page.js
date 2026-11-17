"use client";

import { use, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useSortableRows } from "@/lib/useSortableRows";
import SortableTh from "@/components/SortableTh";
import SymbolLink from "@/components/SymbolLink";
import { Panel, SectionTitle, ErrorState, LoadingState } from "@/components/ui/Chrome";
import { fmt, fmtTurnover } from "@/lib/format";
import TableFrame from "@/components/ui/TableFrame";

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

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/sector-detail?key=${encodeURIComponent(sectorKey)}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Couldn't load this page");
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
  }, [load]);

  const { sorted, sort, onSort } = useSortableRows(data?.stocks, "vsSectorPct", "desc");

  const groupWord = data?.kind === "theme" ? "theme" : "sector";

  return (
    <div className="min-h-screen px-4 md:px-8 py-6">
      <div className="flex items-center gap-3 mb-5 flex-wrap">
        <BackButton />
        <div>
          <h1 className="font-display text-2xl font-semibold" style={{ color: "var(--text)" }}>
            {data?.name ?? sectorKey.replace(/^theme:/, "")}
            {data?.kind === "theme" && (
              <span className="ml-2 align-middle text-[11px] px-1.5 py-0.5 rounded border" style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}>
                theme
              </span>
            )}
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
      {!data && !error && <LoadingState>Building the picture from exchange data…</LoadingState>}

      {data && (
        <div className="flex flex-col gap-6">
          <div>
            <SectionTitle meta={`Equal-weighted across ${data.reportingCount} stocks`}>
              {data.kind === "theme" ? "Theme" : "Sector"} accumulation
            </SectionTitle>
            <Panel>
              <div className="grid grid-cols-2 md:grid-cols-6 gap-5">
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
                <Stat label="Turnover today" value={fmtTurnover(data.sector.turnoverCr)} sub="all constituents" />
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
                The move is equal-weighted so one heavyweight can&apos;t carry the {groupWord}, while delivery and
                volume are volume-weighted because those genuinely add up across a basket.{" "}
                {data.sector.outperformers} of {data.reportingCount} stocks beat the {groupWord} average.
                {data.benchmark?.label === "NIFTY 50" && (
                  <> The NIFTY 500 didn&apos;t resolve, so the comparison uses the NIFTY 50 instead.</>
                )}
              </p>
            </Panel>
          </div>

          <div>
            <SectionTitle meta={`Sorted by outperformance vs the ${data.kind === "theme" ? "theme" : "sector"}`}>
              Stocks — accumulation &amp; relative strength
            </SectionTitle>
            <Panel flush>
              <TableFrame name="sector">
                <table className="w-full border-collapse table-sticky">
                  <thead>
                    <tr className="text-left border-b" style={{ borderColor: "var(--border)" }}>
                      <SortableTh label="Symbol" sortKey="symbol" sort={sort} onSort={onSort} align="left" className="pl-4" />
                      <SortableTh label="Close" sortKey="close" sort={sort} onSort={onSort} />
                      <SortableTh label={`${data.windowDays}d move`} sortKey="returnPct" sort={sort} onSort={onSort} />
                      <SortableTh
                        label={data.kind === "theme" ? "vs Theme" : "vs Sector"}
                        sortKey="vsSectorPct"
                        sort={sort}
                        onSort={onSort}
                        title={`This stock's window return minus the ${groupWord}'s average return`}
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
                        title={`Volume-weighted delivery across the window — the same basis as the ${groupWord} figure above`}
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
                      <SortableTh
                        label="Turnover"
                        sortKey="turnoverCr"
                        sort={sort}
                        onSort={onSort}
                        className="pr-4"
                        title={`Today's traded value (close × volume). Below it: the daily average over the ${data.windowDays}-day window.`}
                      />
                    </tr>
                  </thead>
                  <tbody>
                    {sorted.map((s) => (
                      <tr key={s.symbol} className="border-b last:border-b-0" style={{ borderColor: "var(--border)" }}>
                        <td className="py-2.5 pl-4 pr-2">
                          <div className="flex items-center gap-1.5">
                            <SymbolLink symbol={s.symbol} className="text-sm" />
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
                        <td className="py-2.5 pl-2 pr-4 text-right font-mono text-xs" style={{ color: "var(--text)" }}>
                          {fmtTurnover(s.turnoverCr)}
                          {s.avgTurnoverCr != null && (
                            <div className="text-[10px]" style={{ color: "var(--text-faint)" }}>
                              avg {fmtTurnover(s.avgTurnoverCr)}
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableFrame>
            </Panel>
          </div>

        </div>
      )}
    </div>
  );
}
