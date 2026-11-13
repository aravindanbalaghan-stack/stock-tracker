"use client";

// Stock page chart — candlesticks (daily or weekly) with volume and moving
// averages, plus what only Panel knows about this stock: where its
// screeners fired, results / dividends / splits, your Journal entries and
// exits, your Analysis ideas and study levels, and your holding's average
// price. Every overlay can be toggled; the choices are remembered.
// Rendering: TradingView's lightweight-charts (Apache-2.0).

import { useEffect, useMemo, useRef, useState } from "react";
import { createChart, CandlestickSeries, HistogramSeries, LineSeries, createSeriesMarkers, LineStyle, CrosshairMode } from "lightweight-charts";
import { SectionTitle } from "@/components/ui/Chrome";
import { usePersistentState } from "@/lib/usePersistentState";

const RANGES = [
  { id: "3M", days: 92 },
  { id: "6M", days: 183 },
  { id: "1Y", days: 366 },
  { id: "2Y", days: 731 },
  { id: "5Y", days: 1830 },
];
const OVERLAYS = [
  { id: "ma", label: "Moving averages" },
  { id: "volume", label: "Volume" },
  { id: "signals", label: "Screener signals" },
  { id: "events", label: "Events" },
  { id: "trades", label: "My trades" },
  { id: "analysis", label: "My analysis" },
  { id: "holding", label: "My holding" },
];
const DEFAULT_ON = { ma: true, volume: true, signals: true, events: true, trades: true, analysis: true, holding: true };

// Short codes for screener markers; the full name is in the legend/tooltip.
const SCREEN_CODE = {
  "trendline-breakout": "TL",
  "monthly-breakout": "MB",
  "personal-learning": "PL",
  "ipo-base": "IPO",
  "pocket-pivot": "PP",
  shakeout: "SO",
  "stage-2": "S2",
  wyckoff: "WY",
  weinstein: "WS",
  "gap-up": "GU",
  "volume-expansion": "VE",
  "gap-down-reversal": "GR",
  "ma-reclaim": "MR",
};

