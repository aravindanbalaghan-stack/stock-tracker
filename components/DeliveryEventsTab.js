"use client";

import { useEffect, useState } from "react";
import { useSortableRows } from "@/lib/useSortableRows";
import SortableTh from "@/components/SortableTh";
import SymbolLink from "@/components/SymbolLink";
import WatchlistAddButton from "@/components/WatchlistAddButton";
import DatePicker from "@/components/DatePicker";
import InfoNote from "@/components/InfoNote";
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
function Signed({ value, digits = 2 }) {
  if (value == null) return <span style={{ color: "var(--text-faint)" }}>—</span>;
  // Sign decides the colour. Max down is always negative, so an "inverted"
  // scale rendered every drawdown green — which read as a gain at a glance.
  return (
    <span style={{ color: value >= 0 ? "var(--gain)" : "var(--loss)" }}>
      {value >= 0 ? "+" : ""}
      {fmt(value, digits)}%
    </span>
  );
}

function SummaryStrip({ summary, criteria }) {
  if (!summary) return null;
  const items = [
    { label: "Events", value: summary.count },
    {
      label: "Higher since",
      value: `${fmt(summary.positiveRatePct, 1)}%`,
      sub: `${summary.positiveCount} of ${summary.count}`,
    },
    { label: "Median move since", value: <Signed value={summary.medianChangePct} /> },
    { label: "Avg max up", value: <Signed value={summary.avgMaxUpPct} /> },
    { label: "Avg max down", value: <Signed value={summary.avgMaxDownPct} /> },
    { label: "Avg volatility", value: `${fmt(summary.avgVolatilityPct, 1)}%`, sub: "annualised" },
  ];
  return (
    <Panel className="mb-3">
      <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
        {items.map((it) => (
          <div key={it.label} className="flex flex-col gap-0.5">
            <span className="text-[10px] uppercase tracking-wider" style={{ color: "var(--text-faint)" }}>
              {it.label}
            </span>
            <span className="font-mono text-base" style={{ color: "var(--text)" }}>
              {it.value}
            </span>
            {it.sub && (
              <span className="text-[10px]" style={{ color: "var(--text-faint)" }}>
                {it.sub}
              </span>
            )}
          </div>
        ))}
      </div>
      <p className="text-[11px] mt-3" style={{ color: "var(--text-faint)" }}>
        Across every event in the window — this is how the setup behaved, not a forecast. Events from a
        few days ago have had far less time to move than ones from a month ago, so the averages mix
        holding periods; the Days column shows each row&apos;s own.
      </p>
    </Panel>
  );
}

