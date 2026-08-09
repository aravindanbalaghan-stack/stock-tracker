"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { Panel, SectionTitle, ErrorState, LoadingState } from "@/components/ui/Chrome";
import StockDepthPanel from "@/components/StockDepthPanel";

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

function Stat({ label, value, sub, tone }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-wider" style={{ color: "var(--text-faint)" }}>
        {label}
      </span>
      <span className="font-mono text-lg" style={{ color: tone ?? "var(--text)" }}>
        {value}
      </span>
      {sub && (
        <span className="text-[11px]" style={{ color: "var(--text-faint)" }}>
          {sub}
        </span>
      )}
    </div>
  );
}

// Where the current price sits between the 52-week low and high.
function RangeBar({ low, high, price, position }) {
  if (low == null || high == null || price == null) return null;
  return (
    <div className="mt-1">
      <div className="relative h-1.5 rounded-full" style={{ background: "var(--surface-3)" }}>
        <div
          className="absolute top-1/2 -translate-y-1/2 w-2 h-2 rounded-full"
          style={{ left: `calc(${Math.min(100, Math.max(0, position ?? 0))}% - 4px)`, background: "var(--accent)" }}
        />
      </div>
      <div className="flex justify-between mt-1 text-[10px] font-mono" style={{ color: "var(--text-faint)" }}>
        <span>₹{fmt(low)}</span>
        <span>₹{fmt(high)}</span>
      </div>
    </div>
  );
}

function HoldingsTable({ shareholding }) {
  if (!shareholding) {
    return (
      <Panel>
        <p className="text-xs" style={{ color: "var(--text-faint)" }}>
          Shareholding data wasn&apos;t available. It comes from NSE&apos;s corporate-info endpoint, which is
          session-gated and blocks hosted servers often. Note that even when it loads, shareholding is
          filed <strong>quarterly</strong> — the newest figures can be up to three months old. There is no
          live shareholding feed.
        </p>
      </Panel>
    );
  }
  const rows = [
    { label: "Promoter", value: shareholding.promoter, color: "var(--accent)" },
    { label: "FII", value: shareholding.fii, color: "var(--tier-low)" },
    { label: "DII", value: shareholding.dii, color: "var(--gain)" },
    { label: "Public", value: shareholding.public, color: "var(--text-muted)" },
  ];
  return (
    <Panel>
      <p className="text-[11px] mb-2" style={{ color: "var(--text-faint)" }}>
        As filed for {shareholding.period} — quarterly data, so it lags the market.
      </p>
      <div className="flex flex-col gap-2">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center gap-3">
            <span className="text-xs w-16 shrink-0" style={{ color: "var(--text-muted)" }}>
              {r.label}
            </span>
            <div className="flex-1 h-2 rounded-full" style={{ background: "var(--surface-3)" }}>
              <div
                className="h-2 rounded-full"
                style={{ width: `${Math.min(100, r.value ?? 0)}%`, background: r.color }}
              />
            </div>
            <span className="font-mono text-xs w-14 text-right" style={{ color: "var(--text)" }}>
              {r.value == null ? "—" : `${fmt(r.value)}%`}
            </span>
          </div>
        ))}
      </div>
    </Panel>
  );
}