function cssVar(name, fallback) {
  if (typeof window === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function weekKey(date) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

function toWeekly(bars) {
  const m = new Map();
  for (const b of bars) {
    const k = weekKey(b.time);
    const w = m.get(k);
    if (!w) m.set(k, { ...b, time: k });
    else {
      w.high = Math.max(w.high, b.high);
      w.low = Math.min(w.low, b.low);
      w.close = b.close;
      w.volume += b.volume;
    }
  }
  return [...m.values()];
}

function smaLine(bars, n) {
  const out = [];
  let sum = 0;
  for (let i = 0; i < bars.length; i++) {
    sum += bars[i].close;
    if (i >= n) sum -= bars[i - n].close;
    if (i >= n - 1) out.push({ time: bars[i].time, value: sum / n });
  }
  return out;
}

// Snap a calendar date onto the bar that contains it (markers must sit on a bar).
function snapper(bars, weekly) {
  const times = bars.map((b) => b.time);
  return (date) => {
    if (!date) return null;
    const d = weekly ? weekKey(date) : date;
    if (d < times[0] || d > times[times.length - 1]) return null;
    let lo = 0;
    let hi = times.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (times[mid] <= d) lo = mid;
      else hi = mid - 1;
    }
    return times[lo];
  };
}

const fmt = (n) => (n == null ? "—" : n.toLocaleString("en-IN", { maximumFractionDigits: 2 }));

export default function StockChart({ symbol }) {
  const box = useRef(null);
  const [loaded, setLoaded] = useState({ key: null, data: null, error: null });
  const [range, setRange] = usePersistentState("chart.range", "1Y");
  const [interval, setInterval_] = usePersistentState("chart.interval", "D");
  const [on, setOn] = usePersistentState("chart.overlays", DEFAULT_ON);
  const [hover, setHover] = useState(null);
  const data = loaded.key === symbol ? loaded.data : null;
  const error = loaded.key === symbol ? loaded.error : null;

  useEffect(() => {
    let alive = true;
    fetch(`/api/chart?symbol=${encodeURIComponent(symbol)}`)
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j?.error || "Couldn't load the chart");
        return j;
      })
      .then((j) => alive && setLoaded({ key: symbol, data: j, error: null }))
      .catch((e) => alive && setLoaded({ key: symbol, data: null, error: e.message }));
    return () => {
      alive = false;
    };
  }, [symbol]);

  const weekly = interval === "W";
  const bars = useMemo(() => {
    if (!data?.bars?.length) return [];
    const daily = data.bars;
    return weekly ? toWeekly(daily) : daily;
  }, [data, weekly]);

  const upcoming = useMemo(() => (data?.events ?? []).filter((e) => e.date > (data?.asOf ?? "")).slice(0, 4), [data]);

  useEffect(() => {
    if (!box.current || !bars.length) return;
    const C = {
      bg: cssVar("--surface", "#0e1421"),
      text: cssVar("--text-muted", "#8493ad"),
      grid: cssVar("--border", "#1f2942"),
      up: cssVar("--gain", "#35c77b"),
      down: cssVar("--loss", "#ef5350"),
      accent: cssVar("--accent", "#e0b455"),
      blue: cssVar("--tier-low", "#4b9fd4"),
      faint: cssVar("--text-faint", "#56637f"),
    };
    const chart = createChart(box.current, {
      autoSize: true,
      layout: { background: { color: C.bg }, textColor: C.text, fontFamily: "IBM Plex Mono, monospace", fontSize: 11 },
      grid: { vertLines: { color: C.grid }, horzLines: { color: C.grid } },
      rightPriceScale: { borderColor: C.grid },
      timeScale: { borderColor: C.grid, rightOffset: 4 },
      crosshair: { mode: CrosshairMode.Normal },
      localization: { priceFormatter: (p) => fmt(p) },
    });

    const candles = chart.addSeries(CandlestickSeries, {
      upColor: C.up,
      downColor: C.down,
      borderUpColor: C.up,
      borderDownColor: C.down,
      wickUpColor: C.up,
      wickDownColor: C.down,
    });
    candles.setData(bars.map(({ time, open, high, low, close }) => ({ time, open, high, low, close })));

    if (on.volume) {
      const vol = chart.addSeries(HistogramSeries, { priceScaleId: "vol", priceFormat: { type: "volume" }, lastValueVisible: false, priceLineVisible: false });
      chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
      vol.setData(bars.map((b) => ({ time: b.time, value: b.volume, color: b.close >= b.open ? `${C.up}55` : `${C.down}55` })));
      candles.priceScale().applyOptions({ scaleMargins: { top: 0.06, bottom: 0.22 } });
    }

    if (on.ma) {
      const mas = weekly
        ? [
            [10, C.blue],
            [30, C.accent],
            [40, C.faint],
          ]
        : [
            [20, C.blue],
            [50, C.accent],
            [200, C.faint],
          ];
      for (const [n, color] of mas) {
        const line = chart.addSeries(LineSeries, { color, lineWidth: n === (weekly ? 30 : 50) ? 2 : 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
        line.setData(smaLine(bars, n));
      }
    }

    // Markers — all on the candle series, sorted by time.
    const snap = snapper(bars, weekly);
    const markers = [];
    if (on.signals) {
      for (const s of data.signals ?? []) {
        const t = snap(s.date);
        if (t) markers.push({ time: t, position: "belowBar", shape: "circle", color: C.blue, text: SCREEN_CODE[s.screen] ?? "S", size: 0.6 });
      }
    }
    if (on.events) {
      for (const e of data.events ?? []) {
        const t = snap(e.date);
        if (t) markers.push({ time: t, position: "aboveBar", shape: "square", color: C.faint, text: e.type === "Results" ? "R" : e.type === "Dividend" ? "D" : e.type === "Bonus" ? "B" : e.type === "Split" ? "SP" : "E", size: 0.6 });
      }
    }
    if (on.trades) {
      for (const tr of data.trades ?? []) {
        const long = tr.side !== "Short";
        const t1 = snap(tr.entryDate);
        if (t1) markers.push({ time: t1, position: long ? "belowBar" : "aboveBar", shape: long ? "arrowUp" : "arrowDown", color: C.accent, text: `${long ? "B" : "S"} ${fmt(tr.entryPrice)}` });
        const t2 = snap(tr.exitDate);
        if (t2 && tr.exitPrice != null) {
          const pnl = (long ? tr.exitPrice - tr.entryPrice : tr.entryPrice - tr.exitPrice) * (tr.quantity ?? 0);
          markers.push({ time: t2, position: long ? "aboveBar" : "belowBar", shape: long ? "arrowDown" : "arrowUp", color: pnl >= 0 ? C.up : C.down, text: `Exit ${fmt(tr.exitPrice)}` });
        }
      }
    }
    if (on.analysis) {
      for (const i of data.ideas ?? []) {
        const t = snap(i.date);
        if (t) markers.push({ time: t, position: "aboveBar", shape: "circle", color: C.accent, text: "A", size: 0.5 });
      }
      for (const st of data.studies ?? []) {
        const t = snap(st.date);
        if (t) markers.push({ time: t, position: "aboveBar", shape: "circle", color: st.verdict === "Bearish" ? C.down : st.verdict === "Bullish" ? C.up : C.accent, text: "St", size: 0.5 });
      }
      // Levels from your latest study of this stock.
      const latest = [...(data.studies ?? [])].sort((a, b) => (a.date < b.date ? 1 : -1))[0];
      for (const lv of latest?.supports ?? []) candles.createPriceLine({ price: lv, color: C.up, lineStyle: LineStyle.Dotted, lineWidth: 1, axisLabelVisible: true, title: "S" });
      for (const lv of latest?.resistances ?? []) candles.createPriceLine({ price: lv, color: C.down, lineStyle: LineStyle.Dotted, lineWidth: 1, axisLabelVisible: true, title: "R" });
    }
    if (on.holding && data.holding?.avgPrice) {
      candles.createPriceLine({ price: data.holding.avgPrice, color: C.accent, lineStyle: LineStyle.Dashed, lineWidth: 1, axisLabelVisible: true, title: `Avg · ${data.holding.quantity}` });
    }
    if (on.trades) {
      // Stop / target of any OPEN trade.
      for (const tr of (data.trades ?? []).filter((x) => x.exitPrice == null)) {
        if (tr.stopLoss) candles.createPriceLine({ price: tr.stopLoss, color: C.down, lineStyle: LineStyle.Dashed, lineWidth: 1, axisLabelVisible: true, title: "Stop" });
        if (tr.target) candles.createPriceLine({ price: tr.target, color: C.up, lineStyle: LineStyle.Dashed, lineWidth: 1, axisLabelVisible: true, title: "Target" });
      }
    }
    markers.sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));
    createSeriesMarkers(candles, markers);

    // Range.
    const days = RANGES.find((r) => r.id === range)?.days ?? 366;
    const end = bars[bars.length - 1].time;
    const startD = new Date(`${end}T00:00:00Z`);
    startD.setUTCDate(startD.getUTCDate() - days);
    const start = startD.toISOString().slice(0, 10);
    const from = bars.find((b) => b.time >= start)?.time ?? bars[0].time;
    chart.timeScale().setVisibleRange({ from, to: end });

    // Hover legend.
    const byTime = new Map(bars.map((b, i) => [b.time, { ...b, prev: bars[i - 1]?.close }]));
    chart.subscribeCrosshairMove((p) => setHover(p?.time ? byTime.get(p.time) ?? null : null));

    return () => chart.remove();
  }, [bars, data, on, range, weekly]);

  const last = bars[bars.length - 1];
  const shown = hover ?? (last ? { ...last, prev: bars[bars.length - 2]?.close } : null);
  const chg = shown?.prev ? ((shown.close - shown.prev) / shown.prev) * 100 : null;
  const btn = (active) =>
    active ? { background: "var(--surface-3)", color: "var(--text)", borderColor: "var(--border-strong)" } : { color: "var(--text-muted)", borderColor: "var(--border)" };

  return (
    <div>
      <SectionTitle meta={data ? `NSE daily data to ${data.asOf}` : null}>Chart</SectionTitle>
      <div className="rounded-[var(--radius)] border p-3" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
          <div className="flex items-center gap-1">
            {RANGES.map((r) => (
              <button key={r.id} type="button" onClick={() => setRange(r.id)} className="text-[11px] px-2 py-0.5 rounded border font-mono" style={btn(range === r.id)}>
                {r.id}
              </button>
            ))}
            <span className="w-2" />
            {["D", "W"].map((iv) => (
              <button key={iv} type="button" onClick={() => setInterval_(iv)} className="text-[11px] px-2 py-0.5 rounded border font-mono" style={btn(interval === iv)} title={iv === "D" ? "Daily candles" : "Weekly candles"}>
                {iv}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-1">
            {OVERLAYS.map((o) => (
              <button key={o.id} type="button" onClick={() => setOn({ ...DEFAULT_ON, ...on, [o.id]: !(on[o.id] ?? true) })} className="text-[10px] px-1.5 py-0.5 rounded border" style={btn(on[o.id] ?? true)}>
                {o.label}
              </button>
            ))}
          </div>
        </div>

        {shown && (
          <p className="text-[11px] font-mono mb-1 flex flex-wrap gap-x-3" style={{ color: "var(--text-muted)" }}>
            <span style={{ color: "var(--text)" }}>{shown.time}</span>
            <span>O {fmt(shown.open)}</span>
            <span>H {fmt(shown.high)}</span>
            <span>L {fmt(shown.low)}</span>
            <span>
              C <span style={{ color: "var(--text)" }}>{fmt(shown.close)}</span>
            </span>
            {chg != null && <span style={{ color: chg >= 0 ? "var(--gain)" : "var(--loss)" }}>{chg >= 0 ? "+" : ""}{chg.toFixed(2)}%</span>}
            <span>Vol {shown.volume?.toLocaleString("en-IN")}</span>
          </p>
        )}

        {error ? (
          <p className="text-xs py-10 text-center" style={{ color: "var(--loss)" }}>
            {error}
          </p>
        ) : !data ? (
          <div className="h-[420px] flex items-center justify-center text-xs" style={{ color: "var(--text-faint)" }}>
            Loading chart…
          </div>
        ) : (
          <div ref={box} className="h-[420px] w-full" />
        )}

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-[10px]" style={{ color: "var(--text-faint)" }}>
          {on.ma && <span>{weekly ? "MA 10 / 30 / 40 weeks" : "MA 20 / 50 / 200 days"} — blue / gold (bold) / grey</span>}
          {on.signals && (data?.signals?.length ?? 0) > 0 && (
            <span title={[...new Set(data.signals.map((s) => `${SCREEN_CODE[s.screen] ?? "S"} = ${s.label}`))].join("\n")}>
              ● blue = screener fired ({[...new Set(data.signals.map((s) => SCREEN_CODE[s.screen] ?? "S"))].join(", ")} — hover)
            </span>
          )}
          {on.events && <span>■ R results · D dividend · B bonus · SP split</span>}
          {on.trades && (data?.trades?.length ?? 0) > 0 && <span>▲▼ your entries / exits</span>}
          {on.analysis && ((data?.ideas?.length ?? 0) > 0 || (data?.studies?.length ?? 0) > 0) && <span>A idea · St study · dotted = your study levels</span>}
          {upcoming.length > 0 && (
            <span style={{ color: "var(--tier-low)" }}>
              Coming up: {upcoming.map((e) => `${e.type} ${e.date}`).join(" · ")}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
