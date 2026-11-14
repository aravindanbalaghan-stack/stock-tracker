"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { TABS, SUB_VIEWS, tabHref, presetSubView, PALETTE_EVENT } from "@/lib/navigation";
import { loadRecentSymbols } from "@/lib/recentSymbols";
import { loadWatchlist } from "@/lib/watchlist";

// ⌘K / Ctrl+K command bar, mounted once for the whole app (app/layout.js).
//
//   type a symbol  → open its stock page (your watchlist and recent stocks
//                    first, then NSE/BSE search)
//   type a name    → jump to any tab, screener or delivery view
//   g then a key   → go to a tab without opening the bar (g w = Watchlist)
//   /              → open the bar
//   ?              → list every shortcut

function score(text, q) {
  if (!q) return 1;
  const t = text.toLowerCase();
  if (t === q) return 100;
  if (t.startsWith(q)) return 80;
  if (t.split(/[\s·/-]+/).some((w) => w.startsWith(q))) return 60;
  if (t.includes(q)) return 40;
  // in-order subsequence ("tlb" → "trendline breakout")
  let i = 0;
  for (const ch of t) if (ch === q[i]) i++;
  return i === q.length ? 15 : 0;
}

const isTyping = (el) =>
  el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);

const TICKER_RE = /^[A-Z0-9&-]{2,20}$/;

