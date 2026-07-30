"use client";

import { useEffect, useState } from "react";

function fmt(n, d = 2) {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return n.toLocaleString("en-IN", { maximumFractionDigits: d, minimumFractionDigits: d });
}
function qty(n) {
  if (n == null) return "—";
  if (n >= 1e7) return `${(n / 1e7).toFixed(2)}Cr`;
  if (n >= 1e5) return `${(n / 1e5).toFixed(2)}L`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return n.toLocaleString("en-IN");
}

// Live resting orders: real exchange data, 5 levels each side.
function OrderBook({ book }) {
  const maxQty = Math.max(...[...book.bids, ...book.asks].map((r) => r.quantity), 1);
  const Side = ({ rows, label, color, dim, align }) => (
    <div className="flex-1 min-w-0">
      <p className="text-[10px] uppercase tracking-wider mb-1" style={{ color }}>
        {label}
      </p>
      <div className="flex flex-col gap-0.5">
        {rows.length === 0 && (
          <span className="text-xs" style={{ color: "var(--text-faint)" }}>
            None resting
          </span>
        )}
        {rows.map((r, i) => (
          <div key={i} className="relative flex items-center justify-between px-1.5 py-0.5 rounded-[3px] overflow-hidden">
            <span
              className="absolute inset-y-0 rounded-[3px]"
              style={{
                background: dim,
                width: `${(r.quantity / maxQty) * 100}%`,
                [align]: 0,
              }}
            />
            <span className="relative font-mono text-xs" style={{ color: "var(--text)" }}>
              ₹{fmt(r.price)}
            </span>
            <span className="relative font-mono text-xs" style={{ color: "var(--text-muted)" }}>
              {qty(r.quantity)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div>
      <div className="flex gap-4">
        <Side rows={book.bids} label="Buyers (bids)" color="var(--gain)" dim="var(--gain-dim)" align="left" />
        <Side rows={book.asks} label="Sellers (asks)" color="var(--loss)" dim="var(--loss-dim)" align="right" />
      </div>
      {(book.totalBuyQuantity || book.totalSellQuantity) && (
        <p className="text-[11px] mt-2" style={{ color: "var(--text-muted)" }}>
          Total resting — buy <span className="font-mono" style={{ color: "var(--gain)" }}>{qty(book.totalBuyQuantity)}</span>{" "}
          vs sell <span className="font-mono" style={{ color: "var(--loss)" }}>{qty(book.totalSellQuantity)}</span>
        </p>
      )}
    </div>
  );
}

// Volume traded at each price level, with the POC and value area marked.
function VolumeProfile({ profile }) {
  const maxVol = Math.max(...profile.buckets.map((b) => b.volume), 1);
  // Highest price at the top reads like a chart's price axis.
  const ordered = [...profile.buckets].reverse();

  return (
    <div>
      <div className="flex flex-wrap gap-x-5 gap-y-1 mb-2 text-[11px]" style={{ color: "var(--text-muted)" }}>
        <span>
          Most-traded price (POC):{" "}
          <span className="font-mono" style={{ color: "var(--accent)" }}>
            ₹{fmt(profile.poc.priceLow)}–{fmt(profile.poc.priceHigh)}
          </span>
        </span>
        <span>
          70% value area:{" "}
          <span className="font-mono" style={{ color: "var(--text)" }}>
            ₹{fmt(profile.valueArea.low)}–{fmt(profile.valueArea.high)}
          </span>
        </span>
      </div>

      <div className="flex flex-col gap-[1px]">
        {ordered.map((b, i) => {
          const isPoc = b.priceLow === profile.poc.priceLow;
          const inVA = b.priceLow >= profile.valueArea.low && b.priceHigh <= profile.valueArea.high;
          const buyPct = b.volume > 0 ? (b.buyEstimate / b.volume) * 100 : 50;
          return (
            <div key={i} className="flex items-center gap-2">
              <span
                className="font-mono text-[10px] w-16 text-right shrink-0"
                style={{ color: isPoc ? "var(--accent)" : "var(--text-faint)" }}
              >
                {fmt(b.priceLow)}
              </span>
              <div className="flex-1 h-3 relative" style={{ background: "var(--surface-3)", borderRadius: 2 }}>
                <div
                  className="absolute inset-y-0 left-0 flex"
                  style={{ width: `${(b.volume / maxVol) * 100}%`, borderRadius: 2, overflow: "hidden" }}
                >
                  <div style={{ width: `${buyPct}%`, background: "var(--gain)", opacity: isPoc ? 0.95 : inVA ? 0.7 : 0.4 }} />
                  <div style={{ width: `${100 - buyPct}%`, background: "var(--loss)", opacity: isPoc ? 0.95 : inVA ? 0.7 : 0.4 }} />
                </div>
              </div>
              <span className="font-mono text-[10px] w-14 shrink-0" style={{ color: "var(--text-muted)" }}>
                {qty(b.volume)}
              </span>
            </div>
          );
        })}
      </div>

      <div className="flex items-center gap-4 mt-2 text-[10px]" style={{ color: "var(--text-faint)" }}>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: "var(--gain)" }} /> buying lean
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: "var(--loss)" }} /> selling lean
        </span>
        <span>· {profile.barsUsed} five-minute bars</span>
      </div>
    </div>
  );
}

