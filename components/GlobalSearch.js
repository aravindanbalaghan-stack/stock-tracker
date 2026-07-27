"use client";

import { useEffect, useRef, useState } from "react";

// Header search available from every tab. Replaces the old Research
// tab's search box: the same lookup, but you no longer have to navigate
// away from whatever screen you're on to use it.
export default function GlobalSearch({ onSelect }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const boxRef = useRef(null);
  const inputRef = useRef(null);

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

  // "/" focuses search from anywhere, the convention in data-dense tools.
  useEffect(() => {
    function onKey(e) {
      if (e.key === "/" && document.activeElement?.tagName !== "INPUT" && document.activeElement?.tagName !== "TEXTAREA") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  function pick(symbol) {
    onSelect(symbol);
    setQuery("");
    setResults([]);
    setOpen(false);
    inputRef.current?.blur();
  }

  return (
    <div className="relative w-full sm:w-64" ref={boxRef}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const sym = query.trim().toUpperCase();
          if (sym) pick(sym);
        }}
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value.toUpperCase());
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder="Look up any stock…"
          aria-label="Look up any stock"
          className="w-full rounded-[var(--radius-sm)] pl-3 pr-7 py-1.5 text-sm font-mono outline-none border"
          style={{ background: "var(--surface-2)", borderColor: "var(--border)", color: "var(--text)" }}
        />
        <span
          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] pointer-events-none"
          style={{ color: "var(--text-faint)" }}
        >
          /
        </span>
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
              Look up “{query.trim().toUpperCase()}” anyway
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
