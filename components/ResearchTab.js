"use client";

import { useEffect, useRef, useState } from "react";

function fmt(n, digits = 2) {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return n.toLocaleString("en-IN", { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

function SectionCard({ title, subtitle, children }) {
  return (
    <div className="rounded-lg border overflow-hidden mb-4" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
      <div className="px-4 py-2.5 border-b" style={{ borderColor: "var(--border)" }}>
        <h3 className="font-display text-sm" style={{ color: "var(--text)" }}>{title}</h3>
        {subtitle && <p className="text-[11px] mt-0.5" style={{ color: "var(--text-faint)" }}>{subtitle}</p>}
      </div>
      <div className="px-4 py-3">{children}</div>
    </div>
  );
}

function Unavailable({ label }) {
  return (
    <p className="text-xs" style={{ color: "var(--text-faint)" }}>
      {label} isn&apos;t available right now — this data source can be blocked intermittently from
      hosted servers. Try again in a bit.
    </p>
  );
}

function NewsList({ items }) {
  if (!items || items.length === 0) return <p className="text-xs" style={{ color: "var(--text-muted)" }}>No recent articles found.</p>;
  return (
    <div className="flex flex-col gap-2">
      {items.map((n, i) => (
        <a
          key={i}
          href={n.link}
          target="_blank"
          rel="noopener noreferrer"
          className="block hover:underline"
        >
          <p className="text-sm" style={{ color: "var(--text)" }}>{n.title}</p>
          <p className="text-[11px]" style={{ color: "var(--text-faint)" }}>
            {n.source} {n.pubDate ? `· ${new Date(n.pubDate).toLocaleDateString("en-IN")}` : ""}
          </p>
        </a>
      ))}
    </div>
  );
}

export default function ResearchTab() {
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedSymbol, setSelectedSymbol] = useState(null);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const boxRef = useRef(null);

  useEffect(() => {
    if (!query.trim()) {
      setSuggestions([]);
      return;
    }
    const handle = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
        const json = await res.json();
        setSuggestions(json.results || []);
      } catch {
        setSuggestions([]);
      }
    }, 300);
    return () => clearTimeout(handle);
  }, [query]);

  useEffect(() => {
    function handleClick(e) {
      if (boxRef.current && !boxRef.current.contains(e.target)) setShowSuggestions(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  async function loadResearch(symbol) {
    setSelectedSymbol(symbol);
    setShowSuggestions(false);
    setQuery(symbol);
    setLoading(true);
    setError(null);
    setData(null);
    try {
      const res = await fetch(`/api/research?symbol=${encodeURIComponent(symbol)}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Failed to load research");
      setData(json);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function handleSubmit(e) {
    e.preventDefault();
    const sym = query.trim().toUpperCase();
    if (sym) loadResearch(sym);
  }

  return (
    <div>
      <div className="relative w-full max-w-sm mb-6" ref={boxRef}>
        <form onSubmit={handleSubmit}>
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value.toUpperCase());
              setShowSuggestions(true);
            }}
            onFocus={() => setShowSuggestions(true)}
            placeholder="Search any stock — e.g. TCS, ZOMATO…"
            className="w-full rounded-md px-3 py-2 text-sm font-mono outline-none border"
            style={{ background: "var(--surface-2)", borderColor: "var(--border)", color: "var(--text)" }}
          />
        </form>
        {showSuggestions && suggestions.length > 0 && (
          <div className="absolute z-10 mt-1 w-full rounded-md border shadow-lg overflow-hidden" style={{ background: "var(--surface-2)", borderColor: "var(--border)" }}>
            {suggestions.map((r) => (
              <button
                key={`${r.symbol}-${r.exchange}`}
                onClick={() => loadResearch(r.symbol)}
                className="w-full flex items-center justify-between px-3 py-2 text-sm hover:bg-white/5 text-left"
              >
                <span className="flex flex-col">
                  <span className="font-mono" style={{ color: "var(--text)" }}>{r.symbol}</span>
                  <span className="text-xs" style={{ color: "var(--text-muted)" }}>{r.name}</span>
                </span>
                <span className="text-[10px] px-1.5 py-0.5 rounded border" style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}>
                  {r.exchange}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {!selectedSymbol && (
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          Search for any NSE/BSE stock to see its news, upcoming events, recent significant moves,
          accumulation signal, and FII/DII activity.
        </p>
      )}

      {loading && (
        <div className="py-16 text-center text-sm" style={{ color: "var(--text-muted)" }}>
          Pulling everything together for {selectedSymbol}…
        </div>
      )}

      {error && (
        <div className="rounded-md border px-4 py-3 text-sm" style={{ borderColor: "var(--loss)", background: "var(--loss-dim)", color: "var(--text)" }}>
          {error}
        </div>
      )}

      {data && !loading && (
        <div>
          <div className="mb-4">
            <h2 className="font-display text-xl" style={{ color: "var(--text)" }}>{data.name}</h2>
            <p className="text-xs" style={{ color: "var(--text-faint)" }}>
              {data.symbol} {data.price != null && `· ₹${fmt(data.price)}`} {data.sector && `· ${data.sector}`}
            </p>
          </div>

          <SectionCard title="News" subtitle="Stock-specific and sector-wide, via Google News">
            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <p className="text-[10px] uppercase tracking-wider mb-1.5" style={{ color: "var(--text-faint)" }}>About {data.symbol}</p>
                <NewsList items={data.news?.stockNews} />
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider mb-1.5" style={{ color: "var(--text-faint)" }}>
                  {data.news?.sector ? `${data.news.sector} sector` : "Sector"}
                </p>
                {data.news?.sector ? <NewsList items={data.news?.sectorNews} /> : (
                  <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                    This stock isn&apos;t in one of the sectors we track constituents for yet.
                  </p>
                )}
              </div>
            </div>
          </SectionCard>

          <SectionCard title="Upcoming events" subtitle="Board meetings and corporate actions, from NSE">
            {!data.events?.available ? (
              <Unavailable label="Event data" />
            ) : data.events.events.length === 0 ? (
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>No upcoming events found.</p>
            ) : (
              <div className="flex flex-col gap-1.5">
                {data.events.events.map((e, i) => (
                  <div key={i} className="flex items-center justify-between text-sm">
                    <span style={{ color: "var(--text)" }}>{e.detail}</span>
                    <span className="font-mono text-xs" style={{ color: "var(--text-faint)" }}>
                      {e.type} · {e.date}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>

          <SectionCard title="Recent significant moves" subtitle={`Days with |change| ≥ 4% in the last 3 months, matched against nearby news`}>
            {!data.moves?.available ? (
              <Unavailable label="Price history" />
            ) : data.moves.moves.length === 0 ? (
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>No moves of 4%+ in the last 3 months.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {data.moves.moves.map((m, i) => {
                  const up = m.changePercent >= 0;
                  return (
                    <div key={i} className="text-sm">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs" style={{ color: "var(--text-faint)" }}>{m.date}</span>
                        <span className="font-mono" style={{ color: up ? "var(--gain)" : "var(--loss)" }}>
                          {up ? "+" : ""}{fmt(m.changePercent)}%
                        </span>
                      </div>
                      <p className="text-xs mt-0.5" style={{ color: m.matchedNews ? "var(--text)" : "var(--text-faint)" }}>
                        {m.matchedNews ? `Possibly linked to: ${m.matchedNews}` : "No matching news found nearby — may be broader market or sector-driven."}
                      </p>
                    </div>
                  );
                })}
              </div>
            )}
          </SectionCard>

          <SectionCard title="Accumulation signal" subtitle="Based on delivery %, volume, and price trend over the last ~15 trading days">
            {!data.accumulation?.stock?.available ? (
              <Unavailable label="Accumulation data" />
            ) : (
              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <p className="text-[10px] uppercase tracking-wider mb-1" style={{ color: "var(--text-faint)" }}>{data.symbol}</p>
                  <p className="text-sm mb-1" style={{ color: "var(--accent)" }}>{data.accumulation.stock.verdict}</p>
                  <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                    Avg delivery {fmt(data.accumulation.stock.avgDeliveryPct)}% · price trend{" "}
                    {data.accumulation.stock.priceTrendPct >= 0 ? "+" : ""}
                    {fmt(data.accumulation.stock.priceTrendPct)}% over {data.accumulation.stock.windowDays} sessions
                  </p>
                </div>
                {data.accumulation.sector && (
                  <div>
                    <p className="text-[10px] uppercase tracking-wider mb-1" style={{ color: "var(--text-faint)" }}>{data.accumulation.sector.sectorName} (sector avg)</p>
                    <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                      Avg delivery {fmt(data.accumulation.sector.avgDeliveryPct)}% · avg price trend{" "}
                      {data.accumulation.sector.avgPriceTrendPct >= 0 ? "+" : ""}
                      {fmt(data.accumulation.sector.avgPriceTrendPct)}% across {data.accumulation.sector.stocksConsidered} stocks
                    </p>
                  </div>
                )}
              </div>
            )}
          </SectionCard>

          <SectionCard title="FII / DII activity" subtitle="Market-wide flows and this stock's shareholding pattern, from NSE">
            {!data.fiiDii?.available ? (
              <Unavailable label="FII/DII data" />
            ) : (
              <div className="text-xs" style={{ color: "var(--text-muted)" }}>
                {data.fiiDii.marketWide ? (
                  <div className="mb-2">
                    <p className="text-[10px] uppercase tracking-wider mb-1" style={{ color: "var(--text-faint)" }}>Market-wide, most recent sessions</p>
                    {data.fiiDii.marketWide.map((row, i) => (
                      <p key={i}>{JSON.stringify(row)}</p>
                    ))}
                  </div>
                ) : null}
                {data.fiiDii.shareholding ? (
                  <div>
                    <p className="text-[10px] uppercase tracking-wider mb-1" style={{ color: "var(--text-faint)" }}>Shareholding pattern</p>
                    <p>{JSON.stringify(data.fiiDii.shareholding)}</p>
                  </div>
                ) : null}
              </div>
            )}
          </SectionCard>

          <p className="text-[11px] mt-2" style={{ color: "var(--text-faint)" }}>
            News, moves, and accumulation are heuristic signals for research context — not
            investment advice. Events and FII/DII data depend on NSE&apos;s public site, which can be
            intermittently unavailable to hosted apps.
          </p>
        </div>
      )}
    </div>
  );
}
