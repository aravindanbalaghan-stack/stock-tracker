"use client";

// Delivery → Top 20 · Weekly / Monthly: highest delivery % over the period
// among stocks whose volume AND turnover also expanded. Logic:
// app/api/delivery-top/route.js.

import { useEffect, useState } from "react";
import SymbolLink from "@/components/SymbolLink";
import WatchlistAddButton from "@/components/WatchlistAddButton";
import SortableTh from "@/components/SortableTh";
import InfoNote from "@/components/InfoNote";
import { ErrorState, LoadingState, EmptyState } from "@/components/ui/Chrome";
import { useSortableRows } from "@/lib/useSortableRows";
import { usePersistentState } from "@/lib/usePersistentState";
import { formatDayLabel } from "@/lib/periodLabel";

const fmt = (n, d = 2) => (n == null || Number.isNaN(n) ? "—" : n.toLocaleString("en-IN", { maximumFractionDigits: d, minimumFractionDigits: d }));
const cr = (n) => (n == null ? "—" : n >= 1000 ? `₹${Math.round(n).toLocaleString("en-IN")} Cr` : n >= 10 ? `₹${n.toFixed(1)} Cr` : `₹${n.toFixed(2)} Cr`);
const tone = (v) => (v == null ? "var(--text-faint)" : v >= 0 ? "var(--gain)" : "var(--loss)");

function Spark({ history }) {
  const vals = (history ?? []).map((h) => h.deliveryPct).filter((v) => v != null);
  if (vals.length < 2) return null;
  const W = 70;
  const H = 18;
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min || 1;
  const pts = vals.map((v, i) => `${((i / (vals.length - 1)) * W).toFixed(1)},${(H - ((v - min) / span) * (H - 2) - 1).toFixed(1)}`).join(" ");
  const up = vals[vals.length - 1] >= vals[0];
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-label="Delivery % trend">
      <polyline points={pts} fill="none" stroke={up ? "var(--gain)" : "var(--loss)"} strokeWidth="1.5" />
    </svg>
  );
}

