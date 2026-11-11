"use client";

// Analysis — the daily market-analysis journal. One page per trading day:
// before the open (bias, levels, focus, ideas, routine checklist) and after
// the close (review). Panel grades it against what prices did next, keeps a
// scorecard, and exports everything for an AI review. Server side:
// lib/analysis.js; scoring: lib/analysisStats.js.

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { ScreenHeader, SectionTitle, Panel, ErrorState, LoadingState, SubNav } from "@/components/ui/Chrome";
import StockStudies from "@/components/StockStudies";
import { usePersistentState } from "@/lib/usePersistentState";
import SymbolLink from "@/components/SymbolLink";
import { parseQuickNote } from "@/lib/quickNote";
import { EMOTIONS } from "@/lib/journalStats";
import { scorecard, insights, dayRows, ideaRows, studyRows, DAY_COLUMNS, IDEA_COLUMNS, STUDY_COLUMNS, aiReviewPack, ideaWon } from "@/lib/analysisStats";
import { downloadTable, downloadText, parseTableFile } from "@/lib/tabularFile";
import { isNonTradingDate } from "@/lib/marketHours";

const todayIST = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
const INDEXES = [
  { id: "nifty", label: "NIFTY 50" },
  { id: "bankNifty", label: "BANK NIFTY" },
];
const BIASES = ["Bullish", "Neutral", "Bearish"];
const BIAS_TONE = { Bullish: "var(--gain)", Bearish: "var(--loss)", Neutral: "var(--accent)" };
const OUTCOME_TONE = {
  "Target hit": ["var(--gain)", "var(--gain-dim)"],
  "Stop hit": ["var(--loss)", "var(--loss-dim)"],
  Open: ["var(--accent)", "var(--surface-2)"],
  Waiting: ["var(--text-muted)", "var(--surface-2)"],
  "Not triggered": ["var(--text-faint)", "var(--surface-2)"],
  "Time exit": ["var(--tier-low)", "var(--tier-low-dim)"],
};
const field = { background: "var(--surface-2)", borderColor: "var(--border)", color: "var(--text)" };
const inputCls = "rounded px-2 py-1.5 text-sm outline-none border w-full";
const fmt = (n, d = 2) => (n == null || n === "" || Number.isNaN(Number(n)) ? "—" : Number(n).toLocaleString("en-IN", { maximumFractionDigits: d }));
const signed = (n) => (n == null ? "—" : `${n >= 0 ? "+" : ""}${n}%`);

function blankEntry(date, checklist) {
  return {
    date,
    bias: { nifty: "", bankNifty: "" },
    confidence: 3,
    levels: { nifty: { support: "", resistance: "" }, bankNifty: { support: "", resistance: "" } },
    context: "",
    sectorsInFocus: [],
    themesInFocus: [],
    events: "",
    ideas: [],
    studies: [],
    checklist: Object.fromEntries(checklist.map((c) => [c, false])),
    review: "",
    worked: "",
    missed: "",
    lessons: "",
    mood: [],
    rating: null,
    snapshot: null,
  };
}

function shiftTradingDay(date, dir) {
  const d = new Date(`${date}T00:00:00Z`);
  for (let i = 0; i < 10; i++) {
    d.setUTCDate(d.getUTCDate() + dir);
    const iso = d.toISOString().slice(0, 10);
    if (!isNonTradingDate(iso)) return iso;
  }
  return date;
}

function L({ label, children, className = "" }) {
  return (
    <label className={`flex flex-col gap-1 ${className}`}>
      <span className="text-[10px] uppercase tracking-wider" style={{ color: "var(--text-faint)" }}>
        {label}
      </span>
      {children}
    </label>
  );
}

function Chips({ options, value, onChange, tone = "var(--accent)" }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const on = value.includes(o);
        return (
          <button
            key={o}
            type="button"
            onClick={() => onChange(on ? value.filter((v) => v !== o) : [...value, o])}
            className="text-[11px] px-2 py-0.5 rounded-full border"
            style={on ? { borderColor: tone, color: tone, background: "var(--surface-3)" } : { borderColor: "var(--border)", color: "var(--text-muted)" }}
          >
            {o}
          </button>
        );
      })}
    </div>
  );
}

function Outcome({ o }) {
  if (!o) return <span className="text-[11px]" style={{ color: "var(--text-faint)" }}>save to grade</span>;
  const [c, bg] = OUTCOME_TONE[o.status] ?? ["var(--text-muted)", "var(--surface-2)"];
  return (
    <span className="text-[11px] px-1.5 py-0.5 rounded whitespace-nowrap" style={{ color: c, background: bg }} title={o.note ?? (o.exitDate ? `${o.exitDate}` : "")}>
      {o.status}
      {o.returnPct != null ? ` ${signed(o.returnPct)}` : ""}
      {o.r != null && o.status !== "Waiting" ? ` · ${o.r}R` : ""}
    </span>
  );
}

// ---------------------------------------------------------------------

