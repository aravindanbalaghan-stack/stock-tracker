"use client";

import { useEffect, useRef } from "react";
import { createChart, LineSeries, HistogramSeries, LineStyle } from "lightweight-charts";

// Small time-series chart for the breadth views. Same library and styling
// as the stock chart, so every chart in Panel looks alike.
//
// series: [{ name, color (CSS var name or hex), data: [{ date, value }], kind: "line" | "histogram" }]
// refLines: [{ value, label, color }]

function cssVar(name, fallback) {
  if (typeof window === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}
const colorOf = (c) => (c?.startsWith("--") ? cssVar(c, "#8493ad") : c);

export default function LineChart({ series, refLines = [], height = 220, percent = false, ariaLabel }) {
  const box = useRef(null);
  useEffect(() => {
    if (!box.current) return;
    const grid = cssVar("--border", "#1f2942");
    const chart = createChart(box.current, {
      autoSize: true,
      height,
      layout: { background: { color: "transparent" }, textColor: cssVar("--text-muted", "#8493ad"), fontFamily: "IBM Plex Mono, monospace", fontSize: 11, attributionLogo: false },
      grid: { vertLines: { visible: false }, horzLines: { color: grid } },
      rightPriceScale: { borderColor: grid, scaleMargins: { top: 0.12, bottom: 0.08 } },
      timeScale: { borderColor: grid, rightOffset: 2, minBarSpacing: 0.2 },
      handleScroll: false,
      handleScale: false,
      crosshair: { horzLine: { visible: false } },
      localization: percent ? { priceFormatter: (p) => `${Math.round(p)}%` } : undefined,
    });
    let first = null;
    for (const s of series) {
      const data = (s.data ?? []).filter((p) => p.value != null && Number.isFinite(p.value)).map((p) => ({ time: p.date, value: p.value }));
      if (!data.length) continue;
      const color = colorOf(s.color);
      const ser =
        s.kind === "histogram"
          ? chart.addSeries(HistogramSeries, { color, priceLineVisible: false, lastValueVisible: false, base: 0 })
          : chart.addSeries(LineSeries, { color, lineWidth: s.width ?? 2, priceLineVisible: false, lastValueVisible: true, title: s.name ?? "" });
      if (s.kind === "histogram") {
        ser.setData(data.map((p) => ({ ...p, color: p.value >= 0 ? colorOf("--gain") : colorOf("--loss") })));
      } else ser.setData(data);
      first ??= ser;
    }
    if (first) {
      for (const r of refLines) {
        first.createPriceLine({ price: r.value, color: colorOf(r.color ?? "--text-faint"), lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: false, title: r.label ?? "" });
      }
    }
    // autoSize measures the box after mount; fit again whenever it resizes
    // so the whole history is always in view.
    const fit = () => chart.timeScale().fitContent();
    fit();
    const ro = new ResizeObserver(() => requestAnimationFrame(fit));
    ro.observe(box.current);
    return () => {
      ro.disconnect();
      chart.remove();
    };
  }, [series, refLines, height, percent]);
  return <div ref={box} style={{ height }} role="img" aria-label={ariaLabel} />;
}
