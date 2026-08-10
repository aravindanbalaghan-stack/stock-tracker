"use client";

import { useEffect, useRef, useState } from "react";

// Autocomplete symbol search, shared by the tabs that let you narrow to a
// single stock. Debounced against /api/search, with a "search it anyway"
// fallback so a symbol the lookup doesn't know can still be tried — the
// screens run off NSE bhavcopy, which covers more than the search index.
export default function SymbolSearchBox({
  value,
  onSelect,
  onClear,
  placeholder = "Search a stock…",
  width = "w-56",
}) {
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
    onSelect(symbol);
    setQuery("");
    setResults([]);
    setOpen(false);
  }

  // Once a symbol is active, show it as a removable chip rather than
  // leaving an empty box that gives no sign a filter is applied.
  if (value) {
    return (
      <div className="flex items-center gap-1.5">
        <span
          className="font-mono text-sm px-2 py-1 rounded-[var(--radius-sm)] border"
          style={{ borderColor: "var(--accent)", color: "var(--accent)", background: "var(--accent-wash)" }}
        >
          {value}
        </span>
        <button
          type="button"
          onClick={onClear}
          className="text-[11px] px-1.5 py-0.5 rounded border"
          style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}
          title="Clear the symbol filter"
        >
          Clear
        </button>
      </div>
    );
  }

  return (
    <div className={`relative ${width}`} ref={boxRef}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const sym = query.trim().toUpperCase();
          if (sym) pick(sym);
        }}
      >
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value.toUpperCase());
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
          className="w-full rounded-[var(--radius-sm)] px-2.5 py-1.5 text-sm font-mono border outline-none"
          style={{ background: "var(--surface-2)", borderColor: "var(--border)", color: "var(--text)" }}
        />
      </form>

      {open && query.trim() && (
        <div
          className="absolute z-30 mt-1 w-full rounded-[var(--radius-sm)] border shadow-xl overflow-hidden"
          style={{ background: "var(--surface-2)", borderColor: "var(--border-strong)" }}
        >
          {loading && (
            <p className="px-3 py-2 text-xs" style={{ color: "var(--text-muted)" }}>
              Searching…
            </p>
          )}
          {!loading && results.length === 0 && (
            <button
              type="button"
              onClick={() => pick(query.trim().toUpperCase())}
              className="w-full text-left px-3 py-2 text-sm hover:bg-white/5"
              style={{ color: "var(--text)" }}
            >
              Use “{query.trim().toUpperCase()}” anyway
            </button>
          )}
          {results.map((r) => (
            <button
              type="button"
              key={`${r.symbol}-${r.exchange}`}
              onClick={() => pick(r.symbol)}
              className="w-full flex items-center justify-between gap-2 px-3 py-2 text-sm hover:bg-white/5 text-left"
            >
              <span className="flex flex-col min-w-0">
                <span className="font-mono" style={{ color: "var(--text)" }}>
                  {r.symbol}
                </span>
                <span className="text-xs truncate" style={{ color: "var(--text-muted)" }}>
                  {r.name}
                </span>
              </span>
              <span
                className="text-[10px] px-1.5 py-0.5 rounded border shrink-0"
                style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}
              >
                {r.exchange}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
