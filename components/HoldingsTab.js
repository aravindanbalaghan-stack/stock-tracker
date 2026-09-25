"use client";

import { useEffect, useRef, useState } from "react";
import { useSortableRows } from "@/lib/useSortableRows";
import SortableTh from "@/components/SortableTh";
import SymbolLink from "@/components/SymbolLink";
import { ScreenHeader, ErrorState, LoadingState } from "@/components/ui/Chrome";
import { loadHoldings, saveHoldingsLocal } from "@/lib/holdings";

function fmt(n, d = 2) {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return n.toLocaleString("en-IN", { maximumFractionDigits: d, minimumFractionDigits: d });
}
function fmtVolume(n) {
  if (!n) return "—";
  if (n >= 1e7) return `${(n / 1e7).toFixed(2)}Cr`;
  if (n >= 1e5) return `${(n / 1e5).toFixed(2)}L`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(n);
}
function Signed({ value, digits = 2, suffix = "%" }) {
  if (value === null || value === undefined) return <span style={{ color: "var(--text-faint)" }}>—</span>;
  const up = value >= 0;
  return (
    <span style={{ color: up ? "var(--gain)" : "var(--loss)" }}>
      {up ? "+" : ""}
      {fmt(value, digits)}
      {suffix}
    </span>
  );
}

