"use client";

import { useEffect, useState } from "react";

// Replaces the old Research tab. Two things changed and both were
// deliberate:
//
//  1. It's a drawer opened from the global search (and from any table
//     row), not a separate destination. Research is something you want
//     *about a stock you're already looking at* — making it a tab meant
//     re-searching a symbol you had on screen a moment ago.
//  2. It shows only the parts that actually worked. The old tab also had
//     an FII/DII section that rendered raw `JSON.stringify(...)` output,
//     and an "accumulation signal" that duplicated the In-accumulation
//     column already on Delivery Leaders. Both are dropped rather than
//     carried over — see the note at the bottom of the drawer.

function fmt(n, digits = 2) {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return n.toLocaleString("en-IN", { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

function NewsList({ items, emptyLabel }) {
  if (!items || items.length === 0) {
    return (
      <p className="text-xs" style={{ color: "var(--text-faint)" }}>
        {emptyLabel}
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-2.5">
      {items.map((n, i) => (
        <a
          key={i}
          href={n.link}
          target="_blank"
          rel="noopener noreferrer"
          className="block group"
        >
          <p className="text-sm leading-snug group-hover:underline" style={{ color: "var(--text)" }}>
            {n.title}
          </p>
          <p className="text-[11px] mt-0.5" style={{ color: "var(--text-faint)" }}>
            {n.source}
            {n.pubDate ? ` · ${new Date(n.pubDate).toLocaleDateString("en-IN")}` : ""}
          </p>
        </a>
      ))}
    </div>
  );
}

function DrawerSection({ title, subtitle, children }) {
  return (
    <div className="px-5 py-4 border-b" style={{ borderColor: "var(--border)" }}>
      <h4 className="font-display text-xs font-semibold uppercase tracking-wide mb-0.5" style={{ color: "var(--text-muted)" }}>
        {title}
      </h4>
      {subtitle && (
        <p className="text-[11px] mb-2.5" style={{ color: "var(--text-faint)" }}>
          {subtitle}
        </p>
      )}
      <div className={subtitle ? "" : "mt-2.5"}>{children}</div>
    </div>
  );
}

export default function StockDetailDrawer({ symbol, onClose, onAddToWatchlist, inWatchlist }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!symbol) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setData(null);
    (async () => {
      try {
        const res = await fetch(`/api/research?symbol=${encodeURIComponent(symbol)}`);
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error || "Couldn't load details for this stock");
        if (!cancelled) setData(json);
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [symbol]);

  // Escape closes, matching the expectation for any overlay.
  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!symbol) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div
        className="absolute inset-0"
        style={{ background: "rgba(4, 6, 12, 0.6)" }}
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        className="relative w-full max-w-md h-full overflow-y-auto border-l drawer-in"
        style={{ background: "var(--surface)", borderColor: "var(--border)" }}
        role="dialog"
        aria-label={`Details for ${symbol}`}
      >
        <div
          className="sticky top-0 z-10 px-5 py-3.5 border-b flex items-start justify-between gap-3"
          style={{ background: "var(--surface-2)", borderColor: "var(--border)" }}
        >
          <div className="min-w-0">
            <p className="font-mono text-sm" style={{ color: "var(--accent)" }}>
              {symbol}
            </p>
            <h3 className="font-display text-base font-semibold truncate" style={{ color: "var(--text)" }}>
              {data?.name ?? (loading ? "Loading…" : symbol)}
            </h3>
            {data && (
              <p className="text-xs mt-0.5" style={{ color: "var(--text-faint)" }}>
                {data.price != null && `₹${fmt(data.price)}`}
                {data.sector ? ` · ${data.sector}` : ""}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {onAddToWatchlist && (
              <button
                type="button"
                disabled={inWatchlist}
                onClick={() => onAddToWatchlist(symbol)}
                className="text-[11px] px-2 py-1 rounded border disabled:opacity-50"
                style={{
                  borderColor: inWatchlist ? "var(--border)" : "var(--accent)",
                  color: inWatchlist ? "var(--text-faint)" : "var(--accent)",
                }}
              >
                {inWatchlist ? "✓ Added" : "+ Watchlist"}
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="text-lg leading-none px-1"
              style={{ color: "var(--text-muted)" }}
              aria-label="Close"
            >
              ×
            </button>
          </div>
        </div>

        {loading && (
          <p className="px-5 py-10 text-center text-sm" style={{ color: "var(--text-muted)" }}>
            Pulling news and recent moves…
          </p>
        )}

        {error && (
          <p className="px-5 py-6 text-sm" style={{ color: "var(--text-muted)" }}>
            {error}
          </p>
        )}

        {data && !loading && (
          <>
            <DrawerSection
              title="Recent significant moves"
              subtitle="Days that moved 4%+ in the last 3 months, matched against news from around that date"
            >
              {!data.moves?.available ? (
                <p className="text-xs" style={{ color: "var(--text-faint)" }}>
                  Price history isn&apos;t reachable right now. Try again shortly.
                </p>
              ) : data.moves.moves.length === 0 ? (
                <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                  No moves of 4% or more in the last 3 months.
                </p>
              ) : (
                <div className="flex flex-col gap-2.5">
                  {data.moves.moves.map((m, i) => {
                    const up = m.changePercent >= 0;
                    return (
                      <div key={i}>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-[11px]" style={{ color: "var(--text-faint)" }}>
                            {m.date}
                          </span>
                          <span
                            className="font-mono text-sm font-medium"
                            style={{ color: up ? "var(--gain)" : "var(--loss)" }}
                          >
                            {up ? "+" : ""}
                            {fmt(m.changePercent)}%
                          </span>
                        </div>
                        <p
                          className="text-xs mt-0.5 leading-snug"
                          style={{ color: m.matchedNews ? "var(--text-muted)" : "var(--text-faint)" }}
                        >
                          {m.matchedNews
                            ? m.matchedNews
                            : "No matching news nearby — likely broader market or sector-driven."}
                        </p>
                      </div>
                    );
                  })}
                </div>
              )}
            </DrawerSection>

            <DrawerSection title={`News · ${symbol}`} subtitle="Via Google News">
              <NewsList items={data.news?.stockNews} emptyLabel="No recent articles found." />
            </DrawerSection>

            {data.news?.sector && (
              <DrawerSection title={`News · ${data.news.sector}`} subtitle="Sector-wide context">
                <NewsList items={data.news?.sectorNews} emptyLabel="No recent sector articles found." />
              </DrawerSection>
            )}

            <DrawerSection title="Upcoming events" subtitle="Board meetings and corporate actions, from NSE">
              {!data.events?.available ? (
                <p className="text-xs" style={{ color: "var(--text-faint)" }}>
                  NSE&apos;s event feed is blocked from hosted servers fairly often. Try again shortly.
                </p>
              ) : data.events.events.length === 0 ? (
                <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                  No upcoming events listed.
                </p>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {data.events.events.map((e, i) => (
                    <div key={i} className="flex items-baseline justify-between gap-3 text-sm">
                      <span style={{ color: "var(--text)" }}>{e.detail}</span>
                      <span className="font-mono text-[11px] shrink-0" style={{ color: "var(--text-faint)" }}>
                        {e.type} · {e.date}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </DrawerSection>

            <p className="px-5 py-4 text-[11px] leading-relaxed" style={{ color: "var(--text-faint)" }}>
              News matching against price moves is a heuristic — a nearby headline isn&apos;t proof it
              caused the move. For delivery-based accumulation on this stock, use the Delivery screen,
              which computes it from NSE bhavcopy data rather than estimating it here.
            </p>
          </>
        )}
      </aside>
    </div>
  );
}