export default function DeliveryTopTab({ period, asOfDate, onAddToWatchlist, watchlistSymbols }) {
  const [minVolRatio, setMinVolRatio] = usePersistentState(`deliveryTop.${period}.vol`, 1.5);
  const [minTurnoverCr, setMinTurnoverCr] = usePersistentState(`deliveryTop.${period}.turnover`, 10);
  const key = `${period}|${asOfDate}|${minVolRatio}|${minTurnoverCr}`;
  const [loaded, setLoaded] = useState({ key: null, data: null, error: null });
  const data = loaded.key === key ? loaded.data : null;
  const error = loaded.key === key ? loaded.error : null;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const qs = new URLSearchParams({ period, minVolRatio: String(minVolRatio), minTurnoverCr: String(minTurnoverCr) });
        if (asOfDate) qs.set("date", asOfDate);
        const res = await fetch(`/api/delivery-top?${qs}`);
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error || "Couldn't load");
        if (!cancelled) setLoaded({ key, data: json, error: null });
      } catch (err) {
        if (!cancelled) setLoaded({ key, data: null, error: err.message });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [key, period, asOfDate, minVolRatio, minTurnoverCr]);

  const { sorted, sort, onSort } = useSortableRows(data?.rows, "rank", "asc");
  const label = period === "weekly" ? "week" : "month";
  const sel = { background: "var(--surface-2)", borderColor: "var(--border)", color: "var(--text)" };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 mb-3 text-xs" style={{ color: "var(--text-muted)" }}>
        <label className="flex items-center gap-1.5">
          Volume ≥
          <select value={minVolRatio} onChange={(e) => setMinVolRatio(Number(e.target.value))} className="rounded px-2 py-1 border" style={sel}>
            {[1, 1.2, 1.5, 2, 3].map((v) => (
              <option key={v} value={v}>
                {v}× normal
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1.5">
          Avg daily turnover ≥
          <select value={minTurnoverCr} onChange={(e) => setMinTurnoverCr(Number(e.target.value))} className="rounded px-2 py-1 border" style={sel}>
            {[2, 5, 10, 25, 50, 100].map((v) => (
              <option key={v} value={v}>
                ₹{v} Cr
              </option>
            ))}
          </select>
        </label>
        {data && (
          <span style={{ color: "var(--text-faint)" }}>
            {formatDayLabel(data.windowFirstDate)} – {formatDayLabel(data.asOf)} · {data.qualifying} of {data.considered} stocks met the volume & turnover bar
          </span>
        )}
      </div>

      {error ? (
        <ErrorState>{error}</ErrorState>
      ) : !data ? (
        <LoadingState>Ranking the {label}&apos;s delivery…{period === "monthly" ? " The first monthly load reads a few months of NSE files." : ""}</LoadingState>
      ) : !data.rows.length ? (
        <EmptyState>No stock met both bars this {label} — try a lower volume or turnover threshold.</EmptyState>
      ) : (
        <div className="rounded-[var(--radius)] border overflow-hidden" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
          <div className="table-scroll">
            <table className="w-full border-collapse table-sticky">
              <thead>
                <tr className="text-left border-b" style={{ borderColor: "var(--border)" }}>
                  <SortableTh label="#" sortKey="rank" sort={sort} onSort={onSort} align="left" className="pl-4" />
                  <SortableTh label="Symbol" sortKey="symbol" sort={sort} onSort={onSort} align="left" />
                  <SortableTh label={`Deliv. % (${label})`} sortKey="deliveryPct" sort={sort} onSort={onSort} title="Shares delivered ÷ shares traded over the whole period" />
                  <SortableTh label={`vs last ${label}`} sortKey="deliveryChange" sort={sort} onSort={onSort} title="Change in delivery % from the previous period, in percentage points" />
                  <th className="py-2 px-2 text-xs font-medium" style={{ color: "var(--text-faint)" }}>
                    Trend
                  </th>
                  <SortableTh label="Volume vs normal" sortKey="volumeRatio" sort={sort} onSort={onSort} title={`Period volume ÷ the ${data.criteria.baselineDays}-session average before it, scaled to the period`} />
                  <SortableTh label="Turnover" sortKey="turnoverCr" sort={sort} onSort={onSort} title="Total traded value over the period (average per day underneath)" />
                  <SortableTh label="Delivered value" sortKey="deliveredValueCr" sort={sort} onSort={onSort} title="Turnover × delivery % — roughly the money that took delivery" />
                  <SortableTh label={`Chg (${label})`} sortKey="changePercent" sort={sort} onSort={onSort} />
                  <SortableTh label="Close" sortKey="close" sort={sort} onSort={onSort} />
                  <SortableTh label="Mkt cap" sortKey="marketCapCr" sort={sort} onSort={onSort} />
                  <th className="py-2 pl-2 pr-4"></th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((r) => (
                  <tr key={r.symbol} className="border-b last:border-b-0" style={{ borderColor: "var(--border)" }}>
                    <td className="py-2.5 pl-4 pr-2 font-mono text-xs" style={{ color: "var(--accent)" }}>
                      {r.rank}
                    </td>
                    <td className="py-2.5 px-2">
                      <SymbolLink symbol={r.symbol} className="text-sm" />
                      {r.inAccumulation && (
                        <span className="block text-[10px]" style={{ color: "var(--gain)" }} title={`${r.daysOfAccumulation} high-delivery days in the last 20`}>
                          accumulation
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 px-2 text-right font-mono text-sm" style={{ color: "var(--text)" }}>
                      {fmt(r.deliveryPct, 1)}%
                    </td>
                    <td className="py-2.5 px-2 text-right font-mono text-xs" style={{ color: tone(r.deliveryChange) }}>
                      {r.deliveryChange == null ? "—" : `${r.deliveryChange >= 0 ? "+" : ""}${fmt(r.deliveryChange, 1)} pts`}
                    </td>
                    <td className="py-2.5 px-2">
                      <Spark history={r.deliveryHistory} />
                    </td>
                    <td className="py-2.5 px-2 text-right font-mono text-xs" style={{ color: r.volumeRatio >= 2 ? "var(--accent)" : "var(--text)" }}>
                      {fmt(r.volumeRatio)}×
                    </td>
                    <td className="py-2.5 px-2 text-right font-mono text-xs" style={{ color: "var(--text-muted)" }}>
                      {cr(r.turnoverCr)}
                      <span className="block text-[10px]" style={{ color: "var(--text-faint)" }}>
                        {cr(r.avgTurnoverCr)}/day
                      </span>
                    </td>
                    <td className="py-2.5 px-2 text-right font-mono text-xs" style={{ color: "var(--text)" }}>
                      {cr(r.deliveredValueCr)}
                    </td>
                    <td className="py-2.5 px-2 text-right font-mono text-xs" style={{ color: tone(r.changePercent) }}>
                      {r.changePercent == null ? "—" : `${r.changePercent >= 0 ? "+" : ""}${fmt(r.changePercent)}%`}
                    </td>
                    <td className="py-2.5 px-2 text-right font-mono text-xs" style={{ color: "var(--text)" }}>
                      ₹{fmt(r.close)}
                    </td>
                    <td className="py-2.5 px-2 text-right font-mono text-xs" style={{ color: "var(--text-muted)" }}>
                      {r.marketCapCr == null ? "—" : `₹${r.marketCapCr.toLocaleString("en-IN")} Cr`}
                    </td>
                    <td className="py-2.5 pl-2 pr-4 text-right">
                      <WatchlistAddButton
                        symbol={r.symbol}
                        inWatchlist={watchlistSymbols?.includes(r.symbol)}
                        onAdd={onAddToWatchlist}
                        source={`Delivery · Top 20 ${period}`}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="mt-3">
        <InfoNote label="How this list is built">
          Every NSE equity stock (close ₹20+) is scored over the last {data?.criteria.periodTradingDays ?? (period === "weekly" ? 5 : 21)} sessions. It must
          have traded on at least 80% of them, with volume at least {minVolRatio}× its normal level (the {data?.criteria.baselineDays ?? 30} sessions
          before the period, scaled to the same length) and average daily turnover of at least ₹{minTurnoverCr} Cr. The 20 with the highest
          delivery % across the whole period are shown. Delivered value is turnover × delivery % — roughly how much money took delivery.
        </InfoNote>
      </div>
    </div>
  );
}
