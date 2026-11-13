"use client";

import { useEffect, useRef, useState } from "react";
import { useSortableRows } from "@/lib/useSortableRows";
import SortableTh from "@/components/SortableTh";
import SymbolLink from "@/components/SymbolLink";
import { ScreenHeader, ErrorState, LoadingState } from "@/components/ui/Chrome";
import { loadHoldings, saveHoldingsLocal } from "@/lib/holdings";
import { RangeBar } from "@/components/MyTopFive";
import EditHoldingDialog from "@/components/EditHoldingDialog";
import { volumeFigures, fmtVolume as fmtVol } from "@/lib/liveVolume";
import { usePersistentState } from "@/lib/usePersistentState";

// Same cadence as the Watchlist / Home's My Top 5 live prices.
const QUOTE_REFRESH_MS = 12000;

function fmtTurnover(cr) {
  if (cr == null) return "—";
  if (cr >= 1000) return `₹${Math.round(cr).toLocaleString("en-IN")} Cr`;
  if (cr >= 10) return `₹${cr.toFixed(1)} Cr`;
  return `₹${cr.toFixed(2)} Cr`;
}
const tone = (v) => (v == null ? "var(--text-faint)" : v >= 0 ? "var(--gain)" : "var(--loss)");

// One holding, laid out like a Home → My Top 5 card, plus the position
// figures a holding has and a watchlist entry doesn't.
function HoldingCard({ r, onRemove, onEdit }) {
  const q = r.quote;
  const live = q && q.ok !== false;
  return (
    <div className="rounded-[var(--radius)] border p-3 flex flex-col gap-2.5" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <SymbolLink symbol={r.symbol} className="text-sm" />
          {(q?.name || r.sectorLabel) && (
            <p className="text-[11px] truncate mt-0.5" style={{ color: "var(--text-muted)" }} title={[q?.name, r.sectorLabel].filter(Boolean).join(" · ")}>
              {q?.name ?? r.sectorLabel}
            </p>
          )}
        </div>
        <span
          className="font-mono text-xs px-1.5 py-0.5 rounded whitespace-nowrap"
          style={{
            color: tone(r.changePercent),
            background: r.changePercent == null ? "var(--surface-2)" : r.changePercent >= 0 ? "var(--gain-dim)" : "var(--loss-dim)",
          }}
        >
          {r.changePercent == null ? "—" : `${r.changePercent >= 0 ? "+" : ""}${fmt(r.changePercent)}%`}
        </span>
      </div>

      <div className="flex items-baseline justify-between gap-2">
        <p className="font-mono text-xl" style={{ color: "var(--text)" }}>
          {r.price == null ? "—" : `₹${fmt(r.price)}`}
        </p>
        <p className="font-mono text-xs" style={{ color: "var(--text-faint)" }}>
          {fmt(r.quantity, 0)} × {r.avgPrice == null ? "—" : `₹${fmt(r.avgPrice)}`}
        </p>
      </div>

      <RangeBar low={live ? q.dayLow : null} high={live ? q.dayHigh : null} price={r.price} />

      {/* Position — the part that's specific to a holding */}
      <div className="rounded-[var(--radius-sm)] px-2.5 py-2 grid grid-cols-2 gap-x-3 gap-y-1.5" style={{ background: "var(--surface-2)" }}>
        <div>
          <p className="text-[10px]" style={{ color: "var(--text-faint)" }}>P&amp;L</p>
          <p className="font-mono text-sm">
            <Signed value={r.pnl} digits={0} suffix="" />
            <span className="text-[11px] ml-1">
              (<Signed value={r.pnlPct} digits={1} />)
            </span>
          </p>
        </div>
        <div>
          <p className="text-[10px]" style={{ color: "var(--text-faint)" }}>Today</p>
          <p className="font-mono text-sm">
            <Signed value={r.dayPnl} digits={0} suffix="" />
          </p>
        </div>
        <div>
          <p className="text-[10px]" style={{ color: "var(--text-faint)" }}>Invested</p>
          <p className="font-mono text-xs" style={{ color: "var(--text-muted)" }}>
            {r.invested == null ? "—" : `₹${fmt(r.invested, 0)}`}
          </p>
        </div>
        <div>
          <p className="text-[10px]" style={{ color: "var(--text-faint)" }}>Current</p>
          <p className="font-mono text-xs" style={{ color: "var(--text)" }}>
            {r.currentValue == null ? "—" : `₹${fmt(r.currentValue, 0)}`}
          </p>
        </div>
      </div>

      <div className="text-[11px] flex items-baseline justify-between gap-2">
        <span style={{ color: "var(--text-faint)" }}>
          Volume
          {r.vf?.source === "live" && <span style={{ color: "var(--gain)" }}> · live</span>}
        </span>
        <span className="font-mono" style={{ color: "var(--text)" }} title={r.vf?.asOf ? `Session ${r.vf.asOf}` : undefined}>
          {fmtVol(r.vf?.volume ?? null)}{" "}
          <span
            style={{
              color: r.vf?.ratio == null ? "var(--text-faint)" : r.vf.ratio >= 2 ? "var(--accent)" : r.vf.ratio >= 1 ? "var(--text-muted)" : "var(--text-faint)",
            }}
            title="Volume ÷ 30-session average daily volume"
          >
            ({r.vf?.ratio == null ? "— vs 30D" : `${r.vf.ratio.toFixed(2)}× 30D avg`}
            {r.vf?.source === "live" ? " so far" : ""})
          </span>
          {r.vf?.projectedRatio != null && (
            <span className="block text-right text-[10px]" style={{ color: "var(--text-faint)" }}>
              on pace for ~{r.vf.projectedRatio.toFixed(1)}× today
            </span>
          )}
        </span>
      </div>

      <div className="grid grid-cols-3 gap-2 text-[11px]">
        <div>
          <p style={{ color: "var(--text-faint)" }}>Deliv. %</p>
          <p className="font-mono" style={{ color: "var(--text-muted)" }}>
            {r.accumulation?.deliveryPct == null ? "—" : `${fmt(r.accumulation.deliveryPct, 1)}%`}
          </p>
        </div>
        <div>
          <p style={{ color: "var(--text-faint)" }}>Turnover</p>
          <p className="font-mono" style={{ color: "var(--text-muted)" }}>
            {r.vf?.source !== "eod" && r.vf?.turnoverCr != null ? "≈" : ""}
            {fmtTurnover(r.vf?.turnoverCr ?? r.accumulation?.turnoverCr)}
          </p>
        </div>
        <div>
          <p style={{ color: "var(--text-faint)" }}>Accum.</p>
          <p
            className="font-mono"
            style={{ color: r.accumulation?.inAccumulation ? "var(--gain)" : "var(--text-faint)" }}
            title={r.accumulation?.inAccumulation && r.accumulation.firstYes ? `First flagged on ${r.accumulation.firstYes}` : undefined}
          >
            {r.accumulation?.inAccumulation == null ? "—" : r.accumulation.inAccumulation ? "Yes" : "No"}
          </p>
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 pt-1 border-t" style={{ borderColor: "var(--border)" }}>
        <span className="text-[10px]" style={{ color: "var(--text-faint)" }}>
          {r.buyDate ? `Bought ${new Date(`${r.buyDate}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })}` : r.quote?.ok === false ? "price unavailable" : ""}
        </span>
        <span className="flex gap-1.5">
          <button
            onClick={() => onEdit(r.symbol)}
            className="text-[11px] px-2 py-0.5 rounded border"
            style={{ borderColor: "var(--accent)", color: "var(--accent)" }}
            aria-label={`Edit ${r.symbol}`}
          >
            Edit
          </button>
          <button
            onClick={() => onRemove(r.symbol)}
            className="text-[11px] px-2 py-0.5 rounded border transition-colors hover:border-[var(--loss)] hover:text-[var(--loss)]"
            style={{ borderColor: "var(--border)", color: "var(--text-faint)" }}
            aria-label={`Remove ${r.symbol} from holdings`}
          >
            Remove
          </button>
        </span>
      </div>
    </div>
  );
}

const CARD_SORTS = [
  { key: "currentValue", dir: "desc", label: "Current value" },
  { key: "pnlPct", dir: "desc", label: "P&L %" },
  { key: "pnl", dir: "desc", label: "P&L ₹" },
  { key: "changePercent", dir: "desc", label: "Today's change" },
  { key: "symbol", dir: "asc", label: "Symbol" },
];

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
  const [accumAsOf, setAccumAsOf] = useState(null);
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

  // Live prices every few seconds, like the Watchlist — sectors and the
  // bhavcopy figures below only change daily, so they stay a one-off fetch.
  const symbolKey = holdings.map((h) => h.symbol).join(",");
  useEffect(() => {
    if (!symbolKey) return;
    const id = setInterval(async () => {
      try {
        const res = await fetch(`/api/quote?symbols=${encodeURIComponent(symbolKey)}`);
        if (!res.ok) return;
        const json = await res.json();
        const quoteMap = {};
        for (const q of json.results ?? []) quoteMap[q.symbol] = q;
        setQuotes(quoteMap);
      } catch {
        /* keep the last prices; the next tick retries */
      }
    }, QUOTE_REFRESH_MS);
    return () => clearInterval(id);
  }, [symbolKey]);

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
        setAccumAsOf(accumJson.asOf ?? null);
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

  // Edit / add shares / sell shares (EditHoldingDialog). Applied locally
  // straight away, then saved to the account.
  async function handleEdit(symbol, patch) {
    const { historyEntry, ...fields } = patch;
    setHoldings((prev) =>
      prev.map((h) =>
        h.symbol === symbol
          ? { ...h, ...fields, history: historyEntry ? [...(h.history ?? []), { ...historyEntry, at: new Date().toISOString() }] : h.history }
          : h
      )
    );
    const res = await fetch("/api/holdings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbol, ...patch }),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) throw new Error(json?.error || "Couldn't save the change");
    if (json?.entries) setHoldings(json.entries);
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
      // Live volume / turnover while NSE is open, end-of-day otherwise.
      vf: volumeFigures(q, accumulation[h.symbol], accumAsOf),
    };
  });

  const { sorted, sort, onSort } = useSortableRows(rows, "currentValue", "desc");
  const [view, setView] = usePersistentState("holdings.view", "cards");
  const [editing, setEditing] = useState(null);
  const editingHolding = editing ? holdings.find((h) => h.symbol === editing) : null;
  const [cardSortKey, setCardSortKey] = usePersistentState("holdings.cardSort", "currentValue");
  const cardSort = CARD_SORTS.find((s) => s.key === cardSortKey) ?? CARD_SORTS[0];
  const cardRows = [...rows].sort((a, b) => {
    const av = a[cardSort.key];
    const bv = b[cardSort.key];
    if (av == null && bv == null) return 0;
    if (av == null) return 1; // missing values last either way
    if (bv == null) return -1;
    const c = typeof av === "string" ? av.localeCompare(bv) : av - bv;
    return cardSort.dir === "asc" ? c : -c;
  });

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

          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <div className="inline-flex rounded-[var(--radius-sm)] border p-0.5 gap-0.5" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
              {[
                { id: "cards", label: "Cards" },
                { id: "table", label: "Table" },
              ].map((v) => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => setView(v.id)}
                  className="px-3 py-1 text-xs font-medium rounded-[4px]"
                  style={{
                    background: view === v.id ? "var(--surface-3)" : "transparent",
                    color: view === v.id ? "var(--text)" : "var(--text-muted)",
                  }}
                >
                  {v.label}
                </button>
              ))}
            </div>
            {view === "cards" && (
              <label className="flex items-center gap-1.5 text-xs" style={{ color: "var(--text-faint)" }}>
                Sort by
                <select
                  value={cardSort.key}
                  onChange={(e) => setCardSortKey(e.target.value)}
                  className="rounded-[var(--radius-sm)] px-2 py-1 text-xs border"
                  style={{ background: "var(--surface-2)", borderColor: "var(--border)", color: "var(--text)" }}
                >
                  {CARD_SORTS.map((s) => (
                    <option key={s.key} value={s.key}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>

          {view === "cards" ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {cardRows.map((r) => (
                <HoldingCard key={r.symbol} r={r} onRemove={handleRemove} onEdit={setEditing} />
              ))}
            </div>
          ) : (
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
                    <td className="py-3 pl-2 pr-4 text-right whitespace-nowrap">
                      <button
                        onClick={() => setEditing(r.symbol)}
                        className="text-xs px-2 py-1 rounded border mr-1.5"
                        style={{ borderColor: "var(--accent)", color: "var(--accent)" }}
                        aria-label={`Edit ${r.symbol}`}
                      >
                        Edit
                      </button>
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
          )}
        </>
      )}

      {editingHolding && (
        <EditHoldingDialog
          holding={editingHolding}
          currentPrice={quotes[editingHolding.symbol]?.price ?? null}
          onSave={handleEdit}
          onRemove={handleRemove}
          onClose={() => setEditing(null)}
        />
      )}

      <p className="mt-4 text-xs" style={{ color: "var(--text-faint)" }}>
        Prices via Yahoo Finance, delayed per exchange feed terms — not for trading decisions. P&amp;L is
        computed from the average price you enter, not a broker statement — Panel doesn&apos;t know your
        actual cost basis, brokerage, or taxes.
      </p>
    </div>
  );
}