function Scorecard({ s, notes, entries, onPick }) {
  const cell = (label, value, sub, color) => (
    <div className="rounded-[var(--radius)] border p-3" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
      <p className="text-[10px] uppercase tracking-wide" style={{ color: "var(--text-faint)" }}>
        {label}
      </p>
      <p className="font-mono text-lg mt-0.5" style={{ color: color ?? "var(--text)" }}>
        {value}
      </p>
      {sub && (
        <p className="text-[10px] mt-0.5" style={{ color: "var(--text-faint)" }}>
          {sub}
        </p>
      )}
    </div>
  );
  const acc = (v) => (v == null ? undefined : v >= 55 ? "var(--gain)" : v < 45 ? "var(--loss)" : "var(--accent)");

  // 12-week heatmap: green = bias right next day, red = wrong, grey = written but not graded yet.
  const byDate = new Map(entries.map((e) => [e.date, e]));
  const cols = [];
  const start = new Date();
  start.setDate(start.getDate() - 7 * 11 - ((start.getDay() + 6) % 7));
  for (let w = 0; w < 12; w++) {
    const col = [];
    for (let d = 0; d < 5; d++) {
      const x = new Date(start);
      x.setDate(start.getDate() + w * 7 + d);
      const iso = x.toISOString().slice(0, 10);
      const e = byDate.get(iso);
      const g = e?.biasGrade?.nifty;
      col.push({ iso, e, color: !e ? "var(--surface-2)" : g?.correct1 === true ? "var(--gain)" : g?.correct1 === false ? "var(--loss)" : "var(--accent-dim)" });
    }
    cols.push(col);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-2">
        {cell("NIFTY bias", s.bias.nifty.accuracyNextDay != null ? `${s.bias.nifty.accuracyNextDay}%` : "—", `right next session · ${s.bias.nifty.calls} calls`, acc(s.bias.nifty.accuracyNextDay))}
        {cell("BANK NIFTY bias", s.bias.bankNifty.accuracyNextDay != null ? `${s.bias.bankNifty.accuracyNextDay}%` : "—", `right next session · ${s.bias.bankNifty.calls} calls`, acc(s.bias.bankNifty.accuracyNextDay))}
        {cell("Idea win rate", s.ideas.winRate != null ? `${s.ideas.winRate}%` : "—", `target before stop · ${s.ideas.resolved} resolved`, acc(s.ideas.winRate))}
        {cell("Avg idea", s.ideas.avgReturnPct != null ? signed(s.ideas.avgReturnPct) : "—", s.ideas.avgR != null ? `${s.ideas.avgR}R · ${s.ideas.open} open` : `${s.ideas.open} open`, s.ideas.avgReturnPct >= 0 ? "var(--gain)" : "var(--loss)")}
        {cell("Triggered", s.ideas.triggerRate != null ? `${s.ideas.triggerRate}%` : "—", `${s.ideas.triggered} of ${s.ideas.total} ideas`)}
        {cell(
          "Stock studies",
          s.studies.accuracy != null ? `${s.studies.accuracy}%` : `${s.studies.total}`,
          s.studies.accuracy != null ? `verdicts right · ${s.studies.graded} graded` : `studies on ${s.studies.stocks} stocks`,
          acc(s.studies.accuracy)
        )}
        {cell("Consistency", `${s.streak} day streak`, `${s.last30Days} entries in 30 days${s.avgRating ? ` · rating ${s.avgRating}/5` : ""}`)}
      </div>

      <div className="grid gap-3 lg:grid-cols-[auto_1fr]">
        <Panel>
          <p className="text-[11px] font-semibold mb-2" style={{ color: "var(--text-muted)" }}>
            Last 12 weeks <span className="font-normal" style={{ color: "var(--text-faint)" }}>· NIFTY call right / wrong</span>
          </p>
          <div className="flex gap-1">
            {cols.map((col, i) => (
              <div key={i} className="flex flex-col gap-1">
                {col.map((c) => (
                  <button
                    key={c.iso}
                    type="button"
                    onClick={() => onPick(c.iso)}
                    className="w-3.5 h-3.5 rounded-sm"
                    style={{ background: c.color }}
                    title={`${c.iso}${c.e ? ` · ${c.e.bias?.nifty || "no bias"}${c.e.biasGrade?.nifty?.move1 != null ? ` · next ${c.e.biasGrade.nifty.move1}%` : ""}` : " · no entry"}`}
                  />
                ))}
              </div>
            ))}
          </div>
        </Panel>
        <Panel>
          {notes.length ? (
            <ul className="flex flex-col gap-1.5">
              {notes.map((n, i) => (
                <li key={i} className="text-xs flex gap-2">
                  <span style={{ color: n.tone === "good" ? "var(--gain)" : n.tone === "bad" ? "var(--loss)" : "var(--text-faint)" }}>
                    {n.tone === "good" ? "▲" : n.tone === "bad" ? "▼" : "•"}
                  </span>
                  <span style={{ color: "var(--text-muted)" }}>{n.text}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs" style={{ color: "var(--text-faint)" }}>
              Observations appear once a few days are graded. Bias calls are checked against the index&apos;s next session; ideas against
              whether target or stop came first.
            </p>
          )}
        </Panel>
      </div>
    </div>
  );
}

function Snapshot({ snap }) {
  if (!snap) return <LoadingState>Loading the market snapshot…</LoadingState>;
  if (!snap.available) return <p className="text-xs" style={{ color: "var(--text-faint)" }}>No NSE data for this day.</p>;
  const b = snap.breadth;
  return (
    <div className="grid gap-3 md:grid-cols-3">
      <div>
        <p className="text-[10px] uppercase tracking-wide mb-1" style={{ color: "var(--text-faint)" }}>
          Indices · {snap.date}
        </p>
        {snap.indexes.map((x) => (
          <p key={x.id} className="text-xs flex justify-between gap-2 font-mono">
            <span style={{ color: "var(--text-muted)" }}>{x.label}</span>
            <span style={{ color: "var(--text)" }}>
              {fmt(x.close)} <span style={{ color: x.change >= 0 ? "var(--gain)" : "var(--loss)" }}>{signed(x.change)}</span>
            </span>
          </p>
        ))}
        <p className="text-xs mt-1.5" style={{ color: "var(--text-muted)" }}>
          Breadth: <span style={{ color: "var(--gain)" }}>{b.advances}↑</span> / <span style={{ color: "var(--loss)" }}>{b.declines}↓</span> (A/D {b.ratio ?? "—"}) · 20-day highs {b.new20dHighs}, lows {b.new20dLows}
        </p>
      </div>
      <div>
        <p className="text-[10px] uppercase tracking-wide mb-1" style={{ color: "var(--text-faint)" }}>
          Sectors — best / worst
        </p>
        {snap.topSectors.map((x) => (
          <p key={x.name} className="text-xs flex justify-between gap-2">
            <span style={{ color: "var(--text-muted)" }}>{x.name}</span>
            <span className="font-mono" style={{ color: "var(--gain)" }}>{signed(x.change)}</span>
          </p>
        ))}
        {snap.bottomSectors.slice(0, 3).map((x) => (
          <p key={x.name} className="text-xs flex justify-between gap-2">
            <span style={{ color: "var(--text-muted)" }}>{x.name}</span>
            <span className="font-mono" style={{ color: "var(--loss)" }}>{signed(x.change)}</span>
          </p>
        ))}
      </div>
      <div>
        <p className="text-[10px] uppercase tracking-wide mb-1" style={{ color: "var(--text-faint)" }}>
          Themes — best / worst
        </p>
        {snap.topThemes.length === 0 && (
          <p className="text-xs" style={{ color: "var(--text-faint)" }}>
            Tag themes on the Sectors tab to see them here.
          </p>
        )}
        {snap.topThemes.map((x) => (
          <p key={x.name} className="text-xs flex justify-between gap-2">
            <span style={{ color: "var(--text-muted)" }}>{x.name}</span>
            <span className="font-mono" style={{ color: "var(--gain)" }}>{signed(x.change)}</span>
          </p>
        ))}
        {snap.bottomThemes.slice(0, 3).map((x) => (
          <p key={x.name} className="text-xs flex justify-between gap-2">
            <span style={{ color: "var(--text-muted)" }}>{x.name}</span>
            <span className="font-mono" style={{ color: "var(--loss)" }}>{signed(x.change)}</span>
          </p>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------

export default function AnalysisTab({ onAddToWatchlist, watchlistSymbols = [] }) {
  const [entries, setEntries] = useState(null);
  const [prefs, setPrefs] = useState({ checklist: [] });
  const [error, setError] = useState(null);
  const [date, setDateRaw] = useState(todayIST());
  const setDate = (d) => {
    setDateRaw(d);
    setMsg(null);
  };
  // Unsaved edits for one date. Switching date (or saving) drops them, and
  // the editor falls back to the saved — graded — version of that day.
  const [edit, setEdit] = useState({ date: null, draft: null });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);
  const [snap, setSnap] = useState({ date: null, data: null });
  const [lists, setLists] = useState({ sectors: [], themes: [] });
  const [events, setEvents] = useState({});
  const [quotes, setQuotes] = useState({});
  const [ideaText, setIdeaText] = useState("");
  const [editChecklist, setEditChecklist] = useState(false);
  const [view, setView] = usePersistentState("analysis.view", "day");
  const [studyId, setStudyId] = useState(null);
  const fileRef = useRef(null);

  const load = async () => {
    try {
      const res = await fetch("/api/analysis");
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error || "Couldn't load your analysis");
      setEntries(j.entries);
      setPrefs(j.prefs);
      return j;
    } catch (err) {
      setError(err.message);
      return null;
    }
  };

  useEffect(() => {
    // Deferred a tick so no state is set synchronously inside the effect.
    Promise.resolve().then(load);
    fetch("/api/sector-overrides")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => j && setLists((l) => ({ ...l, sectors: (j.sectors ?? []).map((s) => s.name) })))
      .catch(() => {});
    fetch("/api/stock-master?themes=1")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => j && setLists((l) => ({ ...l, themes: (j.themes ?? []).map((t) => t.name) })))
      .catch(() => {});
    fetch("/api/events")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => j && setEvents(j.bySymbol ?? {}))
      .catch(() => {});
  }, []);

  const saved = entries?.find((e) => e.date === date) ?? null;
  const base = entries ? saved ?? blankEntry(date, prefs.checklist) : null;
  const draft = edit.date === date ? edit.draft : base;
  const dirty = edit.date === date;
  const resetEdits = () => setEdit({ date: null, draft: null });

  // Market snapshot for the day (saved snapshot first, else live).
  useEffect(() => {
    if (saved?.snapshot) return;
    let alive = true;
    fetch(`/api/analysis?snapshot=${date}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => alive && setSnap({ date, data: j }))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [date, saved?.snapshot]);
  const snapshot = saved?.snapshot ?? (snap.date === date ? snap.data : null);

  // Latest prices for the day's ideas.
  const ideaSymbols = (draft?.ideas ?? []).map((i) => i.symbol).filter(Boolean).join(",");
  useEffect(() => {
    if (!ideaSymbols) return;
    fetch(`/api/quote?symbols=${encodeURIComponent(ideaSymbols)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => j && setQuotes((q) => ({ ...q, ...Object.fromEntries((j.results ?? []).map((x) => [x.symbol, x])) })))
      .catch(() => {});
  }, [ideaSymbols]);

  const s = useMemo(() => (entries ? scorecard(entries, prefs.checklist) : null), [entries, prefs.checklist]);
  const notes = s ? insights(s) : [];

  const set = (path, value) => {
    setEdit((prev) => {
      const next = structuredClone(prev.date === date ? prev.draft : base);
      let o = next;
      for (let i = 0; i < path.length - 1; i++) o = o[path[i]] ??= {};
      o[path[path.length - 1]] = value;
      return { date, draft: next };
    });
  };

  async function save() {
    setSaving(true);
    setMsg(null);
    try {
      const entry = { ...draft, snapshot: draft.snapshot ?? snapshot ?? null };
      const res = await fetch("/api/analysis", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ entry }) });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error || "Couldn't save");
      await load();
      resetEdits(); // show the saved, graded version
      setMsg("Saved.");
    } catch (err) {
      setMsg(err.message);
    } finally {
      setSaving(false);
    }
  }

  // Ctrl/⌘+S saves.
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s" && dirty && !saving) {
        e.preventDefault();
        save();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  function addIdeaFromText() {
    const p = parseQuickNote(ideaText);
    const idea = {
      id: crypto.randomUUID(),
      symbol: p.symbol ?? "",
      direction: p.side === "Short" ? "Short" : "Long",
      setup: p.setup ?? "",
      timeframe: p.timeframe ?? "Swing (days)",
      entry: p.entryPrice ?? "",
      stop: p.stopLoss ?? "",
      target: p.target ?? "",
      horizonDays: 10,
      thesis: ideaText.trim(),
    };
    set(["ideas"], [...(draft.ideas ?? []), idea]);
    setIdeaText("");
  }

  function carryForward() {
    const prev = (entries ?? []).filter((e) => e.date < date).sort((a, b) => (a.date < b.date ? 1 : -1))[0];
    if (!prev) return setMsg("No earlier entry to carry ideas from.");
    const have = new Set(draft.ideas.map((i) => i.symbol));
    const live = prev.ideas.filter((i) => ["Waiting", "Open"].includes(i.outcome?.status) && !have.has(i.symbol));
    if (!live.length) return setMsg(`Nothing still open or waiting from ${prev.date}.`);
    set(
      ["ideas"],
      [...draft.ideas, ...live.map((i) => ({ ...i, id: crypto.randomUUID(), outcome: undefined, carriedFrom: i.carriedFrom || prev.date }))]
    );
    setMsg(`Carried ${live.length} idea${live.length === 1 ? "" : "s"} from ${prev.date}.`);
  }

  async function logTrade(idea) {
    const res = await fetch("/api/journal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        trade: {
          draft: true,
          symbol: idea.symbol,
          side: idea.direction,
          entryPrice: idea.entry || undefined,
          stopLoss: idea.stop || undefined,
          target: idea.target || undefined,
          setup: idea.setup,
          timeframe: idea.timeframe,
          entryDate: todayIST(),
          entryReason: idea.thesis,
          quickNotes: [{ text: `From my ${date} analysis: ${idea.thesis || `${idea.direction} ${idea.symbol}`}` }],
        },
      }),
    });
    setMsg(res.ok ? `Draft trade for ${idea.symbol} added to the Journal — complete it there.` : "Couldn't add it to the Journal.");
  }

  async function exportAs(kind) {
    const base = `panel-analysis-${todayIST()}`;
    if (kind === "ai") return downloadText(aiReviewPack(entries, s), `${base}-ai-review.md`, "text/markdown");
    if (kind === "csv-days") return downloadTable(dayRows(entries), DAY_COLUMNS, { format: "csv", baseName: `${base}-days` });
    if (kind === "csv-ideas") return downloadTable(ideaRows(entries), IDEA_COLUMNS, { format: "csv", baseName: `${base}-ideas` });
    if (kind === "csv-studies") return downloadTable(studyRows(entries), STUDY_COLUMNS, { format: "csv", baseName: `${base}-stock-studies` });
    if (kind === "json") return downloadText(JSON.stringify({ exportedAt: new Date().toISOString(), scorecard: s, entries }, null, 2), `${base}.json`, "application/json");
    await downloadTable(dayRows(entries), DAY_COLUMNS, {
      format: "xlsx",
      baseName: base,
      sheetName: "Days",
      extraSheets: [
        { name: "Ideas", rows: ideaRows(entries), columns: IDEA_COLUMNS },
        { name: "Stock studies", rows: studyRows(entries), columns: STUDY_COLUMNS },
        { name: "By setup", rows: s.bySetup, columns: ["key", "ideas", "resolved", "winRate", "avgReturnPct"] },
      ],
    });
  }

  async function onImport(file) {
    if (!file) return;
    try {
      let rows;
      if (file.name.toLowerCase().endsWith(".json")) {
        const j = JSON.parse(await file.text());
        rows = Array.isArray(j) ? j : j.entries;
      } else rows = (await parseTableFile(file)).rows;
      if (!Array.isArray(rows)) throw new Error("Use a Panel analysis JSON export");
      if (!window.confirm(`Import ${rows.length} day(s)? Days already saved with the same date are replaced.`)) return;
      const res = await fetch("/api/analysis", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ import: rows, mode: "merge" }) });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error || "Import failed");
      setMsg(`Imported ${j.imported} day(s).`);
      resetEdits();
      load();
    } catch (err) {
      setMsg(err.message);
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function saveChecklist(items) {
    const res = await fetch("/api/analysis", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prefs: { checklist: items } }) });
    const j = await res.json();
    if (res.ok) {
      setPrefs(j.prefs);
      set(["checklist"], Object.fromEntries(j.prefs.checklist.map((c) => [c, !!draft.checklist?.[c]])));
    }
    setEditChecklist(false);
  }

  const holiday = isNonTradingDate(date);
  const eventsToday = Object.entries(events)
    .filter(([sym]) => watchlistSymbols.includes(sym))
    .flatMap(([sym, list]) => list.filter((e) => e.date >= date && e.date <= shiftTradingDay(shiftTradingDay(date, 1), 1)).map((e) => `${sym}: ${e.type} (${e.date}) — ${e.title}`));
  const sel = { background: "var(--surface-2)", borderColor: "var(--border)", color: "var(--text)" };

  return (
    <div>
      <ScreenHeader
        title="Analysis"
        meta="Your daily market view, graded against what the market did next"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <select value="" onChange={(e) => e.target.value && exportAs(e.target.value)} className="rounded px-2 py-1 text-xs border" style={sel} disabled={!entries?.length}>
              <option value="">Export…</option>
              <option value="ai">AI review pack (.md)</option>
              <option value="xlsx">Excel (days, ideas, studies)</option>
              <option value="csv-days">CSV — days</option>
              <option value="csv-ideas">CSV — ideas</option>
              <option value="csv-studies">CSV — stock studies</option>
              <option value="json">JSON (full backup)</option>
            </select>
            <button type="button" onClick={() => fileRef.current?.click()} className="text-xs px-2.5 py-1 rounded border" style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}>
              Import
            </button>
            <input ref={fileRef} type="file" accept=".json" className="hidden" onChange={(e) => onImport(e.target.files?.[0])} />
          </div>
        }
      />

      {error && <ErrorState>{error}</ErrorState>}
      {!entries && !error && <LoadingState>Loading your analysis…</LoadingState>}

      {entries && draft && (
        <div className="flex flex-col gap-6">
          <Scorecard s={s} notes={notes} entries={entries} onPick={(d) => setDate(d)} />

          {/* Day navigation + save bar */}
          <div className="sticky top-0 z-10 -mx-1 px-1 py-2 flex flex-wrap items-center justify-between gap-2" style={{ background: "var(--bg)" }}>
            <div className="flex items-center gap-1.5 text-xs" style={{ color: "var(--text-faint)" }}>
              <button type="button" onClick={() => setDate(shiftTradingDay(date, -1))} className="px-2 py-1 rounded border" style={{ borderColor: "var(--border)", color: "var(--text-muted)" }} aria-label="Previous trading day">
                ←
              </button>
              <input type="date" value={date} max={todayIST()} onChange={(e) => e.target.value && setDate(e.target.value)} className="rounded px-2 py-1 text-sm border" style={{ ...sel, colorScheme: "dark" }} />
              <button type="button" onClick={() => setDate(shiftTradingDay(date, 1))} disabled={date >= todayIST()} className="px-2 py-1 rounded border disabled:opacity-30" style={{ borderColor: "var(--border)", color: "var(--text-muted)" }} aria-label="Next trading day">
                →
              </button>
              {date !== todayIST() && (
                <button type="button" onClick={() => setDate(todayIST())} className="px-2 py-1 rounded border" style={{ borderColor: "var(--border)", color: "var(--accent)" }}>
                  Today
                </button>
              )}
              <span className="ml-1">
                {saved ? `Saved ${new Date(saved.updatedAt).toLocaleString("en-IN", { dateStyle: "short", timeStyle: "short" })}` : "Not saved yet"}
                {holiday && <span style={{ color: "var(--tier-mid)" }}> · market closed this day</span>}
              </span>
            </div>
            <div className="flex items-center gap-2">
              {msg && <span className="text-xs" style={{ color: "var(--text-muted)" }}>{msg}</span>}
              {saved && (
                <button
                  type="button"
                  onClick={async () => {
                    if (!window.confirm(`Delete your analysis for ${date}?`)) return;
                    await fetch(`/api/analysis?date=${date}`, { method: "DELETE" });
                    resetEdits();
                    load();
                  }}
                  className="text-xs px-2.5 py-1.5 rounded border"
                  style={{ borderColor: "var(--border)", color: "var(--text-faint)" }}
                >
                  Delete day
                </button>
              )}
              <button type="button" onClick={save} disabled={saving || !dirty} className="text-xs px-4 py-1.5 rounded font-medium disabled:opacity-40" style={{ background: "var(--accent)", color: "var(--bg)" }}>
                {saving ? "Saving…" : dirty ? "Save (Ctrl+S)" : "Saved"}
              </button>
            </div>
          </div>

          <SubNav
            items={[
              { id: "day", label: "Market & ideas" },
              { id: "studies", label: `Stock studies${draft.studies?.length ? ` (${draft.studies.length})` : ""}` },
            ]}
            active={view}
            onChange={setView}
          />

          {view === "studies" ? (
            <StockStudies
              date={date}
              studies={draft.studies ?? []}
              setStudies={(list) => set(["studies"], list)}
              entries={entries}
              events={events}
              selectedId={studyId}
              setSelectedId={setStudyId}
              onOpen={(d, id) => {
                setDate(d);
                setStudyId(id);
              }}
              onAddIdea={(st) => {
                const n = (v) => (v === "" || v == null ? "" : Number(v));
                const dir = st.plan?.direction ?? (st.verdict === "Bearish" ? "Short" : "Long");
                const dup = (draft.ideas ?? []).some(
                  (i) => i.symbol === st.symbol && i.direction === dir && n(i.entry) === n(st.plan?.entry) && n(i.stop) === n(st.plan?.stop) && n(i.target) === n(st.plan?.target)
                );
                if (dup) {
                  setMsg(`${st.symbol} is already in this day's ideas with the same levels.`);
                  return;
                }
                set(["ideas"], [
                  ...(draft.ideas ?? []),
                  {
                    id: crypto.randomUUID(),
                    symbol: st.symbol,
                    direction: st.plan?.direction ?? (st.verdict === "Bearish" ? "Short" : "Long"),
                    setup: st.patterns?.[0] ?? "",
                    timeframe: "Swing (days)",
                    entry: st.plan?.entry ?? "",
                    stop: st.plan?.stop ?? "",
                    target: st.plan?.target ?? "",
                    horizonDays: st.horizonDays ?? 10,
                    thesis: st.notes?.split("\n")[0] || `${st.verdict} study`,
                  },
                ]);
                setMsg(`${st.symbol} added to this day's ideas — save to keep it.`);
              }}
              onLogTrade={(st) =>
                logTrade({
                  symbol: st.symbol,
                  direction: st.plan?.direction ?? "Long",
                  entry: st.plan?.entry,
                  stop: st.plan?.stop,
                  target: st.plan?.target,
                  setup: st.patterns?.[0] ?? "",
                  timeframe: "Swing (days)",
                  thesis: st.notes?.split("\n")[0] || `${st.verdict} study`,
                })
              }
              onAddToWatchlist={onAddToWatchlist}
              watchlistSymbols={watchlistSymbols}
            />
          ) : (
            <>
          <div>
            <SectionTitle meta="Saved with the day, so you can see later what the market looked like when you wrote it">Market snapshot</SectionTitle>
            <Panel>
              <Snapshot snap={snapshot} />
            </Panel>
            </div>

          {/* Pre-market */}
            <div>
            <SectionTitle>Before the open — your view</SectionTitle>
            <Panel>
              <div className="grid gap-4 md:grid-cols-2">
                {INDEXES.map((ix) => (
                  <div key={ix.id} className="flex flex-col gap-2">
                    <p className="text-xs font-semibold" style={{ color: "var(--text)" }}>
                      {ix.label}
                      {draft.biasGrade?.[ix.id]?.move1 != null && (
                        <span className="ml-2 font-normal" style={{ color: draft.biasGrade[ix.id].correct1 ? "var(--gain)" : "var(--loss)" }}>
                          next session {signed(draft.biasGrade[ix.id].move1)} → {draft.biasGrade[ix.id].correct1 ? "✓ right" : "✗ wrong"}
                        </span>
                      )}
                    </p>
                    <div className="flex gap-1.5">
                      {BIASES.map((b) => (
                        <button
                          key={b}
                          type="button"
                          onClick={() => set(["bias", ix.id], draft.bias[ix.id] === b ? "" : b)}
                          className="flex-1 text-xs py-1.5 rounded border"
                          style={draft.bias[ix.id] === b ? { borderColor: BIAS_TONE[b], color: BIAS_TONE[b], background: "var(--surface-3)" } : { borderColor: "var(--border)", color: "var(--text-muted)" }}
                        >
                          {b}
                        </button>
                      ))}
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <L label="Support">
                        <input type="number" value={draft.levels[ix.id]?.support ?? ""} onChange={(e) => set(["levels", ix.id, "support"], e.target.value)} className={`${inputCls} font-mono`} style={field} />
                      </L>
                      <L label="Resistance">
                        <input type="number" value={draft.levels[ix.id]?.resistance ?? ""} onChange={(e) => set(["levels", ix.id, "resistance"], e.target.value)} className={`${inputCls} font-mono`} style={field} />
                      </L>
                    </div>
                  </div>
                ))}
                <L label={`Confidence · ${draft.confidence}/5`}>
                  <input type="range" min="1" max="5" value={draft.confidence} onChange={(e) => set(["confidence"], Number(e.target.value))} />
                </L>
                <div />
                <L label="Market context — what you see and why" className="md:col-span-2">
                  <textarea rows={3} value={draft.context} onChange={(e) => set(["context"], e.target.value)} className={inputCls} style={field} placeholder="Global cues, FII/DII flows, trend, key news, what would change your view…" />
                </L>
                <L label="Sectors in focus" className="md:col-span-2">
                  <Chips options={[...new Set([...lists.sectors, ...draft.sectorsInFocus])]} value={draft.sectorsInFocus} onChange={(v) => set(["sectorsInFocus"], v)} />
                </L>
                {(lists.themes.length > 0 || draft.themesInFocus.length > 0) && (
                  <L label="Themes in focus" className="md:col-span-2">
                    <Chips options={[...new Set([...lists.themes, ...draft.themesInFocus])]} value={draft.themesInFocus} onChange={(v) => set(["themesInFocus"], v)} tone="var(--tier-low)" />
                  </L>
                )}
                <L label="Events & news to watch" className="md:col-span-2">
                  <textarea rows={2} value={draft.events} onChange={(e) => set(["events"], e.target.value)} className={inputCls} style={field} placeholder="RBI policy, results, expiry, global data…" />
                  {eventsToday.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5 mt-1">
                      <span className="text-[10px]" style={{ color: "var(--text-faint)" }}>
                        Your watchlist:
                      </span>
                      {eventsToday.slice(0, 8).map((t) => (
                        <button key={t} type="button" onClick={() => set(["events"], [draft.events, t].filter(Boolean).join("\n"))} className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: "var(--tier-low-dim)", color: "var(--tier-low)" }} title="Add to events">
                          + {t}
                        </button>
                      ))}
                    </div>
                  )}
                </L>
              </div>
            </Panel>
            </div>

          {/* Ideas */}
            <div>
            <SectionTitle meta="Each idea is graded automatically: did it trigger, and did target or stop come first">Ideas</SectionTitle>
            <Panel>
              <div className="flex flex-wrap gap-2 mb-3">
                <input
                  value={ideaText}
                  onChange={(e) => setIdeaText(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && ideaText.trim() && addIdeaFromText()}
                  placeholder='Type an idea — e.g. "TCS long above 4012 SL 3950 target 4200, pocket pivot off 10 DMA"'
                  className={`${inputCls} flex-1 min-w-[16rem]`}
                  style={field}
                />
                <button type="button" onClick={addIdeaFromText} disabled={!ideaText.trim()} className="text-xs px-3 py-1.5 rounded font-medium disabled:opacity-40" style={{ background: "var(--accent)", color: "var(--bg)" }}>
                  Add idea
                </button>
                <button type="button" onClick={carryForward} className="text-xs px-3 py-1.5 rounded border" style={{ borderColor: "var(--border)", color: "var(--text-muted)" }} title="Copy ideas still waiting or open from your last entry">
                  Carry forward open ideas
                </button>
              </div>
              {draft.ideas.length === 0 ? (
                <p className="text-xs" style={{ color: "var(--text-faint)" }}>
                  No ideas for this day yet. Add one above, or from any stock&apos;s page with “Add to today&apos;s analysis”.
                </p>
              ) : (
                <div className="table-scroll">
                  <table className="w-full text-xs border-collapse">
                    <thead>
                      <tr className="text-left" style={{ color: "var(--text-faint)" }}>
                        {["Symbol", "Dir.", "Trigger", "Stop", "Target", "Setup", "Days", "Now", "Outcome", ""].map((h) => (
                          <th key={h} className="py-1.5 px-1.5 font-medium">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {draft.ideas.map((i, k) => {
                        const q = quotes[i.symbol];
                        const upd = (f) => (e) => set(["ideas", k, f], e.target.value);
                        return (
                          <Fragment key={i.id}>
                            <tr className="border-t" style={{ borderColor: "var(--border)" }}>
                              <td className="py-1.5 px-1.5">
                                {i.symbol ? (
                                  <SymbolLink symbol={i.symbol} className="text-xs" />
                                ) : (
                                  <input value={i.symbol} onChange={(e) => set(["ideas", k, "symbol"], e.target.value.toUpperCase())} className={`${inputCls} w-24 font-mono`} style={field} placeholder="SYMBOL" />
                                )}
                                {i.carriedFrom && (
                                  <span className="block text-[9px]" style={{ color: "var(--text-faint)" }}>
                                    from {i.carriedFrom}
                                  </span>
                                )}
                              </td>
                              <td className="py-1.5 px-1.5">
                                <button type="button" onClick={() => set(["ideas", k, "direction"], i.direction === "Long" ? "Short" : "Long")} className="text-[11px] px-1.5 py-0.5 rounded" style={{ color: i.direction === "Long" ? "var(--gain)" : "var(--loss)", background: "var(--surface-2)" }}>
                                  {i.direction}
                                </button>
                              </td>
                              {["entry", "stop", "target"].map((f) => (
                                <td key={f} className="py-1.5 px-1.5">
                                  <input type="number" value={i[f] ?? ""} onChange={upd(f)} className={`${inputCls} w-24 font-mono`} style={field} />
                                </td>
                              ))}
                              <td className="py-1.5 px-1.5">
                                <input value={i.setup ?? ""} onChange={upd("setup")} list="analysis-setups" className={`${inputCls} w-32`} style={field} />
                              </td>
                              <td className="py-1.5 px-1.5">
                                <input type="number" min="1" max="60" value={i.horizonDays ?? 10} onChange={upd("horizonDays")} className={`${inputCls} w-14 font-mono`} style={field} title="Sessions the idea has to work" />
                              </td>
                              <td className="py-1.5 px-1.5 font-mono" style={{ color: "var(--text)" }}>
                                {q?.price != null ? fmt(q.price) : "—"}
                              </td>
                              <td className="py-1.5 px-1.5">
                                <Outcome o={i.outcome} />
                              </td>
                              <td className="py-1.5 px-1.5 whitespace-nowrap text-right">
                                <button type="button" onClick={() => logTrade(i)} className="text-[10px] px-1.5 py-0.5 rounded border mr-1" style={{ borderColor: "var(--accent)", color: "var(--accent)" }} title="Create a draft trade in the Journal">
                                  Log trade
                                </button>
                                {onAddToWatchlist && i.symbol && !watchlistSymbols.includes(i.symbol) && (
                                  <button type="button" onClick={() => onAddToWatchlist(i.symbol, `Analysis ${date}`)} className="text-[10px] px-1.5 py-0.5 rounded border mr-1" style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}>
                                    + Watch
                                  </button>
                                )}
                                <button type="button" onClick={() => set(["ideas"], draft.ideas.filter((_, j) => j !== k))} className="text-[11px] px-1" style={{ color: "var(--loss)" }} aria-label="Remove idea">
                                  ×
                                </button>
                              </td>
                            </tr>
                            <tr>
                              <td colSpan={10} className="px-1.5 pb-2">
                                <input value={i.thesis ?? ""} onChange={upd("thesis")} className={inputCls} style={{ ...field, fontSize: 12 }} placeholder="Why — the thesis in one line" />
                              </td>
                            </tr>
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                  <datalist id="analysis-setups">
                    {["Trendline breakout", "Monthly breakout", "Pocket pivot", "Shakeout", "IPO base", "Personal learning", "Breakout", "Pullback", "Reversal", "Support bounce", "Breakdown"].map((x) => (
                      <option key={x} value={x} />
                    ))}
                  </datalist>
                </div>
              )}
            </Panel>
            </div>

          {/* Checklist + post-market */}
            <div className="grid gap-6 lg:grid-cols-[1fr_2fr]">
            <div>
              <SectionTitle
                meta={
                  <button type="button" onClick={() => setEditChecklist((v) => !v)} className="hover:underline" style={{ color: "var(--accent)" }}>
                    {editChecklist ? "Cancel" : "Edit list"}
                  </button>
                }
              >
                Routine checklist
              </SectionTitle>
              <Panel>
                {editChecklist ? (
                  <ChecklistEditor items={prefs.checklist} onSave={saveChecklist} />
                ) : (
                  <ul className="flex flex-col gap-1.5">
                    {prefs.checklist.map((c) => (
                      <li key={c}>
                        <label className="flex items-center gap-2 text-xs cursor-pointer" style={{ color: draft.checklist?.[c] ? "var(--text)" : "var(--text-muted)" }}>
                          <input type="checkbox" checked={!!draft.checklist?.[c]} onChange={(e) => set(["checklist", c], e.target.checked)} />
                          {c}
                        </label>
                      </li>
                    ))}
                  </ul>
                )}
                {s.checklistRates?.length > 0 && !editChecklist && (
                  <p className="text-[10px] mt-2" style={{ color: "var(--text-faint)" }}>
                    Done on average: {Math.round(s.checklistRates.reduce((a, c) => a + (c.rate ?? 0), 0) / s.checklistRates.length)}% of items
                  </p>
                )}
              </Panel>
            </div>
            <div>
              <SectionTitle>After the close — review</SectionTitle>
              <Panel>
                <div className="grid gap-3 md:grid-cols-2">
                  <L label="What happened vs your view" className="md:col-span-2">
                    <textarea rows={2} value={draft.review} onChange={(e) => set(["review"], e.target.value)} className={inputCls} style={field} />
                  </L>
                  <L label="What worked">
                    <textarea rows={2} value={draft.worked} onChange={(e) => set(["worked"], e.target.value)} className={inputCls} style={field} />
                  </L>
                  <L label="What I missed">
                    <textarea rows={2} value={draft.missed} onChange={(e) => set(["missed"], e.target.value)} className={inputCls} style={field} />
                  </L>
                  <L label="Lesson for tomorrow" className="md:col-span-2">
                    <input value={draft.lessons} onChange={(e) => set(["lessons"], e.target.value)} className={inputCls} style={field} />
                  </L>
                  <L label="State of mind">
                    <Chips options={EMOTIONS} value={draft.mood} onChange={(v) => set(["mood"], v)} tone="var(--tier-low)" />
                  </L>
                  <L label="Rate your analysis today">
                    <div className="flex gap-1">
                      {[1, 2, 3, 4, 5].map((n) => (
                        <button key={n} type="button" onClick={() => set(["rating"], draft.rating === n ? null : n)} className="w-8 h-8 rounded border text-sm" style={draft.rating >= n ? { borderColor: "var(--accent)", color: "var(--accent)", background: "var(--surface-3)" } : { borderColor: "var(--border)", color: "var(--text-faint)" }}>
                          ★
                        </button>
                      ))}
                    </div>
                  </L>
                </div>
              </Panel>
            </div>
            </div>

            </>
          )}

          {/* History */}
          {entries.length > 0 && (
            <div>
              <SectionTitle>All days</SectionTitle>
              <div className="rounded-[var(--radius)] border overflow-hidden" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
                <div className="table-scroll">
                  <table className="w-full text-xs border-collapse">
                    <thead>
                      <tr className="text-left border-b" style={{ borderColor: "var(--border)", color: "var(--text-faint)" }}>
                        {["Date", "NIFTY", "BANK NIFTY", "Ideas", "Results", "Lesson", "Rating"].map((h) => (
                          <th key={h} className={`py-2 px-2 font-medium ${h === "Date" ? "pl-4" : ""}`}>
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {entries.map((e) => {
                        const g = (id) => e.biasGrade?.[id];
                        const res = e.ideas.map((i) => ideaWon(i.outcome)).filter((x) => x != null);
                        return (
                          <tr key={e.date} onClick={() => setDate(e.date)} className="border-b last:border-b-0 cursor-pointer hover:bg-white/[0.02]" style={{ borderColor: "var(--border)", background: e.date === date ? "var(--surface-2)" : undefined }}>
                            <td className="py-2 pl-4 pr-2 font-mono" style={{ color: "var(--text)" }}>
                              {e.date}
                            </td>
                            {INDEXES.map((ix) => (
                              <td key={ix.id} className="py-2 px-2">
                                <span style={{ color: BIAS_TONE[e.bias?.[ix.id]] ?? "var(--text-faint)" }}>{e.bias?.[ix.id] || "—"}</span>
                                {g(ix.id)?.correct1 != null && <span className="ml-1">{g(ix.id).correct1 ? "✓" : "✗"}</span>}
                              </td>
                            ))}
                            <td className="py-2 px-2 font-mono">{e.ideas.length}</td>
                            <td className="py-2 px-2 font-mono">
                              {res.length ? (
                                <>
                                  <span style={{ color: "var(--gain)" }}>{res.filter(Boolean).length}✓</span> <span style={{ color: "var(--loss)" }}>{res.filter((x) => !x).length}✗</span>
                                </>
                              ) : (
                                "—"
                              )}
                            </td>
                            <td className="py-2 px-2 max-w-[24rem] truncate" style={{ color: "var(--text-muted)" }} title={e.lessons}>
                              {e.lessons || "—"}
                            </td>
                            <td className="py-2 px-2" style={{ color: "var(--accent)" }}>
                              {e.rating ? "★".repeat(e.rating) : "—"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ChecklistEditor({ items, onSave }) {
  const [text, setText] = useState(items.join("\n"));
  return (
    <div className="flex flex-col gap-2">
      <textarea rows={7} value={text} onChange={(e) => setText(e.target.value)} className={inputCls} style={field} />
      <p className="text-[10px]" style={{ color: "var(--text-faint)" }}>
        One item per line.
      </p>
      <button type="button" onClick={() => onSave(text.split("\n").map((x) => x.trim()).filter(Boolean))} className="self-start text-xs px-3 py-1.5 rounded font-medium" style={{ background: "var(--accent)", color: "var(--bg)" }}>
        Save checklist
      </button>
    </div>
  );
}