export default function StockDepthPanel({ symbol }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!symbol) return;
    let cancelled = false;
    setData(null);
    setError(null);
    (async () => {
      try {
        const res = await fetch(`/api/depth?symbol=${encodeURIComponent(symbol)}`);
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error || "Couldn't load depth");
        if (!cancelled) setData(json);
      } catch (err) {
        if (!cancelled) setError(err.message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [symbol]);

  if (error) {
    return (
      <p className="px-4 py-3 text-xs" style={{ color: "var(--text-muted)" }}>
        {error}
      </p>
    );
  }
  if (!data) {
    return (
      <p className="px-4 py-3 text-xs" style={{ color: "var(--text-muted)" }}>
        Loading order book and volume profile…
      </p>
    );
  }

  return (
    <div className="px-4 py-3 flex flex-col gap-4">
      <div>
        <p className="text-[10px] uppercase tracking-wider mb-1.5" style={{ color: "var(--text-muted)" }}>
          Live order book · resting quantities
        </p>
        {data.orderBookAvailable ? (
          <OrderBook book={data.orderBook} />
        ) : (
          <p className="text-xs" style={{ color: "var(--text-faint)" }}>
            NSE didn&apos;t return the order book. It only carries resting orders while the market is open, and NSE
            blocks hosted servers fairly often — this tends to work from a local machine during market hours.
          </p>
        )}
      </div>

      <div>
        <p className="text-[10px] uppercase tracking-wider mb-1.5" style={{ color: "var(--text-muted)" }}>
          Volume traded at each price · last month
        </p>
        {data.volumeProfileAvailable ? (
          <VolumeProfile profile={data.volumeProfile} />
        ) : (
          <p className="text-xs" style={{ color: "var(--text-faint)" }}>
            Intraday history wasn&apos;t available for this symbol.
          </p>
        )}
      </div>

      <p className="text-[11px] leading-relaxed" style={{ color: "var(--text-faint)" }}>
        The order book above is real exchange data — actual resting buy and sell quantities at each price, 5 levels
        each side. The volume profile is computed from 5-minute bars by spreading each bar&apos;s volume across the
        prices it covered, so the shape is a close approximation rather than a measurement. The green/red split
        within each bar is a weaker estimate still: it infers a lean from where each bar closed in its own range.
        Truly separating buyer-initiated from seller-initiated volume needs tick-by-tick trades tagged against the
        bid/ask at the moment of each trade, which no free NSE or Yahoo feed publishes — that requires a paid tick
        data source such as a broker API. Read the split as a lean, not as counted buyers and sellers.
      </p>
    </div>
  );
}