export default function DeliveryEventsTab({ onAddToWatchlist, watchlistSymbols }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [volMultiple, setVolMultiple] = useState(2);
  const [deliveryMin, setDeliveryMin] = useState(70);
  const [lookback, setLookback] = useState(30);
  const [asOfDate, setAsOfDate] = useState("");
  const [applied, setApplied] = useState({ volMultiple: 2, deliveryMin: 70, lookback: 30 });

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    (async () => {
      try {
        const qs = new URLSearchParams({
          volMultiple: String(applied.volMultiple),
          deliveryMin: String(applied.deliveryMin),
          lookback: String(applied.lookback),
        });
        if (asOfDate) qs.set("date", asOfDate);
        const res = await fetch(`/api/delivery-events?${qs.toString()}`);
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error || "Couldn't scan delivery events");
        if (!cancelled) setData(json);
      } catch (err) {
        if (!cancelled) setError(err.message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [applied, asOfDate]);

  const { sorted, sort, onSort } = useSortableRows(data?.rows, "eventDate", "desc");

  const controls = (
    <div className="flex items-end gap-3 flex-wrap">
      <label className="flex flex-col text-xs" style={{ color: "var(--text-faint)" }}>
        Volume ≥
        <div className="flex items-center gap-1 mt-1">
          <input
            type="number"
            step="0.5"
            min="1"
            value={volMultiple}
            onChange={(e) => setVolMultiple(e.target.value)}
            className="w-16 rounded-[var(--radius-sm)] px-2 py-1 text-sm border"
            style={{ background: "var(--surface-2)", borderColor: "var(--border)", color: "var(--text)" }}
          />
          <span>×</span>
        </div>
      </label>
      <label className="flex flex-col text-xs" style={{ color: "var(--text-faint)" }}>
        Delivery ≥
        <div className="flex items-center gap-1 mt-1">
          <input
            type="number"
            step="5"
            min="0"
            max="100"
            value={deliveryMin}
            onChange={(e) => setDeliveryMin(e.target.value)}
            className="w-16 rounded-[var(--radius-sm)] px-2 py-1 text-sm border"
            style={{ background: "var(--surface-2)", borderColor: "var(--border)", color: "var(--text)" }}
          />
          <span>%</span>
        </div>
      </label>
      <label className="flex flex-col text-xs" style={{ color: "var(--text-faint)" }}>
        Look back
        <div className="flex items-center gap-1 mt-1">
          <input
            type="number"
            step="5"
            min="5"
            max="60"
            value={lookback}
            onChange={(e) => setLookback(e.target.value)}
            className="w-16 rounded-[var(--radius-sm)] px-2 py-1 text-sm border"
            style={{ background: "var(--surface-2)", borderColor: "var(--border)", color: "var(--text)" }}
          />
          <span>days</span>
        </div>
      </label>
      <button
        type="button"
        onClick={() =>
          setApplied({
            volMultiple: Number(volMultiple) || 2,
            deliveryMin: Number(deliveryMin) || 70,
            lookback: Number(lookback) || 30,
          })
        }
        className="rounded-[var(--radius-sm)] px-3 py-1.5 text-sm font-medium"
        style={{ background: "var(--accent)", color: "var(--surface)" }}
      >
        Apply
      </button>
      <DatePicker value={asOfDate} onChange={setAsOfDate} />
    </div>
  );

  if (error) {
    return (
      <div>
        <ScreenHeader title="Delivery events" actions={controls} />
        <ErrorState>{error}</ErrorState>
      </div>
    );
  }

  if (!data) {
    return (
      <div>
        <ScreenHeader title="Delivery events" actions={controls} />
        <LoadingState>
          Scanning every NSE stock for high-volume, high-delivery days and measuring what happened next —
          this pulls a couple of months of exchange data, so the first run takes a moment.
        </LoadingState>
      </div>
    );
  }

  const c = data.criteria;

  return (
    <div>
      <ScreenHeader
        title="Delivery events"
        meta={`${data.eventCount} event${data.eventCount === 1 ? "" : "s"} in the last ${c.lookback} trading days · as of ${data.asOf}${
          data.dateAdjusted ? ` (${data.requestedDate} wasn't a trading day)` : ""
        }`}
        actions={controls}
      />

      <div className="mb-3">
        <InfoNote label="What this shows">
          Every day a stock traded at least {c.volMultiple}× its own trailing {c.avgWindow}-day average
          volume AND closed with delivery above {c.deliveryMin}% — high conviction volume rather than
          intraday churn. For each of those days it then measures what price actually did afterwards: how
          far it ran, how far it fell, where it stands now, and how volatile it was. Max up and max down
          use intraday highs and lows, so a spike that reversed the same day still registers. Volatility
          is the annualised standard deviation of daily returns since the event, which is noisy on rows
          with only a few days behind them. This is a description of what happened, not a prediction —
          and every event here already includes days that went nowhere, so read the summary strip before
          any individual row.
          {data.truncated && (
            <strong style={{ color: "var(--text-muted)" }}>
              {" "}
              More than {data.maxRows} events matched; the most recent are shown.
            </strong>
          )}
        </InfoNote>
      </div>

      <SummaryStrip summary={data.summary} criteria={c} />

      {data.rows.length === 0 ? (
        <EmptyState>
          No days matched {c.volMultiple}× volume with delivery above {c.deliveryMin}% in this window. Try
          loosening the thresholds or widening the lookback.
        </EmptyState>
      ) : (
        <div
          className="rounded-[var(--radius)] border overflow-hidden"
          style={{ borderColor: "var(--border)", background: "var(--surface)" }}
        >
          <div className="table-scroll">
            <table className="w-full border-collapse table-sticky">
              <thead>
                <tr className="text-left border-b" style={{ borderColor: "var(--border)" }}>
                  <SortableTh label="Symbol" sortKey="symbol" sort={sort} onSort={onSort} align="left" className="pl-4" />
                  <SortableTh label="Event date" sortKey="eventDate" sort={sort} onSort={onSort} align="left" />
                  <SortableTh label="Days" sortKey="daysSince" sort={sort} onSort={onSort} title="Trading sessions since the event" />
                  <SortableTh label="Price then" sortKey="eventPrice" sort={sort} onSort={onSort} title="Close on the event day" />
                  <SortableTh label="Deliv. %" sortKey="eventDeliveryPct" sort={sort} onSort={onSort} title="Delivery % on the event day" />
                  <SortableTh label="Vol ×" sortKey="eventVolumeRatio" sort={sort} onSort={onSort} title="Event-day volume against its own trailing 30-day average" />
                  <SortableTh label="Price now" sortKey="currentPrice" sort={sort} onSort={onSort} />
                  <SortableTh label="Since" sortKey="changeSincePct" sort={sort} onSort={onSort} title="Move from the event close to the latest close" />
                  <SortableTh label="Max up" sortKey="maxUpPct" sort={sort} onSort={onSort} title="Highest intraday price reached after the event, vs the event close" />
                  <SortableTh label="Max down" sortKey="maxDownPct" sort={sort} onSort={onSort} title="Lowest intraday price reached after the event, vs the event close" />
                  <SortableTh label="Volatility" sortKey="volatilityPct" sort={sort} onSort={onSort} title="Annualised standard deviation of daily returns since the event" />
                  <th className="py-2 pl-2 pr-4"></th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((r) => (
                  <tr key={`${r.symbol}-${r.eventDate}`} className="border-b last:border-b-0" style={{ borderColor: "var(--border)" }}>
                    <td className="py-2.5 pl-4 pr-2">
                      <SymbolLink symbol={r.symbol} className="text-sm" />
                    </td>
                    <td className="py-2.5 px-2 font-mono text-xs" style={{ color: "var(--text-muted)" }}>
                      {r.eventDate}
                    </td>
                    <td className="py-2.5 px-2 text-right font-mono text-xs" style={{ color: "var(--text-faint)" }}>
                      {r.daysSince}
                    </td>
                    <td className="py-2.5 px-2 text-right font-mono text-xs" style={{ color: "var(--text-muted)" }}>
                      ₹{fmt(r.eventPrice)}
                    </td>
                    <td className="py-2.5 px-2 text-right font-mono text-xs" style={{ color: "var(--gain)" }}>
                      {fmt(r.eventDeliveryPct)}%
                    </td>
                    <td className="py-2.5 px-2 text-right font-mono text-xs" style={{ color: "var(--accent)" }}>
                      {r.eventVolumeRatio}×
                    </td>
                    <td className="py-2.5 px-2 text-right font-mono text-sm" style={{ color: "var(--text)" }}>
                      ₹{fmt(r.currentPrice)}
                    </td>
                    <td className="py-2.5 px-2 text-right font-mono text-xs">
                      <Signed value={r.changeSincePct} />
                    </td>
                    <td className="py-2.5 px-2 text-right font-mono text-xs">
                      <Signed value={r.maxUpPct} />
                    </td>
                    <td className="py-2.5 px-2 text-right font-mono text-xs">
                      <Signed value={r.maxDownPct} />
                    </td>
                    <td className="py-2.5 px-2 text-right font-mono text-xs" style={{ color: "var(--text-muted)" }}>
                      {r.volatilityPct == null ? "—" : `${fmt(r.volatilityPct, 1)}%`}
                    </td>
                    <td className="py-2.5 pl-2 pr-4 text-right">
                      <WatchlistAddButton
                        symbol={r.symbol}
                        inWatchlist={watchlistSymbols?.includes(r.symbol)}
                        onAdd={onAddToWatchlist}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
