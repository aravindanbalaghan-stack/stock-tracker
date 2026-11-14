"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { downloadTable } from "@/lib/tabularFile";

// The one wrapper every data table in Panel sits in.
//
// It works on the rendered <table> rather than asking each screen to
// describe its columns, so the ~25 existing tables (each with its own
// cells, badges and links) get the same toolkit without being rewritten:
//
//   • sticky header + row hover (CSS: .tf-scroll)
//   • row count
//   • column chooser — hide/show columns, remembered per table on this
//     device (that's the "saved view")
//   • density toggle — comfortable / compact, remembered too
//   • export exactly what's on screen (visible columns, current sort and
//     filters) to Excel or CSV
//   • phone layout — each row turns into a card with label/value lines
//
// Columns are identified by their header text, so a hidden "Turnover"
// stays hidden even if a screen adds or reorders columns later.

const PREF_PREFIX = "panel:table:";
const DEFAULT_PREFS = { hidden: [], density: "comfortable", phone: "cards" };

function readPrefs(name) {
  try {
    const raw = window.localStorage.getItem(PREF_PREFIX + name);
    if (!raw) return DEFAULT_PREFS;
    const p = JSON.parse(raw);
    return { ...DEFAULT_PREFS, ...(p && typeof p === "object" ? p : {}) };
  } catch {
    return DEFAULT_PREFS;
  }
}

function headerLabel(th, i) {
  const fromAttr = th.getAttribute("data-col");
  if (fromAttr) return fromAttr.trim();
  const text = (th.textContent || "").replace(/[▲▼↑↓⇅ⓘ]/g, "").replace(/\s+/g, " ").trim();
  // Header-less columns (Remove / Add buttons) stay unnamed: they're left
  // out of the chooser, the export, and the phone labels.
  return text;
}

// What a cell "says": a dropdown's chosen option, an input's value, or the
// first visible line of text (the headline figure — sub-lines like a
// company name under the ticker or an "EOD" tag are left out).
function cellText(td) {
  const sel = td.querySelector("select");
  if (sel) return sel.options[sel.selectedIndex]?.text ?? "";
  const input = td.querySelector("input:not([type=checkbox]), textarea");
  if (input) return input.value;
  const lines = (td.innerText || td.textContent || "").split("\n").map((l) => l.trim()).filter(Boolean);
  return lines[0] ?? "";
}

function cellValue(text) {
  const s = (text || "").replace(/\s+/g, " ").trim();
  if (s === "" || s === "—") return null;
  const bare = s.replace(/[₹,%×+\s]/g, "");
  if (/^-?\d+(\.\d+)?$/.test(bare) && !/[A-Za-z]/.test(s)) return Number(bare);
  return s;
}

// Reads the table off the page and tags the cells the CSS needs.
function scan(table) {
  const headRow = table.querySelector("thead tr:last-child");
  const ths = headRow ? Array.from(headRow.children) : [];
  const labels = ths.map(headerLabel);
  let rows = 0;
  for (const tr of table.querySelectorAll("tbody > tr")) {
    const cells = Array.from(tr.children);
    const spans = cells.some((c) => (c.colSpan || 1) > 1) || cells.length !== labels.length;
    if (spans) {
      if (!tr.hasAttribute("data-tf-span")) tr.setAttribute("data-tf-span", "");
      continue;
    }
    if (tr.hasAttribute("data-tf-span")) tr.removeAttribute("data-tf-span");
    rows++;
    cells.forEach((td, i) => {
      const l = labels[i] ?? "";
      if (td.getAttribute("data-label") !== l) td.setAttribute("data-label", l);
    });
  }
  return { labels, rows };
}