export default function StockInsightPage({ params }) {
  const { symbol } = use(params);
  const sym = decodeURIComponent(symbol).toUpperCase();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/stock-insight?symbol=${encodeURIComponent(sym)}`);
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error || "Couldn't load this stock");
        if (!cancelled) setData(json);
      } catch (err) {
        if (!cancelled) setError(err.message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sym]);

  const L = data?.levels;
  const A = data?.accumulation;

  return (
    <div className="min-h-screen px-4 md:px-8 py-6">
      <div className="flex items-center gap-3 mb-5 flex-wrap">
        <Link href="/" className="text-xs px-2 py-1 rounded border" style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}>
          ← Back
        </Link>
        <div>
          <h1 className="font-display text-2xl font-semibold" style={{ color: "var(--text)" }}>
            {sym}
          </h1>
          {data?.asOf && (
            <p className="text-xs" style={{ color: "var(--text-faint)" }}>
              Delivery data as of {data.asOf}
            </p>
          )}
        </div>
      </div>

      {error && <ErrorState>{error}</ErrorState>}
      {!data && !error && <LoadingState>Pulling price history, delivery data and filings…</LoadingState>}

      {data && (
        <div className="flex flex-col gap-6">
          {/* ---- Price & levels ---- */}
          <div>
            <SectionTitle>Price &amp; levels</SectionTitle>
            {L ? (
              <Panel>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-5">
                  <Stat label="Current price" value={`₹${fmt(L.price)}`} />
                  <Stat
                    label="52-week high"
                    value={`₹${fmt(L.high52)}`}
                    sub={L.pctFromHigh52 != null ? `${fmt(L.pctFromHigh52, 1)}% away` : null}
                  />
                  <Stat
                    label="52-week low"
                    value={`₹${fmt(L.low52)}`}
                    sub={L.pctFromLow52 != null ? `+${fmt(L.pctFromLow52, 1)}% above` : null}
                  />
                  <Stat
                    label="Position in range"
                    value={L.rangePositionPct == null ? "—" : `${fmt(L.rangePositionPct, 0)}%`}
                    sub="0% = at the low, 100% = at the high"
                  />
                </div>
                <div className="mt-3">
                  <RangeBar low={L.low52} high={L.high52} price={L.price} position={L.rangePositionPct} />
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-5 mt-5 pt-4 border-t" style={{ borderColor: "var(--border)" }}>
                  <Stat
                    label="21 EMA"
                    value={`₹${fmt(L.ema21)}`}
                    sub={L.aboveEma21 == null ? null : L.aboveEma21 ? "price above" : "price below"}
                    tone={L.aboveEma21 == null ? undefined : L.aboveEma21 ? "var(--gain)" : "var(--loss)"}
                  />
                  <Stat
                    label="30 WMA"
                    value={`₹${fmt(L.wma30)}`}
                    sub={L.aboveWma30 == null ? null : L.aboveWma30 ? "price above" : "price below"}
                    tone={L.aboveWma30 == null ? undefined : L.aboveWma30 ? "var(--gain)" : "var(--loss)"}
                  />
                  <Stat label="50 DMA" value={`₹${fmt(L.sma50)}`} />
                  <Stat label="200 DMA" value={`₹${fmt(L.sma200)}`} />
                </div>
              </Panel>
            ) : (
              <Panel>
                <p className="text-xs" style={{ color: "var(--text-faint)" }}>
                  Price history wasn&apos;t available for this symbol.
                </p>
              </Panel>
            )}
          </div>

          {/* ---- Holdings ---- */}
          <div>
            <SectionTitle meta="Promoter / FII / DII / Public">Shareholding</SectionTitle>
            <HoldingsTable shareholding={data.shareholding} />
          </div>

          {/* ---- Block deals & volume spikes ---- */}
          <div>
            <SectionTitle meta="Last month">Block deals &amp; unusual volume</SectionTitle>
            <Panel>
              <p className="text-[11px] uppercase tracking-wider mb-1.5" style={{ color: "var(--text-muted)" }}>
                Block deals
              </p>
              {!data.blockDeals ? (
                <p className="text-xs mb-4" style={{ color: "var(--text-faint)" }}>
                  NSE&apos;s block-deal feed wasn&apos;t reachable.
                </p>
              ) : data.blockDeals.deals.length === 0 ? (
                <p className="text-xs mb-4" style={{ color: "var(--text-faint)" }}>
                  No block deals in <strong>today&apos;s</strong> session. NSE only publishes the current
                  day through this feed, so this is not a clean bill of health for the past month — there
                  is no public historical block-deal archive behind it.
                </p>
              ) : (
                <div className="flex flex-col gap-1.5 mb-4">
                  {data.blockDeals.deals.map((d, i) => (
                    <div key={i} className="flex items-baseline justify-between gap-3 text-sm">
                      <span style={{ color: "var(--text)" }}>{d.client}</span>
                      <span className="font-mono text-xs" style={{ color: d.type === "BUY" ? "var(--gain)" : "var(--loss)" }}>
                        {d.type} {vol(d.quantity)} @ ₹{fmt(d.price)}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              <p className="text-[11px] uppercase tracking-wider mb-1.5 pt-3 border-t" style={{ color: "var(--text-muted)", borderColor: "var(--border)" }}>
                Volume spikes — days trading 2×+ their own 30-day average
              </p>
              {!A?.spikes?.length ? (
                <p className="text-xs" style={{ color: "var(--text-faint)" }}>
                  No volume spikes in the last month.
                </p>
              ) : (
                <div className="flex flex-col gap-1">
                  {A.spikes.map((s) => (
                    <div key={s.date} className="flex items-baseline justify-between gap-3 text-sm">
                      <span className="font-mono text-xs" style={{ color: "var(--text-muted)" }}>
                        {s.date}
                      </span>
                      <span className="flex items-center gap-3 font-mono text-xs">
                        <span style={{ color: "var(--accent)" }}>{s.ratio}×</span>
                        <span style={{ color: "var(--text-muted)" }}>{vol(s.volume)}</span>
                        <span style={{ color: (s.changePercent ?? 0) >= 0 ? "var(--gain)" : "var(--loss)" }}>
                          {s.changePercent == null ? "—" : `${s.changePercent >= 0 ? "+" : ""}${fmt(s.changePercent)}%`}
                        </span>
                        <span style={{ color: "var(--text-faint)" }}>
                          {s.deliveryPct == null ? "—" : `${fmt(s.deliveryPct)}% dly`}
                        </span>
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </Panel>
          </div>

          {/* ---- Accumulation ---- */}
          <div>
            <SectionTitle
              meta={
                A?.inAccumulation == null
                  ? undefined
                  : A.inAccumulation
                  ? "Currently reads as accumulation"
                  : "Not currently reading as accumulation"
              }
            >
              Accumulation — last month
            </SectionTitle>
            {!A?.rows?.length ? (
              <Panel>
                <p className="text-xs" style={{ color: "var(--text-faint)" }}>
                  No delivery data available for this symbol.
                </p>
              </Panel>
            ) : (
              <Panel flush>
                <div className="px-4 py-3 flex flex-wrap gap-x-8 gap-y-2 border-b" style={{ borderColor: "var(--border)" }}>
                  <Stat label="Avg delivery %" value={A.avgDeliveryPct == null ? "—" : `${fmt(A.avgDeliveryPct)}%`} />
                  <Stat
                    label={`Days above ${A.accumulationThreshold}%`}
                    value={`${A.daysAboveThreshold ?? "—"}/${A.accumulationWindow}`}
                    sub={`${A.accumulationMinDays}+ needed`}
                  />
                </div>
                <div className="table-scroll" style={{ maxHeight: "22rem" }}>
                  <table className="w-full border-collapse table-sticky">
                    <thead>
                      <tr className="text-left border-b" style={{ borderColor: "var(--border)" }}>
                        {["Date", "Close", "Chg %", "Delivery %", "Volume"].map((h, i) => (
                          <th
                            key={h}
                            className={`py-2 text-xs font-medium uppercase tracking-wider ${i === 0 ? "pl-4" : "px-2 text-right"}`}
                            style={{ color: "var(--text-faint)" }}
                          >
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {[...A.rows].reverse().map((r) => {
                        const up = (r.changePercent ?? 0) >= 0;
                        const high = r.deliveryPct != null && r.deliveryPct >= A.accumulationThreshold;
                        return (
                          <tr key={r.date} className="border-b last:border-b-0" style={{ borderColor: "var(--border)" }}>
                            <td className="py-2 pl-4 font-mono text-xs" style={{ color: "var(--text-muted)" }}>
                              {r.date}
                            </td>
                            <td className="py-2 px-2 text-right font-mono text-xs" style={{ color: "var(--text)" }}>
                              ₹{fmt(r.close)}
                            </td>
                            <td className="py-2 px-2 text-right font-mono text-xs" style={{ color: up ? "var(--gain)" : "var(--loss)" }}>
                              {r.changePercent == null ? "—" : `${up ? "+" : ""}${fmt(r.changePercent)}%`}
                            </td>
                            <td className="py-2 px-2 text-right font-mono text-xs" style={{ color: high ? "var(--gain)" : "var(--text-muted)" }}>
                              {r.deliveryPct == null ? "—" : `${fmt(r.deliveryPct)}%`}
                            </td>
                            <td className="py-2 px-2 text-right font-mono text-xs" style={{ color: "var(--text-muted)" }}>
                              {vol(r.volume)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </Panel>
            )}
          </div>

          {/* ---- Order book & volume at price ---- */}
          <div>
            <SectionTitle>Order book &amp; volume at price</SectionTitle>
            <Panel flush>
              <StockDepthPanel symbol={sym} />
            </Panel>
          </div>
        </div>
      )}
    </div>
  );
}
