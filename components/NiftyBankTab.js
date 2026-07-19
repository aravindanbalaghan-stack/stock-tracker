"use client";

import { useEffect, useState } from "react";
import { useSortableRows } from "@/lib/useSortableRows";
import SortableTh from "@/components/SortableTh";

function fmt(n, digits = 2) {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return n.toLocaleString("en-IN", { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

function fmtVolume(n) {
  if (n === null || n === undefined) return "—";
  if (n >= 1e7) return `${(n / 1e7).toFixed(2)}Cr`;
  if (n >= 1e5) return `${(n / 1e5).toFixed(2)}L`;
  return n.toLocaleString("en-IN");
}

function fmtTimeIST(epochSeconds) {
  if (epochSeconds == null) return "—";
  return new Date(epochSeconds * 1000).toLocaleTimeString("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function todayIST() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

function daysAgoIST(n) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

// ---------- Live status ----------

function StatusPill({ done, label }) {
  return (
    <span
      className="text-xs px-2 py-1 rounded-full border font-medium"
      style={{
        borderColor: done ? "var(--gain)" : "var(--border)",
        color: done ? "var(--gain)" : "var(--text-faint)",
        background: done ? "var(--gain-dim)" : "transparent",
      }}
    >
      {done ? "✓ " : "○ "}
      {label}
    </span>
  );
}

function LiveCard() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/niftybank/live");
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error || "Failed to load live status");
        if (!cancelled) {
          setData(json);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError(err.message);
      }
    }
    load();
    // Polled every 60s while this tab is open — near-real-time without
    // hammering Yahoo's unofficial, unrate-limited-on-paper endpoint.
    // This only updates while the tab is actually open in a browser; it
    // does not send a notification (SMS/push) when the pattern triggers.
    // The existing alerts system (Watchlist tab) only checks once a day
    // via a scheduled job, which isn't frequent enough for an intraday
    // setup like this one — wiring up minute-level background alerts
    // would need a more frequent scheduled job than what's currently set
    // up in vercel.json.
    const id = setInterval(load, 60 * 1000);
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
    return (
      <div className="py-10 text-center text-sm" style={{ color: "var(--text-muted)" }}>
        Pulling NIFTY BANK data…
      </div>
    );
  }

  const notEnoughCandles = data.candlesToday < 3;

  return (
    <div className="rounded-lg border p-4" style={{ borderColor: data.triggered ? "var(--gain)" : "var(--border)", background: "var(--surface)" }}>
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div>
          <span className="text-xs uppercase tracking-wider" style={{ color: "var(--text-faint)" }}>Live · {data.asOf}</span>
          <div className="font-mono text-2xl mt-1" style={{ color: "var(--text)" }}>
            {fmt(data.latestPrice)} <span className="text-xs align-top" style={{ color: "var(--text-faint)" }}>as of {fmtTimeIST(data.latestTime)}</span>
          </div>
        </div>
        <div className="flex gap-2">
          <StatusPill done={!!data.breakout5} label="5-min high broken" />
          <StatusPill done={!!data.breakout10} label="10-min high broken" />
        </div>
      </div>

      {data.hasVolumeData === false ? (
        <p className="text-xs mb-3 px-2 py-1.5 rounded" style={{ background: "var(--surface-2)", color: "var(--text-faint)" }}>
          Volume is normally aggregated from NIFTY BANK&apos;s 12 constituent stocks (the index itself
          reports none), but none of them returned usable data just now — the volume condition is being
          skipped for today rather than silently blocking every breakout.
        </p>
      ) : (
        <p className="text-xs mb-3" style={{ color: "var(--text-faint)" }}>
          Volume aggregated from {data.volumeConstituentsReporting}/{data.volumeConstituentsTotal} NIFTY BANK
          constituent stocks (the index itself has no real trade volume).
        </p>
      )}

      {notEnoughCandles ? (
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          Waiting on the opening candles — need at least the first two 5-minute candles to establish the
          opening range, plus a third to check for a breakout.
        </p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-3">
          <div className="flex flex-col">
            <span className="text-[10px] uppercase" style={{ color: "var(--text-faint)" }}>First 5-min High</span>
            <span className="font-mono text-sm" style={{ color: "var(--text)" }}>{fmt(data.first5High)}</span>
          </div>
          <div className="flex flex-col">
            <span className="text-[10px] uppercase" style={{ color: "var(--text-faint)" }}>First 10-min High</span>
            <span className="font-mono text-sm" style={{ color: "var(--text)" }}>{fmt(data.first10High)}</span>
          </div>
          <div className="flex flex-col">
            <span className="text-[10px] uppercase" style={{ color: "var(--text-faint)" }}>Day Volume</span>
            <span className="font-mono text-sm" style={{ color: "var(--text)" }}>{fmtVolume(data.dayVolume)}</span>
          </div>
          <div className="flex flex-col">
            <span className="text-[10px] uppercase" style={{ color: "var(--text-faint)" }}>Candles so far</span>
            <span className="font-mono text-sm" style={{ color: "var(--text)" }}>{data.candlesToday}</span>
          </div>
        </div>
      )}

      {data.breakout5 && (
        <p className="text-xs mb-1" style={{ color: "var(--gain)" }}>
          5-min high broken at {fmtTimeIST(data.breakout5.time)} — price {fmt(data.breakout5.price)}, volume {fmtVolume(data.breakout5.volume)}
        </p>
      )}
      {data.breakout10 && (
        <p className="text-xs mb-1" style={{ color: "var(--gain)" }}>
          10-min high broken at {fmtTimeIST(data.breakout10.time)} — price {fmt(data.breakout10.price)}, volume {fmtVolume(data.breakout10.volume)}
        </p>
      )}
      {data.triggered && (
        <p className="text-sm font-medium mt-2" style={{ color: "var(--gain)" }}>
          Setup triggered today.
        </p>
      )}

      <div className="flex gap-6 mt-3 pt-3 border-t" style={{ borderColor: "var(--border)" }}>
        <div className="flex flex-col">
          <span className="text-[10px] uppercase" style={{ color: "var(--text-faint)" }}>21 EMA (Daily)</span>
          <span className="font-mono text-sm" style={{ color: "var(--text)" }}>{data.ema21 == null ? "—" : fmt(data.ema21)}</span>
        </div>
        <div className="flex flex-col">
          <span className="text-[10px] uppercase" style={{ color: "var(--text-faint)" }}>30-week Avg Volume</span>
          <span className="font-mono text-sm" style={{ color: "var(--text)" }}>{fmtVolume(data.avgVolume30w)}</span>
        </div>
      </div>
    </div>
  );
}

// ---------- Backtest ----------

function BacktestTable({ rows }) {
  const { sorted, sort, onSort } = useSortableRows(rows, "date", "desc");

  if (!rows || rows.length === 0) {
    return (
      <div className="rounded-lg border py-10 text-center text-sm" style={{ borderColor: "var(--border)", background: "var(--surface)", color: "var(--text-muted)" }}>
        No days in this range had both the 5-min and 10-min breakout trigger.
      </div>
    );
  }

  return (
    <div className="rounded-lg border overflow-hidden overflow-x-auto" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
      <table className="w-full border-collapse">
        <thead>
          <tr className="text-left border-b" style={{ borderColor: "var(--border)" }}>
            <SortableTh label="Date" sortKey="date" sort={sort} onSort={onSort} align="left" className="pl-4" />
            <SortableTh label="First 5m High" sortKey="first5High" sort={sort} onSort={onSort} />
            <SortableTh label="First 10m High" sortKey="first10High" sort={sort} onSort={onSort} />
            <SortableTh label="5m Breakout" sortKey="breakout5Price" sort={sort} onSort={onSort} title="Time and price of the 5-min opening-range breakout" />
            <SortableTh label="10m Breakout" sortKey="breakout10Price" sort={sort} onSort={onSort} title="Time and price of the confirming 10-min opening-range breakout" />
            <SortableTh label="Day Volume" sortKey="dayVolume" sort={sort} onSort={onSort} />
            <SortableTh label="21 EMA" sortKey="ema21" sort={sort} onSort={onSort} title="Daily 21 EMA as of the prior trading day's close" />
            <SortableTh label="30wk Avg Vol" sortKey="avgVolume30w" sort={sort} onSort={onSort} />
            <SortableTh label="Close" sortKey="dayClose" sort={sort} onSort={onSort} />
            <SortableTh label="Chg vs Breakout" sortKey="closeVsBreakoutPct" sort={sort} onSort={onSort} title="Day's close vs. the 10-min breakout price" />
            <SortableTh label="Max Gain" sortKey="maxGainPct" sort={sort} onSort={onSort} title="Best price reached after the 10-min breakout, vs. the breakout price" />
            <SortableTh label="Max Drawdown" sortKey="maxDrawdownPct" sort={sort} onSort={onSort} title="Worst price reached after the 10-min breakout, vs. the breakout price" className="pr-4" />
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => {
            const closeUp = (r.closeVsBreakoutPct ?? 0) >= 0;
            return (
              <tr key={r.date} className="border-b last:border-b-0" style={{ borderColor: "var(--border)" }}>
                <td className="py-2 pl-4 pr-2 font-mono text-xs" style={{ color: "var(--text)" }}>{r.date}</td>
                <td className="py-2 px-2 text-right font-mono text-xs" style={{ color: "var(--text-muted)" }}>{fmt(r.first5High)}</td>
                <td className="py-2 px-2 text-right font-mono text-xs" style={{ color: "var(--text-muted)" }}>{fmt(r.first10High)}</td>
                <td className="py-2 px-2 text-right font-mono text-xs" style={{ color: "var(--text)" }}>
                  {fmt(r.breakout5Price)}
                  <span style={{ color: "var(--text-faint)" }}> · {fmtTimeIST(r.breakout5Time)}</span>
                </td>
                <td className="py-2 px-2 text-right font-mono text-xs" style={{ color: "var(--text)" }}>
                  {fmt(r.breakout10Price)}
                  <span style={{ color: "var(--text-faint)" }}> · {fmtTimeIST(r.breakout10Time)}</span>
                </td>
                <td className="py-2 px-2 text-right font-mono text-xs" style={{ color: "var(--text-muted)" }}>{fmtVolume(r.dayVolume)}</td>
                <td className="py-2 px-2 text-right font-mono text-xs" style={{ color: "var(--text-muted)" }}>{r.ema21 == null ? "—" : fmt(r.ema21)}</td>
                <td className="py-2 px-2 text-right font-mono text-xs" style={{ color: "var(--text-muted)" }}>{fmtVolume(r.avgVolume30w)}</td>
                <td className="py-2 px-2 text-right font-mono text-xs" style={{ color: "var(--text)" }}>{fmt(r.dayClose)}</td>
                <td className="py-2 px-2 text-right font-mono text-xs" style={{ color: closeUp ? "var(--gain)" : "var(--loss)" }}>
                  {r.closeVsBreakoutPct == null ? "—" : `${closeUp ? "+" : ""}${fmt(r.closeVsBreakoutPct)}%`}
                </td>
                <td className="py-2 px-2 text-right font-mono text-xs" style={{ color: "var(--gain)" }}>
                  {r.maxGainPct == null ? "—" : `+${fmt(r.maxGainPct)}%`}
                </td>
                <td className="py-2 px-2 pr-4 text-right font-mono text-xs" style={{ color: "var(--loss)" }}>
                  {r.maxDrawdownPct == null ? "—" : `${fmt(r.maxDrawdownPct)}%`}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function BacktestSection() {
  const earliest = daysAgoIST(58);
  const today = todayIST();
  const [start, setStart] = useState(earliest);
  const [end, setEnd] = useState(today);
  const [volumeMultiplier, setVolumeMultiplier] = useState(1.5);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  async function runBacktest() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/niftybank/backtest?start=${start}&end=${end}&volumeMultiplier=${volumeMultiplier}`
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Backtest failed");
      setData(json);
    } catch (err) {
      setError(err.message);
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    runBacktest();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="mt-8">
      <h3 className="font-display text-base mb-1" style={{ color: "var(--text)" }}>
        Backtest
      </h3>
      <p className="text-xs mb-3" style={{ color: "var(--text-faint)" }}>
        Yahoo only retains intraday (5-minute) data for about the last 60 days — a genuine 3-month
        intraday backtest isn&apos;t possible from this data source, so the date range below is capped at{" "}
        {earliest} through {today}.
      </p>

      <div className="flex flex-wrap items-end gap-3 mb-4">
        <label className="flex flex-col text-xs" style={{ color: "var(--text-faint)" }}>
          Start date
          <input
            type="date"
            value={start}
            min={earliest}
            max={end}
            onChange={(e) => setStart(e.target.value)}
            className="mt-1 rounded px-2 py-1.5 text-sm border"
            style={{ background: "var(--surface-2)", borderColor: "var(--border)", color: "var(--text)" }}
          />
        </label>
        <label className="flex flex-col text-xs" style={{ color: "var(--text-faint)" }}>
          End date
          <input
            type="date"
            value={end}
            min={start}
            max={today}
            onChange={(e) => setEnd(e.target.value)}
            className="mt-1 rounded px-2 py-1.5 text-sm border"
            style={{ background: "var(--surface-2)", borderColor: "var(--border)", color: "var(--text)" }}
          />
        </label>
        <label className="flex flex-col text-xs" style={{ color: "var(--text-faint)" }}>
          Volume multiplier
          <input
            type="number"
            step="0.1"
            min="1"
            value={volumeMultiplier}
            onChange={(e) => setVolumeMultiplier(e.target.value)}
            title="How far above the historical average volume for that time-of-day slot counts as 'good volume' — only applies when real volume data is available (see note below)"
            className="mt-1 rounded px-2 py-1.5 text-sm border w-24"
            style={{ background: "var(--surface-2)", borderColor: "var(--border)", color: "var(--text)" }}
          />
        </label>
        <button
          type="button"
          onClick={runBacktest}
          disabled={loading}
          className="rounded px-4 py-1.5 text-sm font-medium disabled:opacity-50"
          style={{ background: "var(--accent)", color: "var(--surface)" }}
        >
          {loading ? "Running…" : "Run backtest"}
        </button>
      </div>

      {error && (
        <div className="mb-4 rounded-md border px-4 py-3 text-sm" style={{ borderColor: "var(--loss)", background: "var(--loss-dim)", color: "var(--text)" }}>
          {error}
        </div>
      )}

      {loading && !data && (
        <div className="py-10 text-center text-sm" style={{ color: "var(--text-muted)" }}>
          Fetching NIFTY BANK intraday history and scanning for setups…
        </div>
      )}

      {data && (
        <>
          <p className="text-xs mb-1" style={{ color: "var(--text-faint)" }}>
            {data.triggeredCount} of {data.tradingDaysScanned} trading days from {data.usableStart} to{" "}
            {data.usableEnd} triggered both breakouts
            {data.tradingDaysScanned > 0 && (
              <> ({data.daysWithBreakout5Only} broke only the 5-min high, {data.daysWithNeither} broke neither).</>
            )}
            {(data.requestedStart !== data.usableStart || data.requestedEnd !== data.usableEnd) && (
              <> Requested range was narrowed to what Yahoo&apos;s intraday feed actually has available.</>
            )}
          </p>
          {data.hasVolumeData === false ? (
            <p className="text-xs mb-3 px-2 py-1.5 rounded" style={{ background: "var(--surface-2)", color: "var(--text-faint)" }}>
              Volume is normally aggregated from NIFTY BANK&apos;s 12 constituent stocks (the index itself
              reports none), but none of them returned usable data for this range — the volume condition
              was skipped for every day rather than silently blocking every breakout. The volume multiplier
              above had no effect on these results; Day Volume and 30wk Avg Vol show as &quot;—&quot; for the
              same reason.
            </p>
          ) : (
            <p className="text-xs mb-3" style={{ color: "var(--text-faint)" }}>
              Volume aggregated from {data.volumeConstituentsReporting}/{data.volumeConstituentsTotal} NIFTY
              BANK constituent stocks.
            </p>
          )}
          <BacktestTable rows={data.rows} />
        </>
      )}
    </div>
  );
}

// ---------- Tab ----------

export default function NiftyBankTab() {
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1">
        <h2 className="font-display text-lg" style={{ color: "var(--text)" }}>
          NIFTY BANK Trading
        </h2>
      </div>
      <p className="text-xs mb-4" style={{ color: "var(--text-faint)" }}>
        {/* 50% here = (GOOD_VOLUME_MULTIPLIER - 1) * 100 from lib/niftyBank.js — update both together. */}
        Opening-range breakout: the 5-min opening candle&apos;s high broken on good volume, followed by
        the 10-min opening range&apos;s high also broken on good volume. Volume is aggregated from NIFTY
        BANK&apos;s 12 constituent stocks, since the index itself has no real trade volume of its own.
        &quot;Good volume&quot; means a candle&apos;s (aggregated) volume is more than 50% above the
        historical average volume for that same time of day (e.g. every 9:20-9:25 candle from the last
        60 days, not just today&apos;s candles so far) — comparing to today alone would unfairly measure
        every candle against the unusually high opening print. A heuristic, not a guarantee. This is
        pattern detection over historical and live price data, not trading advice.
      </p>

      <LiveCard />
      <BacktestSection />
    </div>
  );
}