export default function TableFrame({ name, children, className = "", style, tools = true, exportName }) {
  const reactId = useId();
  const frameId = `tf${reactId.replace(/[^a-zA-Z0-9]/g, "")}`;
  const scrollRef = useRef(null);
  const [info, setInfo] = useState({ labels: [], rows: 0 });
  const [prefs, setPrefs] = useState(DEFAULT_PREFS);
  const [prefsLoaded, setPrefsLoaded] = useState(false);
  // { kind: "cols" | "export", top, right } — fixed-positioned so a card's
  // overflow-hidden can't clip it on short tables.
  const [menu, setMenu] = useState(null);
  const menuRef = useRef(null);

  // Saved view loads after mount, so server and first client render match.
  useEffect(() => {
    let live = true;
    Promise.resolve().then(() => {
      if (!live) return;
      setPrefs(readPrefs(name));
      setPrefsLoaded(true);
    });
    return () => {
      live = false;
    };
  }, [name]);

  useEffect(() => {
    if (!prefsLoaded) return;
    try {
      window.localStorage.setItem(PREF_PREFIX + name, JSON.stringify(prefs));
    } catch {
      /* storage blocked — the view just won't be remembered */
    }
  }, [name, prefs, prefsLoaded]);

  // Keep labels/row count in step with whatever React renders into the table.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let frame = 0;
    const run = () => {
      frame = 0;
      const table = el.querySelector("table");
      if (!table) return;
      const next = scan(table);
      setInfo((prev) =>
        prev.rows === next.rows && prev.labels.join("\u0001") === next.labels.join("\u0001") ? prev : next
      );
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(run);
    };
    schedule();
    const obs = new MutationObserver(schedule);
    obs.observe(el, { childList: true, subtree: true, characterData: true });
    return () => {
      obs.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  // Close menus on outside click / Escape.
  useEffect(() => {
    if (!menu) return;
    const close = (e) => {
      // Scrolling inside the menu itself shouldn't close it.
      if (e?.type === "scroll" && menuRef.current?.contains(e.target)) return;
      setMenu(null);
    };
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    const onDown = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenu(null);
    };
    const onKey = (e) => {
      if (e.key === "Escape") setMenu(null);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [menu]);

  const hiddenIdx = useMemo(
    () =>
      info.labels
        .map((l, i) => (i > 0 && l && prefs.hidden.includes(l) ? i : -1))
        .filter((i) => i >= 0),
    [info.labels, prefs.hidden]
  );

  const hideCss = hiddenIdx
    .map(
      (i) =>
        `#${frameId} thead tr:last-child > :nth-child(${i + 1}),#${frameId} tbody tr:not([data-tf-span]) > :nth-child(${i + 1}){display:none}`
    )
    .join("");

  function openMenu(kind) {
    if (menu?.kind === kind) return setMenu(null);
    const r = menuRef.current?.getBoundingClientRect();
    setMenu({ kind, top: r ? r.bottom + 4 : 80, right: r ? Math.max(8, window.innerWidth - r.right + 8) : 8 });
  }

  function toggleCol(label) {
    setPrefs((p) => ({
      ...p,
      hidden: p.hidden.includes(label) ? p.hidden.filter((h) => h !== label) : [...p.hidden, label],
    }));
  }

  async function doExport(format) {
    setMenu(null);
    const table = scrollRef.current?.querySelector("table");
    if (!table) return;
    const keep = info.labels.map((l, i) => !hiddenIdx.includes(i) && (i === 0 || !!l));
    const used = new Map();
    const columns = info.labels
      .map((l, i) => {
        if (!keep[i]) return null;
        let name = l || (i === 0 ? "Symbol" : `Col ${i + 1}`);
        const n = used.get(name) || 0;
        used.set(name, n + 1);
        return n ? `${name} (${n + 1})` : name;
      })
      .filter(Boolean);
    const rows = [];
    for (const tr of table.querySelectorAll("tbody > tr")) {
      if (tr.hasAttribute("data-tf-span")) continue;
      const cells = Array.from(tr.children).filter((_, i) => keep[i]);
      const row = {};
      cells.forEach((td, i) => {
        row[columns[i]] = cellValue(cellText(td));
      });
      rows.push(row);
    }
    const stamp = new Date().toISOString().slice(0, 10);
    await downloadTable(rows, columns, {
      format,
      baseName: `panel-${exportName || name}-${stamp}`,
      sheetName: (exportName || name).slice(0, 31),
    });
  }

  const frameClass = [
    prefs.density === "compact" ? "tf-compact" : "",
    prefs.phone === "cards" ? "tf-cards" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  const btn =
    "inline-flex items-center gap-1 px-2 py-1 rounded-[4px] text-[11px] font-medium transition-colors hover:bg-[var(--surface-3)]";
  const choosable = info.labels.map((l, i) => ({ l, i })).filter(({ l, i }) => i > 0 && l);

  return (
    <div id={frameId} className={frameClass}>
      {hideCss && <style>{hideCss}</style>}
      {tools && (
        <div
          ref={menuRef}
          className="relative flex items-center justify-between gap-2 px-2 py-1 border-b"
          style={{ borderColor: "var(--border)", background: "var(--surface)" }}
        >
          <span className="text-[11px] pl-1" style={{ color: "var(--text-faint)" }}>
            {info.rows.toLocaleString("en-IN")} {info.rows === 1 ? "row" : "rows"}
            {hiddenIdx.length > 0 && ` · ${hiddenIdx.length} column${hiddenIdx.length > 1 ? "s" : ""} hidden`}
          </span>
          <div className="flex items-center gap-0.5" style={{ color: "var(--text-muted)" }}>
            <button
              type="button"
              className={btn}
              title="Row density"
              onClick={() => setPrefs((p) => ({ ...p, density: p.density === "compact" ? "comfortable" : "compact" }))}
            >
              {prefs.density === "compact" ? "Compact" : "Comfortable"}
            </button>
            <button
              type="button"
              className={btn}
              aria-expanded={menu?.kind === "cols"}
              onClick={() => openMenu("cols")}
            >
              Columns ▾
            </button>
            <button
              type="button"
              className={btn}
              aria-expanded={menu?.kind === "export"}
              onClick={() => openMenu("export")}
            >
              Export ▾
            </button>
          </div>

          {menu && (
            <div
              className="fixed z-50 min-w-[200px] max-h-[60vh] overflow-auto rounded-[var(--radius-sm)] border shadow-2xl p-1"
              style={{ top: menu.top, right: menu.right, borderColor: "var(--border-strong)", background: "var(--surface-2)" }}
            >
              {menu.kind === "cols" ? (
                <>
                  <div className="px-2 py-1 text-[10px] uppercase tracking-wider" style={{ color: "var(--text-faint)" }}>
                    Show columns
                  </div>
                  {choosable.map(({ l }) => (
                    <label
                      key={l}
                      className="flex items-center gap-2 px-2 py-1 rounded cursor-pointer text-xs hover:bg-[var(--surface-3)]"
                      style={{ color: "var(--text)" }}
                    >
                      <input type="checkbox" checked={!prefs.hidden.includes(l)} onChange={() => toggleCol(l)} />
                      {l}
                    </label>
                  ))}
                  <div className="border-t my-1" style={{ borderColor: "var(--border)" }} />
                  <label
                    className="flex items-center gap-2 px-2 py-1 rounded cursor-pointer text-xs hover:bg-[var(--surface-3)]"
                    style={{ color: "var(--text)" }}
                  >
                    <input
                      type="checkbox"
                      checked={prefs.phone === "cards"}
                      onChange={() => setPrefs((p) => ({ ...p, phone: p.phone === "cards" ? "table" : "cards" }))}
                    />
                    Card layout on phones
                  </label>
                  {prefs.hidden.length > 0 && (
                    <button
                      type="button"
                      className="w-full text-left px-2 py-1 rounded text-xs hover:bg-[var(--surface-3)]"
                      style={{ color: "var(--accent)" }}
                      onClick={() => setPrefs((p) => ({ ...p, hidden: [] }))}
                    >
                      Show all columns
                    </button>
                  )}
                </>
              ) : (
                <>
                  <div className="px-2 py-1 text-[10px] uppercase tracking-wider" style={{ color: "var(--text-faint)" }}>
                    Export what&apos;s on screen
                  </div>
                  {[
                    ["xlsx", "Excel (.xlsx)"],
                    ["csv", "CSV"],
                  ].map(([f, label]) => (
                    <button
                      key={f}
                      type="button"
                      className="w-full text-left px-2 py-1.5 rounded text-xs hover:bg-[var(--surface-3)]"
                      style={{ color: "var(--text)" }}
                      onClick={() => doExport(f)}
                    >
                      {label}
                    </button>
                  ))}
                </>
              )}
            </div>
          )}
        </div>
      )}
      <div ref={scrollRef} className="tf-scroll" style={style}>
        {children}
      </div>
    </div>
  );
}
