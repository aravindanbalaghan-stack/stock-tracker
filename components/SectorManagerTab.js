"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ScreenHeader, ErrorState, LoadingState } from "@/components/ui/Chrome";

// The master stock <-> sector list. Every sector calculation elsewhere in
// the app (Sector Deliverability, the sector pages, a stock's "Sectors"
// row) reads from exactly the same resolved list this tab edits — see
// lib/sectorOverrides.js's getResolvedSectorList, which every one of
// those routes calls. There's no separate "display" copy: changing
// something here changes it everywhere immediately.

function SectorBadge({ symbol, sector, onRemove, busy }) {
  return (
    <span
      className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded border"
      style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}
    >
      {sector.name}
      <button
        type="button"
        disabled={busy}
        onClick={() => onRemove(symbol, sector.key, sector.viaOverride)}
        className="hover:opacity-70 disabled:opacity-30"
        title={sector.viaOverride ? "Undo this addition" : "Remove from this sector (it's in the base list, not something you added)"}
        style={{ color: "var(--loss)" }}
      >
        ×
      </button>
    </span>
  );
}

function AddSectorControl({ symbol, allSectors, onAdd, busy }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  return (
    <div className="relative inline-block" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={busy}
        className="text-[11px] px-1.5 py-0.5 rounded border disabled:opacity-40"
        style={{ borderColor: "var(--accent)", color: "var(--accent)" }}
      >
        + Sector
      </button>
      {open && (
        <div
          className="absolute z-20 mt-1 rounded border shadow-xl max-h-60 overflow-auto"
          style={{ background: "var(--surface-2)", borderColor: "var(--border-strong)", minWidth: "12rem" }}
        >
          {allSectors.map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => {
                onAdd(symbol, s.key);
                setOpen(false);
              }}
              className="w-full text-left px-2 py-1.5 text-xs hover:bg-white/5"
              style={{ color: "var(--text)" }}
            >
              {s.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Symbol search for adding a stock this list doesn't know about yet at
// all — reusing /api/search (the same Yahoo-backed autocomplete AddStock
// uses), but also accepting a typed symbol Yahoo's search doesn't know
// about, since a sector assignment shouldn't require the symbol to
// already be "discoverable" some other way.
function AddStockControl({ allSectors, onAdd }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [pickedSymbol, setPickedSymbol] = useState("");
  const [sectorKey, setSectorKey] = useState(allSectors[0]?.key ?? "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const ref = useRef(null);

  useEffect(() => {
    if (!query.trim() || pickedSymbol) {
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
  }, [query, pickedSymbol]);

  useEffect(() => {
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  async function submit(e) {
    e.preventDefault();
    setMsg(null);
    const sym = (pickedSymbol || query).trim().toUpperCase();
    if (!sym || !sectorKey) {
      setMsg("Pick a symbol and a sector.");
      return;
    }
    setBusy(true);
    try {
      await onAdd(sym, sectorKey);
      setQuery("");
      setPickedSymbol("");
      setResults([]);
      setOpen(false);
    } catch (err) {
      setMsg(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex items-end gap-2 flex-wrap mb-4" ref={ref}>
      <div className="relative flex flex-col gap-1">
        <label className="text-[10px] uppercase tracking-wider" style={{ color: "var(--text-faint)" }}>
          Add a stock not in this list
        </label>
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setPickedSymbol("");
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder="e.g. WIPRO"
          className="w-40 rounded px-2 py-1.5 text-sm font-mono outline-none border"
          style={{ background: "var(--surface-2)", borderColor: "var(--border)", color: "var(--text)" }}
        />
        {open && query.trim() && !pickedSymbol && results.length > 0 && (
          <div
            className="absolute z-20 top-full mt-1 w-56 rounded-md border shadow-lg overflow-hidden"
            style={{ background: "var(--surface-2)", borderColor: "var(--border)" }}
          >
            {results.map((r) => (
              <button
                type="button"
                key={`${r.symbol}-${r.exchange}`}
                onClick={() => {
                  setPickedSymbol(r.symbol);
                  setQuery(r.symbol);
                  setOpen(false);
                }}
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
          Sector
        </label>
        <select
          value={sectorKey}
          onChange={(e) => setSectorKey(e.target.value)}
          className="rounded px-2 py-1.5 text-sm outline-none border"
          style={{ background: "var(--surface-2)", borderColor: "var(--border)", color: "var(--text)" }}
        >
          {allSectors.map((s) => (
            <option key={s.key} value={s.key}>
              {s.name}
            </option>
          ))}
        </select>
      </div>

      <button
        type="submit"
        disabled={busy}
        className="rounded px-3 py-1.5 text-sm font-medium"
        style={{ background: "var(--accent)", color: "var(--bg)" }}
      >
        {busy ? "Adding…" : "Add"}
      </button>

      {msg && (
        <span className="text-xs" style={{ color: "var(--text-muted)" }}>
          {msg}
        </span>
      )}
    </form>
  );
}

export default function SectorManagerTab() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState("");
  const [sectorFilter, setSectorFilter] = useState("");
  const [busySymbol, setBusySymbol] = useState(null);
  const [importMsg, setImportMsg] = useState(null);
  const [marketCaps, setMarketCaps] = useState({});
  const [marketCapLoading, setMarketCapLoading] = useState(false);
  const fileInputRef = useRef(null);

  async function load() {
    try {
      const res = await fetch("/api/sector-overrides?full=1");
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Couldn't load sectors");
      setData(json);
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const allSectors = data?.sectors ?? [];

  const filtered = useMemo(() => {
    const list = data?.classified ?? [];
    const q = search.trim().toUpperCase();
    return list.filter((row) => {
      if (sectorFilter && !row.sectors.some((s) => s.key === sectorFilter)) return false;
      if (q && !row.symbol.includes(q) && !row.sectors.some((s) => s.name.toUpperCase().includes(q))) return false;
      return true;
    });
  }, [data, search, sectorFilter]);

  const visibleRows = filtered.slice(0, 500);

  // Market cap — NSE's rate-limited quote-equity endpoint (see
  // lib/marketCap.js), so this only fetches when the CURRENT filter
  // narrows things down to a reasonable batch. Applying a sector filter
  // is the expected way to see it: the base lists run 20-100 symbols per
  // sector, comfortably inside the cap; leaving every sector unfiltered
  // (400+ symbols) would either time out or risk NSE flagging the
  // session, so that case is skipped with an explanatory note instead.
  const MARKET_CAP_FETCH_CAP = 150;
  useEffect(() => {
    const symbols = visibleRows.map((r) => r.symbol);
    if (symbols.length === 0 || symbols.length > MARKET_CAP_FETCH_CAP) {
      setMarketCaps({});
      return;
    }
    let cancelled = false;
    setMarketCapLoading(true);
    (async () => {
      try {
        const res = await fetch(`/api/market-cap?symbols=${encodeURIComponent(symbols.join(","))}`);
        const json = await res.json();
        if (!cancelled && res.ok) setMarketCaps(json.results ?? {});
      } catch {
        /* market cap is a nice-to-have — the rest of the tab still works */
      } finally {
        if (!cancelled) setMarketCapLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleRows.map((r) => r.symbol).join(",")]);

  async function handleRemove(symbol, sectorKey, viaOverride) {
    setBusySymbol(symbol);
    try {
      if (viaOverride) {
        await fetch(`/api/sector-overrides?sector=${encodeURIComponent(sectorKey)}&symbol=${encodeURIComponent(symbol)}`, {
          method: "DELETE",
        });
      } else {
        await fetch("/api/sector-overrides", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sector: sectorKey, symbol, action: "exclude" }),
        });
      }
      await load();
    } finally {
      setBusySymbol(null);
    }
  }

  async function handleAddSectorToSymbol(symbol, sectorKey) {
    setBusySymbol(symbol);
    try {
      await fetch("/api/sector-overrides", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sector: sectorKey, symbol }),
      });
      await load();
    } finally {
      setBusySymbol(null);
    }
  }

  async function handleAddNewStock(symbol, sectorKey) {
    const res = await fetch("/api/sector-overrides", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sector: sectorKey, symbol }),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) throw new Error(json?.error || "Couldn't add");
    await load();
  }

  async function handleExport() {
    try {
      const res = await fetch("/api/sector-overrides?export=1");
      const json = await res.json();
      const blob = new Blob([JSON.stringify(json, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `panel-sector-customizations-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      setImportMsg("Couldn't export.");
    }
  }

  async function handleImportFile(e) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file later
    if (!file) return;
    setImportMsg(null);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const res = await fetch("/api/sector-overrides", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ import: parsed }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error || "Import failed");
      setImportMsg("Imported — your sector customizations were replaced with this file's.");
      await load();
    } catch (err) {
      setImportMsg(`Import failed: ${err.message}`);
    }
  }

  if (error) {
    return (
      <div>
        <ScreenHeader title="Sectors" />
        <ErrorState>{error}</ErrorState>
      </div>
    );
  }
  if (!data) {
    return (
      <div>
        <ScreenHeader title="Sectors" />
        <LoadingState>Loading the sector list…</LoadingState>
      </div>
    );
  }

  return (
    <div>
      <ScreenHeader
        title="Sectors"
        meta={`${data.classified.length} stocks classified across ${allSectors.length} sectors`}
        actions={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleExport}
              className="text-xs px-2.5 py-1.5 rounded border"
              style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}
            >
              Export
            </button>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="text-xs px-2.5 py-1.5 rounded border"
              style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}
            >
              Import
            </button>
            <input ref={fileInputRef} type="file" accept="application/json" onChange={handleImportFile} className="hidden" />
          </div>
        }
      />

      <p className="text-xs mb-4" style={{ color: "var(--text-muted)" }}>
        This is the one list every sector calculation in Panel reads from — the Delivery tab&apos;s sector
        view, each sector&apos;s page, and every stock&apos;s &quot;Sectors&quot; row. Fix a wrong sector by
        removing it (×) and adding the right one; a stock missing entirely can be added below. Export
        downloads just your customizations on top of the built-in lists — safe to re-import to restore them,
        including on another deployment.
      </p>

      {data.storageAvailable === false && (
        <p
          className="text-xs mb-4 px-3 py-2 rounded border"
          style={{ borderColor: "var(--loss)", color: "var(--loss)" }}
        >
          Sector customizations can&apos;t be saved on this deployment — the KV store this needs (the same
          one the alerts and Watchlist features use) isn&apos;t configured. You can still browse the base
          lists below, but Add, Remove, and Import won&apos;t work until it&apos;s set up — see the README
          section &quot;SMS price alerts&quot; step 1 for how (it&apos;s the same database, despite the
          section name). Unlike Watchlist and Holdings, sector data has no per-browser fallback — it&apos;s
          shared across the whole app, so it has nothing to silently fall back to.
        </p>
      )}

      {importMsg && (
        <p className="text-xs mb-4 px-3 py-2 rounded border" style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}>
          {importMsg}
        </p>
      )}

      <AddStockControl allSectors={allSectors} onAdd={handleAddNewStock} />

      <div className="flex items-end gap-2 flex-wrap mb-3">
        <div className="flex flex-col gap-1">
          <label className="text-[10px] uppercase tracking-wider" style={{ color: "var(--text-faint)" }}>
            Sector
          </label>
          <select
            value={sectorFilter}
            onChange={(e) => setSectorFilter(e.target.value)}
            className="rounded px-2 py-2 text-sm outline-none border"
            style={{ background: "var(--surface-2)", borderColor: "var(--border)", color: "var(--text)" }}
          >
            <option value="">All sectors</option>
            {allSectors.map((s) => (
              <option key={s.key} value={s.key}>
                {s.name} ({s.count})
              </option>
            ))}
          </select>
        </div>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by symbol or sector…"
          className="w-full max-w-sm rounded px-3 py-2 text-sm outline-none border"
          style={{ background: "var(--surface-2)", borderColor: "var(--border)", color: "var(--text)" }}
        />
        {(sectorFilter || search) && (
          <button
            type="button"
            onClick={() => {
              setSectorFilter("");
              setSearch("");
            }}
            className="text-xs px-2.5 py-2 rounded border"
            style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}
          >
            Clear filters
          </button>
        )}
      </div>

      {visibleRows.length > MARKET_CAP_FETCH_CAP && (
        <p className="text-xs mb-3" style={{ color: "var(--text-faint)" }}>
          Market cap isn&apos;t fetched for more than {MARKET_CAP_FETCH_CAP} stocks at once — pick a sector
          above (or narrow your search) to see it.
        </p>
      )}

      <div className="rounded-lg border overflow-hidden" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
        <table className="w-full border-collapse">
          <thead>
            <tr className="text-left border-b" style={{ borderColor: "var(--border)" }}>
              <th className="py-2 pl-4 pr-2 text-xs font-medium uppercase tracking-wider" style={{ color: "var(--text-faint)" }}>
                Symbol
              </th>
              <th className="py-2 px-2 text-xs font-medium uppercase tracking-wider text-right" style={{ color: "var(--text-faint)" }}>
                Mkt cap (₹ Cr)
              </th>
              <th className="py-2 px-2 text-xs font-medium uppercase tracking-wider" style={{ color: "var(--text-faint)" }}>
                Sectors
              </th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row) => (
              <tr key={row.symbol} className="border-b last:border-b-0" style={{ borderColor: "var(--border)" }}>
                <td className="py-2 pl-4 pr-2 font-mono text-sm" style={{ color: "var(--text)" }}>
                  {row.symbol}
                </td>
                <td className="py-2 px-2 text-right font-mono text-xs" style={{ color: "var(--text-muted)" }}>
                  {visibleRows.length > MARKET_CAP_FETCH_CAP ? (
                    "—"
                  ) : marketCapLoading && marketCaps[row.symbol] === undefined ? (
                    <span style={{ color: "var(--text-faint)" }}>…</span>
                  ) : marketCaps[row.symbol] == null ? (
                    "—"
                  ) : (
                    marketCaps[row.symbol].toLocaleString("en-IN")
                  )}
                </td>
                <td className="py-2 px-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {row.sectors.map((s) => (
                      <SectorBadge key={s.key} symbol={row.symbol} sector={s} onRemove={handleRemove} busy={busySymbol === row.symbol} />
                    ))}
                    <AddSectorControl symbol={row.symbol} allSectors={allSectors} onAdd={handleAddSectorToSymbol} busy={busySymbol === row.symbol} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {filtered.length > 500 && (
        <p className="mt-2 text-xs" style={{ color: "var(--text-faint)" }}>
          Showing the first 500 of {filtered.length} matches — narrow your search to see more.
        </p>
      )}
    </div>
  );
}
