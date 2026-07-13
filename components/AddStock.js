"use client";

import { useEffect, useRef, useState } from "react";

export default function AddStock({ onAdd, existingSymbols }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const boxRef = useRef(null);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }
    setLoading(true);
    const handle = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
        const data = await res.json();
        setResults(data.results || []);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => clearTimeout(handle);
  }, [query]);

  useEffect(() => {
    function handleClick(e) {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  function pick(symbol) {
    onAdd(symbol);
    setQuery("");
    setResults([]);
    setOpen(false);
  }

  function handleManualAdd(e) {
    e.preventDefault();
    const sym = query.trim().toUpperCase();
    if (sym) pick(sym);
  }

  return (
    <div className="relative w-full max-w-sm" ref={boxRef}>
      <form onSubmit={handleManualAdd}>
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder="Add a stock — e.g. WIPRO, ITC…"
          className="w-full rounded-md px-3 py-2 text-sm font-mono outline-none border transition-colors"
          style={{
            background: "var(--surface-2)",
            borderColor: "var(--border)",
            color: "var(--text)",
          }}
        />
      </form>

      {open && query.trim() && (
        <div
          className="absolute z-10 mt-1 w-full rounded-md border shadow-lg overflow-hidden"
          style={{ background: "var(--surface-2)", borderColor: "var(--border)" }}
        >
          {loading && (
            <div className="px-3 py-2 text-xs" style={{ color: "var(--text-muted)" }}>
              Searching…
            </div>
          )}
          {!loading && results.length === 0 && (
            <button
              type="button"
              onClick={handleManualAdd}
              className="w-full text-left px-3 py-2 text-sm hover:bg-white/5"
              style={{ color: "var(--text)" }}
            >
              Add “{query.trim().toUpperCase()}” anyway
            </button>
          )}
          {results.map((r) => {
            const already = existingSymbols.includes(r.symbol);
            return (
              <button
                type="button"
                key={`${r.symbol}-${r.exchange}`}
                disabled={already}
                onClick={() => pick(r.symbol)}
                className="w-full flex items-center justify-between px-3 py-2 text-sm hover:bg-white/5 disabled:opacity-40"
              >
                <span className="flex flex-col text-left">
                  <span className="font-mono" style={{ color: "var(--text)" }}>
                    {r.symbol}
                  </span>
                  <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                    {r.name}
                  </span>
                </span>
                <span
                  className="text-[10px] px-1.5 py-0.5 rounded border"
                  style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}
                >
                  {r.exchange}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