export default function CommandPalette() {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [help, setHelp] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [remote, setRemote] = useState({ q: "", items: [] });
  const [local, setLocal] = useState({ recent: [], watchlist: [] });
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const gPending = useRef(0);

  const show = useCallback((asHelp = false) => {
    setLocal({ recent: loadRecentSymbols(), watchlist: loadWatchlist() || [] });
    setQuery("");
    setActive(0);
    setHelp(asHelp);
    setOpen(true);
  }, []);
  const hide = useCallback(() => setOpen(false), []);

  // Global keys.
  useEffect(() => {
    if (pathname === "/login") return;
    function onKey(e) {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        if (open) hide();
        else show();
        return;
      }
      if (open || mod || e.altKey || isTyping(document.activeElement)) return;
      if (e.key === "/") {
        e.preventDefault();
        show();
      } else if (e.key === "?") {
        e.preventDefault();
        show(true);
      } else if (e.key === "g") {
        gPending.current = Date.now();
      } else if (gPending.current && Date.now() - gPending.current < 1200) {
        gPending.current = 0;
        const tab = TABS.find((t) => t.key === e.key.toLowerCase());
        if (tab) {
          e.preventDefault();
          router.push(tabHref(tab.id));
        }
      }
    }
    const onOpen = () => show();
    window.addEventListener("keydown", onKey);
    window.addEventListener(PALETTE_EVENT, onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(PALETTE_EVENT, onOpen);
    };
  }, [open, show, hide, router, pathname]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // NSE/BSE symbol search, debounced. Results are keyed by the query they
  // answer, so a slow response for an older query is simply ignored.
  const q = query.trim();
  useEffect(() => {
    if (!open || q.length < 2) return;
    const handle = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
        const data = await res.json();
        setRemote({ q, items: data.results || [] });
      } catch {
        setRemote({ q, items: [] });
      }
    }, 180);
    return () => clearTimeout(handle);
  }, [q, open]);

  const goStock = useCallback(
    (sym) => router.push(`/stock/${encodeURIComponent(sym)}`),
    [router]
  );

  const items = useMemo(() => {
    const lq = q.toLowerCase();
    const out = [];
    const seen = new Set();
    const addSym = (sym, hint, group, rank = 0) => {
      if (seen.has(sym)) return;
      const s = q ? score(sym, lq) : 1;
      if (!s) return;
      seen.add(sym);
      out.push({ id: `s:${sym}`, group, label: sym, hint, score: s + rank, run: () => goStock(sym) });
    };

    if (!q) {
      local.recent.forEach((s) => addSym(s, "Recently opened", "Recent"));
    } else {
      local.watchlist.forEach((s) => addSym(s, "In your watchlist", "Stocks", 5));
      local.recent.forEach((s) => addSym(s, "Recently opened", "Stocks", 3));
      if (remote.q === q) {
        remote.items.forEach((r) => {
          if (seen.has(r.symbol)) return;
          seen.add(r.symbol);
          out.push({
            id: `r:${r.symbol}:${r.exchange}`,
            group: "Stocks",
            label: r.symbol,
            hint: `${r.name}${r.exchange === "BSE" ? " · BSE" : ""}`,
            score: 30,
            run: () => goStock(r.symbol),
          });
        });
      }
      const upper = q.toUpperCase();
      if (TICKER_RE.test(upper) && !seen.has(upper)) {
        out.push({ id: `o:${upper}`, group: "Stocks", label: upper, hint: "Open stock page", score: 10, run: () => goStock(upper) });
      }
    }

    TABS.forEach((t) => {
      const s = Math.max(score(t.label, lq), t.keywords ? score(t.keywords, lq) * 0.6 : 0);
      if (!q || s)
        out.push({
          id: `t:${t.id}`,
          group: "Go to",
          label: t.label,
          hint: `g ${t.key}`,
          score: s,
          run: () => router.push(tabHref(t.id)),
        });
    });

    if (q) {
      SUB_VIEWS.forEach((sv) => {
        const s = Math.max(score(sv.label, lq), score(`${sv.group} ${sv.label}`, lq) * 0.7);
        if (s)
          out.push({
            id: `v:${sv.tab}:${sv.view}:${sv.archiveView || ""}`,
            group: sv.group.startsWith("Screeners") ? "Screeners" : sv.group,
            label: sv.label,
            hint: sv.group,
            score: s,
            run: () => {
              presetSubView(sv);
              router.push(tabHref(sv.tab));
            },
          });
      });
    }

    const actions = [
      { id: "a:help", label: "Keyboard shortcuts", hint: "?", run: () => setHelp(true), keep: true },
      { id: "a:reload", label: "Reload data", hint: "Refresh this page", run: () => window.location.reload() },
      {
        id: "a:logout",
        label: "Sign out",
        hint: "End this session",
        run: async () => {
          try {
            await fetch("/api/logout", { method: "POST" });
          } finally {
            try {
              for (const k of ["panel:watchlist", "panel:watchlist-meta", "panel:holdings"]) window.localStorage.removeItem(k);
            } catch {
              /* storage blocked */
            }
            window.location.href = "/login";
          }
        },
      },
    ];
    actions.forEach((a) => {
      const s = score(a.label, lq);
      if (!q || s) out.push({ ...a, group: "Actions", score: s });
    });

    // With no query, groups keep a fixed order. While typing, the group
    // holding the best match comes first ("pocket" → the Pocket pivot
    // screener, not a stock literally called POCKET); items inside a group
    // sort by match quality.
    const ORDER = ["Recent", "Stocks", "Go to", "Screeners", "Delivery", "Actions"];
    const best = {};
    out.forEach((it) => {
      best[it.group] = Math.max(best[it.group] ?? 0, it.score);
    });
    const groupRank = (g) => (q ? -best[g] * 10 + ORDER.indexOf(g) : ORDER.indexOf(g));
    return out
      .map((it, i) => ({ ...it, i }))
      .sort((a, b) => groupRank(a.group) - groupRank(b.group) || (q ? b.score - a.score : 0) || a.i - b.i)
      .slice(0, 40);
  }, [q, local, remote, router, goStock]);

  const sel = Math.min(active, Math.max(0, items.length - 1));

  function runItem(it) {
    if (!it) return;
    if (!it.keep) hide();
    it.run();
  }

  function onInputKey(e) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((sel + 1) % Math.max(1, items.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((sel - 1 + items.length) % Math.max(1, items.length));
    } else if (e.key === "Enter") {
      e.preventDefault();
      runItem(items[sel]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      if (help) setHelp(false);
      else hide();
    }
  }

  useEffect(() => {
    listRef.current?.querySelector(`[data-idx="${sel}"]`)?.scrollIntoView({ block: "nearest" });
  }, [sel]);

  if (!open) return null;

  const searching = q.length >= 2 && remote.q !== q;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center px-4 pt-[12vh]"
      style={{ background: "rgba(4, 6, 12, 0.66)", backdropFilter: "blur(3px)" }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) hide();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command bar"
        className="w-full max-w-xl rounded-[var(--radius)] border shadow-2xl overflow-hidden"
        style={{ borderColor: "var(--border-strong)", background: "var(--surface)" }}
      >
        <div className="flex items-center gap-2 px-4 border-b" style={{ borderColor: "var(--border)" }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-faint)" strokeWidth="2" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
              setHelp(false);
            }}
            onKeyDown={onInputKey}
            placeholder="Search a stock, tab, screener or action…"
            className="flex-1 bg-transparent py-3.5 text-[15px] outline-none focus-visible:outline-none"
            style={{ color: "var(--text)" }}
            role="combobox"
            aria-expanded="true"
            aria-controls="cmdk-list"
            aria-activedescendant={items[sel] ? `cmdk-${sel}` : undefined}
            autoComplete="off"
            spellCheck={false}
          />
          {searching && <span className="skeleton block" style={{ width: 14, height: 14, borderRadius: 999 }} />}
          <kbd>esc</kbd>
        </div>

        {help ? (
          <ShortcutHelp />
        ) : (
          <div id="cmdk-list" ref={listRef} role="listbox" className="max-h-[56vh] overflow-auto py-1">
            {items.length === 0 && (
              <p className="px-4 py-6 text-sm text-center" style={{ color: "var(--text-muted)" }}>
                {searching ? "Searching…" : "No matches. Try a ticker like RELIANCE."}
              </p>
            )}
            {items.map((it, idx) => {
              const header = it.group !== items[idx - 1]?.group ? it.group : null;
              const isSel = idx === sel;
              return (
                <div key={it.id}>
                  {header && (
                    <div className="px-4 pt-2.5 pb-1 text-[10px] uppercase tracking-wider" style={{ color: "var(--text-faint)" }}>
                      {header}
                    </div>
                  )}
                  <div
                    id={`cmdk-${idx}`}
                    data-idx={idx}
                    role="option"
                    aria-selected={isSel}
                    onMouseMove={() => idx !== sel && setActive(idx)}
                    onClick={() => runItem(it)}
                    className="mx-1 px-3 py-2 rounded-[var(--radius-sm)] flex items-center justify-between gap-3 cursor-pointer"
                    style={{
                      background: isSel ? "var(--surface-3)" : "transparent",
                      boxShadow: isSel ? "inset 2px 0 0 var(--accent)" : "none",
                    }}
                  >
                    <span className="min-w-0 flex items-baseline gap-2">
                      <span
                        className={`text-sm ${it.group === "Stocks" || it.group === "Recent" ? "font-mono font-medium" : ""}`}
                        style={{ color: "var(--text)" }}
                      >
                        {it.label}
                      </span>
                      {it.hint && it.group !== "Go to" && (
                        <span className="text-xs truncate" style={{ color: "var(--text-faint)" }}>
                          {it.hint}
                        </span>
                      )}
                    </span>
                    {it.group === "Go to" ? (
                      <span className="flex gap-1 shrink-0">
                        {it.hint.split(" ").map((k) => (
                          <kbd key={k}>{k}</kbd>
                        ))}
                      </span>
                    ) : isSel ? (
                      <kbd>↵</kbd>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div
          className="flex items-center gap-3 px-4 py-2 border-t text-[11px]"
          style={{ borderColor: "var(--border)", color: "var(--text-faint)" }}
        >
          <span className="flex items-center gap-1"><kbd>↑</kbd><kbd>↓</kbd> move</span>
          <span className="flex items-center gap-1"><kbd>↵</kbd> open</span>
          <span className="flex items-center gap-1 ml-auto"><kbd>?</kbd> shortcuts</span>
        </div>
      </div>
    </div>
  );
}

function ShortcutHelp() {
  const rows = [
    [["⌘", "K"], "Open / close this bar (Ctrl+K on Windows)"],
    [["/"], "Open this bar"],
    [["?"], "Show these shortcuts"],
    [["esc"], "Close"],
    ...TABS.map((t) => [["g", t.key], `Go to ${t.label}`]),
  ];
  return (
    <div className="max-h-[56vh] overflow-auto px-4 py-3">
      <div className="grid gap-1.5">
        {rows.map(([keys, label]) => (
          <div key={label} className="flex items-center justify-between gap-3 text-sm">
            <span style={{ color: "var(--text-muted)" }}>{label}</span>
            <span className="flex gap-1">
              {keys.map((k) => (
                <kbd key={k}>{k}</kbd>
              ))}
            </span>
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs" style={{ color: "var(--text-faint)" }}>
        Shortcuts are ignored while you&apos;re typing in a field. Tables also have Columns and Export menus in their
        top-right corner.
      </p>
    </div>
  );
}