// Symbol autocomplete input, adapted from components/AddStock.js — with
// the extra quantity/price/date fields a holding needs that a plain
// watchlist entry doesn't.
function AddHoldingForm({ onAdd, existingSymbols }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [symbol, setSymbol] = useState("");
  const [quantity, setQuantity] = useState("");
  const [avgPrice, setAvgPrice] = useState("");
  const [buyDate, setBuyDate] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState(null);
  const boxRef = useRef(null);

  useEffect(() => {
    if (!query.trim() || symbol) {
      setResults([]);
      return;
    }
    const handle = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
        const data = await res.json();
        setResults(data.results || []);
      } catch {
        setResults([]);
      }
    }, 300);
    return () => clearTimeout(handle);
  }, [query, symbol]);

  useEffect(() => {
    function handleClick(e) {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  function pick(sym) {
    setSymbol(sym);
    setQuery(sym);
    setResults([]);
    setOpen(false);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setFormError(null);
    const sym = (symbol || query).trim().toUpperCase();
    if (!sym) {
      setFormError("Pick or type a symbol.");
      return;
    }
    if (!quantity || Number(quantity) <= 0) {
      setFormError("Quantity must be greater than 0.");
      return;
    }
    setSubmitting(true);
    try {
      await onAdd({ symbol: sym, quantity: Number(quantity), avgPrice: avgPrice || null, buyDate: buyDate || null });
      setSymbol("");
      setQuery("");
      setQuantity("");
      setAvgPrice("");
      setBuyDate("");
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex items-end gap-2 flex-wrap mb-4" ref={boxRef}>
      <div className="relative flex flex-col gap-1">
        <label className="text-[10px] uppercase tracking-wider" style={{ color: "var(--text-faint)" }}>
          Stock
        </label>
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSymbol("");
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder="e.g. TCS"
          className="w-32 rounded px-2 py-1.5 text-sm font-mono outline-none border"
          style={{ background: "var(--surface-2)", borderColor: "var(--border)", color: "var(--text)" }}
        />
        {open && query.trim() && !symbol && results.length > 0 && (
          <div
            className="absolute z-20 top-full mt-1 w-56 rounded-md border shadow-lg overflow-hidden"
            style={{ background: "var(--surface-2)", borderColor: "var(--border)" }}
          >
            {results.map((r) => (
              <button
                type="button"
                key={`${r.symbol}-${r.exchange}`}
                onClick={() => pick(r.symbol)}
                className="w-full flex items-center justify-between px-3 py-2 text-sm hover:bg-white/5"
              >
                <span className="font-mono" style={{ color: "var(--text)" }}>
                  {r.symbol}
                </span>
                <span className="text-[10px]" style={{ color: "var(--text-faint)" }}>
                  {r.exchange}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-[10px] uppercase tracking-wider" style={{ color: "var(--text-faint)" }}>
          Quantity
        </label>
        <input
          type="number"
          step="1"
          min="1"
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          placeholder="10"
          className="w-20 rounded px-2 py-1.5 text-sm font-mono outline-none border"
          style={{ background: "var(--surface-2)", borderColor: "var(--border)", color: "var(--text)" }}
        />
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-[10px] uppercase tracking-wider" style={{ color: "var(--text-faint)" }}>
          Avg. price (₹)
        </label>
        <input
          type="number"
          step="0.01"
          min="0"
          value={avgPrice}
          onChange={(e) => setAvgPrice(e.target.value)}
          placeholder="optional"
          className="w-28 rounded px-2 py-1.5 text-sm font-mono outline-none border"
          style={{ background: "var(--surface-2)", borderColor: "var(--border)", color: "var(--text)" }}
        />
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-[10px] uppercase tracking-wider" style={{ color: "var(--text-faint)" }}>
          Buy date
        </label>
        <input
          type="date"
          value={buyDate}
          onChange={(e) => setBuyDate(e.target.value)}
          className="rounded px-2 py-1.5 text-sm outline-none border"
          style={{ background: "var(--surface-2)", borderColor: "var(--border)", color: "var(--text)" }}
        />
      </div>

      <button
        type="submit"
        disabled={submitting}
        className="rounded px-3 py-1.5 text-sm font-medium"
        style={{ background: "var(--accent)", color: "var(--bg)" }}
      >
        {submitting ? "Adding…" : "Add holding"}
      </button>

      {formError && (
        <span className="text-xs" style={{ color: "var(--loss)" }}>
          {formError}
        </span>
      )}
    </form>
  );
}

export default function HoldingsTab() {
  const [holdings, setHoldings] = useState(() => loadHoldings());
  const [storage, setStorage] = useState(null);
  const [quotes, setQuotes] = useState({});
  const [sectors, setSectors] = useState({});
  const [accumulation, setAccumulation] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Load from the server (if signed in and KV configured), same
  // migrate-once pattern as the Watchlist tab.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/holdings");
        if (!res.ok) return;
        const json = await res.json();
        if (cancelled) return;
        if (json.storage === "unavailable") {
          setStorage("local");
          return;
        }
        setStorage("server");
        if (json.entries.length === 0 && holdings.length > 0) {
          await fetch("/api/holdings", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ entries: holdings }),
          });
          return;
        }
        if (json.entries.length > 0) setHoldings(json.entries);
      } catch {
        /* server list unavailable — the local copy stands */
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    saveHoldingsLocal(holdings);
  }, [holdings]);

  // Live quotes, sectors, and accumulation status — refetched whenever
  // the symbol list changes. Quotes alone would poll on an interval like
  // the Watchlist does; kept to a single fetch on symbol-list change here
  // since a portfolio view is checked less continuously than a watchlist.
  useEffect(() => {
    const symbols = holdings.map((h) => h.symbol);
    if (symbols.length === 0) {
      setQuotes({});
      setSectors({});
      setAccumulation({});
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const qs = symbols.join(",");
        const [quoteRes, sectorRes, accumRes] = await Promise.all([
          fetch(`/api/quote?symbols=${encodeURIComponent(qs)}`),
          fetch(`/api/sectors-for-symbols?symbols=${encodeURIComponent(qs)}`),
          fetch(`/api/watchlist-accumulation?symbols=${encodeURIComponent(qs)}`),
        ]);
        if (cancelled) return;
        const [quoteJson, sectorJson, accumJson] = await Promise.all([
          quoteRes.ok ? quoteRes.json() : { results: [] },
          sectorRes.ok ? sectorRes.json() : { results: {} },
          accumRes.ok ? accumRes.json() : { results: {} },
        ]);
        if (cancelled) return;
        const quoteMap = {};
        for (const q of quoteJson.results ?? []) quoteMap[q.symbol] = q;
        setQuotes(quoteMap);
        setSectors(sectorJson.results ?? {});
        setAccumulation(accumJson.results ?? {});
        setError(null);
      } catch (err) {
        if (!cancelled) setError(err.message || "Couldn't load holdings data");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [holdings.map((h) => h.symbol).join(",")]);

  async function handleAdd({ symbol, quantity, avgPrice, buyDate }) {
    const res = await fetch("/api/holdings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbol, quantity, avgPrice, buyDate }),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) throw new Error(json?.error || "Couldn't add holding");
    if (json?.entries) {
      setHoldings(json.entries);
    } else {
      // Server storage unavailable — apply locally so it still works.
      setHoldings((prev) => {
        const idx = prev.findIndex((h) => h.symbol === symbol);
        if (idx >= 0) {
          const existing = prev[idx];
          const oldQty = existing.quantity;
          const oldAvg = existing.avgPrice ?? avgPrice ?? 0;
          const usedAddPrice = avgPrice ?? oldAvg;
          const totalQty = oldQty + quantity;
          const newAvg = totalQty > 0 ? (oldQty * oldAvg + quantity * usedAddPrice) / totalQty : usedAddPrice;
          const next = [...prev];
          next[idx] = { ...existing, quantity: totalQty, avgPrice: Math.round(newAvg * 100) / 100 };
          return next;
        }
        return [...prev, { symbol, quantity, avgPrice, buyDate, notes: "", addedAt: new Date().toISOString() }];
      });
    }
  }

  async function handleRemove(symbol) {
    fetch(`/api/holdings?symbol=${encodeURIComponent(symbol)}`, { method: "DELETE" }).catch(() => {});
    setHoldings((prev) => prev.filter((h) => h.symbol !== symbol));
  }

  const rows = holdings.map((h) => {
    const q = quotes[h.symbol];
    const price = q?.ok !== false ? q?.price ?? null : null;
    const invested = h.avgPrice != null ? h.avgPrice * h.quantity : null;
    const currentValue = price != null ? price * h.quantity : null;
    const pnl = invested != null && currentValue != null ? currentValue - invested : null;
    const pnlPct = invested ? (pnl / invested) * 100 : null;
    const dayPnl = price != null && q?.change != null ? q.change * h.quantity : null;
    return {
      ...h,
      quote: q,
      price,
      changePercent: q?.ok !== false ? q?.changePercent ?? null : null,
      invested,
      currentValue,
      pnl,
      pnlPct,
      dayPnl,
      sectorLabel: (sectors[h.symbol] ?? []).map((s) => s.name).join(", "),
      accumulation: accumulation[h.symbol],
    };
  });

  const { sorted, sort, onSort } = useSortableRows(rows, "currentValue", "desc");

  const totals = rows.reduce(
    (acc, r) => ({
      invested: acc.invested + (r.invested ?? 0),
      currentValue: acc.currentValue + (r.currentValue ?? 0),
      dayPnl: acc.dayPnl + (r.dayPnl ?? 0),
    }),
    { invested: 0, currentValue: 0, dayPnl: 0 }
  );
  const totalPnl = totals.currentValue - totals.invested;
  const totalPnlPct = totals.invested ? (totalPnl / totals.invested) * 100 : null;

  return (
    <div>
      <ScreenHeader
        title="Holdings"
        meta={
          holdings.length > 0
            ? `${holdings.length} stock${holdings.length === 1 ? "" : "s"} · invested ₹${fmt(totals.invested, 0)} · current ₹${fmt(totals.currentValue, 0)}`
            : undefined
        }
      />

      <AddHoldingForm onAdd={handleAdd} existingSymbols={holdings.map((h) => h.symbol)} />

      {error && (
        <div className="mb-4">
          <ErrorState>{error} — retrying automatically.</ErrorState>
        </div>
      )}

      {holdings.length === 0 ? (
        <div
          className="rounded-lg border py-16 text-center"
          style={{ borderColor: "var(--border)", background: "var(--surface)" }}
        >
          <p className="font-display text-lg" style={{ color: "var(--text)" }}>
            No holdings yet
          </p>
          <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>
            Add a stock above with how many shares you hold and what you paid — Panel will track P&amp;L,
            sector, and accumulation status for it alongside your Watchlist.
          </p>
        </div>
      ) : loading && Object.keys(quotes).length === 0 ? (
        <LoadingState>Loading live prices…</LoadingState>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-5 mb-4 p-4 rounded-lg border" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
            <div className="flex flex-col gap-0.5">
              <span className="text-[10px] uppercase tracking-wider" style={{ color: "var(--text-faint)" }}>
                Invested
              </span>
              <span className="font-mono text-lg" style={{ color: "var(--text)" }}>₹{fmt(totals.invested, 0)}</span>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-[10px] uppercase tracking-wider" style={{ color: "var(--text-faint)" }}>
                Current value
              </span>
              <span className="font-mono text-lg" style={{ color: "var(--text)" }}>₹{fmt(totals.currentValue, 0)}</span>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-[10px] uppercase tracking-wider" style={{ color: "var(--text-faint)" }}>
                Total P&amp;L
              </span>
              <span className="font-mono text-lg">
                <Signed value={totalPnl} digits={0} suffix="" />
                {totalPnlPct != null && (
                  <span className="text-xs ml-1">
                    (<Signed value={totalPnlPct} />)
                  </span>
                )}
              </span>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-[10px] uppercase tracking-wider" style={{ color: "var(--text-faint)" }}>
                Today&apos;s P&amp;L
              </span>
              <span className="font-mono text-lg">
                <Signed value={totals.dayPnl} digits={0} suffix="" />
              </span>
            </div>
          </div>

          <div className="rounded-lg border overflow-hidden overflow-x-auto" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
            <table className="w-full border-collapse">
              <thead>
                <tr className="text-left border-b" style={{ borderColor: "var(--border)" }}>
                  <SortableTh label="Symbol" sortKey="symbol" sort={sort} onSort={onSort} align="left" className="pl-4" />
                  <th className="py-2 px-2 text-xs font-medium uppercase tracking-wider hidden md:table-cell text-left" style={{ color: "var(--text-faint)" }}>
                    Sector
                  </th>
                  <SortableTh label="Qty" sortKey="quantity" sort={sort} onSort={onSort} />
                  <SortableTh label="Avg ₹" sortKey="avgPrice" sort={sort} onSort={onSort} />
                  <SortableTh label="LTP" sortKey="price" sort={sort} onSort={onSort} />
                  <SortableTh label="Day chg" sortKey="changePercent" sort={sort} onSort={onSort} className="hidden sm:table-cell" />
                  <SortableTh label="Invested" sortKey="invested" sort={sort} onSort={onSort} className="hidden lg:table-cell" />
                  <SortableTh label="Current" sortKey="currentValue" sort={sort} onSort={onSort} />
                  <SortableTh label="P&L" sortKey="pnl" sort={sort} onSort={onSort} />
                  <SortableTh label="P&L %" sortKey="pnlPct" sort={sort} onSort={onSort} className="hidden sm:table-cell" />
                  <th className="py-2 px-2 text-xs font-medium uppercase tracking-wider hidden lg:table-cell" style={{ color: "var(--text-faint)" }} title="Delivery-based accumulation read — see the Delivery tab for the exact rule">
                    Accum.
                  </th>
                  <th className="py-2 pl-2 pr-4"></th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((r) => (
                  <tr key={r.symbol} className="border-b last:border-b-0" style={{ borderColor: "var(--border)" }}>
                    <td className="py-3 pl-4 pr-2">
                      <div className="flex flex-col">
                        <SymbolLink symbol={r.symbol} className="text-sm" />
                        {r.quote?.ok === false && (
                          <span className="text-[10px]" style={{ color: "var(--text-faint)" }}>
                            price unavailable
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-3 px-2 hidden md:table-cell">
                      <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                        {r.sectorLabel || "—"}
                      </span>
                    </td>
                    <td className="py-3 px-2 text-right font-mono text-sm" style={{ color: "var(--text)" }}>
                      {fmt(r.quantity, 0)}
                    </td>
                    <td className="py-3 px-2 text-right font-mono text-sm" style={{ color: "var(--text-muted)" }}>
                      {r.avgPrice == null ? "—" : `₹${fmt(r.avgPrice)}`}
                    </td>
                    <td className="py-3 px-2 text-right font-mono text-sm" style={{ color: "var(--text)" }}>
                      {r.price == null ? "—" : `₹${fmt(r.price)}`}
                    </td>
                    <td className="py-3 px-2 text-right font-mono text-xs hidden sm:table-cell">
                      <Signed value={r.changePercent} />
                    </td>
                    <td className="py-3 px-2 text-right font-mono text-xs hidden lg:table-cell" style={{ color: "var(--text-muted)" }}>
                      {r.invested == null ? "—" : `₹${fmt(r.invested, 0)}`}
                    </td>
                    <td className="py-3 px-2 text-right font-mono text-sm" style={{ color: "var(--text)" }}>
                      {r.currentValue == null ? "—" : `₹${fmt(r.currentValue, 0)}`}
                    </td>
                    <td className="py-3 px-2 text-right font-mono text-sm">
                      <Signed value={r.pnl} digits={0} suffix="" />
                    </td>
                    <td className="py-3 px-2 text-right font-mono text-xs hidden sm:table-cell">
                      <Signed value={r.pnlPct} />
                    </td>
                    <td className="py-3 px-2 hidden lg:table-cell">
                      {r.accumulation?.inAccumulation == null ? (
                        <span className="text-xs" style={{ color: "var(--text-faint)" }}>—</span>
                      ) : (
                        <span
                          title={
                            r.accumulation.inAccumulation && r.accumulation.firstYes
                              ? `First flagged in accumulation on ${r.accumulation.firstYes}`
                              : undefined
                          }
                          className="text-xs font-medium px-1.5 py-0.5 rounded border cursor-default"
                          style={{
                            borderColor: r.accumulation.inAccumulation ? "var(--gain)" : "var(--border)",
                            color: r.accumulation.inAccumulation ? "var(--gain)" : "var(--text-faint)",
                          }}
                        >
                          {r.accumulation.inAccumulation ? "Yes" : "No"}
                        </span>
                      )}
                    </td>
                    <td className="py-3 pl-2 pr-4 text-right">
                      <button
                        onClick={() => handleRemove(r.symbol)}
                        className="text-xs px-2 py-1 rounded border transition-colors hover:border-[var(--loss)] hover:text-[var(--loss)]"
                        style={{ borderColor: "var(--border)", color: "var(--text-faint)" }}
                        aria-label={`Remove ${r.symbol} from holdings`}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <p className="mt-4 text-xs" style={{ color: "var(--text-faint)" }}>
        Prices via Yahoo Finance, delayed per exchange feed terms — not for trading decisions. P&amp;L is
        computed from the average price you enter, not a broker statement — Panel doesn&apos;t know your
        actual cost basis, brokerage, or taxes.
      </p>
    </div>
  );
}
