// Sector / theme rotation — a Relative Rotation Graph (RRG).
//
// Each group (a sector or one of your themes) is an equal-weight basket of
// its stocks, compared each week against an equal-weight basket of the 500
// most traded stocks (which tracks the NIFTY 500). Two numbers place it:
//
//   RS-Ratio     is the group's relative strength above (>100) or below
//                (<100) its own recent norm — the trend of out/under-
//                performance.
//   RS-Momentum  is whether that relative strength is rising (>100) or
//                falling (<100) — the change in the trend.
//
// Groups rotate clockwise: Improving → Leading → Weakening → Lagging.
//
// This is the widely used open approximation of JdK's RRG (the exact
// formula is proprietary): each line is normalised against its own
// recent mean and spread (z-score), so all groups share one scale.
//
//   rs        = 100 × group / benchmark, smoothed with a 3-week EMA
//   RS-Ratio  = 100 + z(rs, W weeks)
//   roc       = % change of RS-Ratio week on week
//   RS-Mom    = 100 + z(roc, W weeks)

import { getResolvedSectorList } from "@/lib/sectorOverrides";
import { getThemeIndex } from "@/lib/stockMaster";
import { universeRows } from "@/lib/marketPanel";

export const RRG_WINDOW = 10; // weeks
export const RRG_TAIL = 12; // weeks of history returned per group
const MIN_MEMBERS = 3;

export async function getGroups(kind) {
  if (kind === "themes") {
    const { themes, bySymbol } = await getThemeIndex();
    const members = new Map(themes.map((t) => [t.name, []]));
    for (const [symbol, names] of Object.entries(bySymbol)) for (const n of names) members.get(n)?.push(symbol);
    return themes.map((t) => ({ key: `theme:${t.name}`, name: t.name, symbols: members.get(t.name) ?? [] }));
  }
  const list = await getResolvedSectorList();
  return list.map((s) => ({ key: s.key, name: s.name, symbols: s.symbols ?? [] }));
}

function weekKeyOfDate(iso) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

/** Session index of the last trading day of each ISO week. */
export function weekEnds(dates) {
  const out = [];
  dates.forEach((d, t) => {
    const wk = weekKeyOfDate(d);
    if (out.length && out[out.length - 1].week === wk) out[out.length - 1].t = t;
    else out.push({ week: wk, t, date: d });
  });
  out.forEach((w) => (w.date = dates[w.t]));
  return out;
}

/** Equal-weight weekly index (starts at 100) for a set of panel rows. */
export function basketIndex(panel, rowIdx, weeks) {
  const idx = [100];
  for (let k = 1; k < weeks.length; k++) {
    const a = weeks[k - 1].t, b = weeks[k].t;
    let s = 0, n = 0;
    for (const i of rowIdx) {
      const x = panel.c[i][a], y = panel.c[i][b];
      if (Number.isFinite(x) && Number.isFinite(y) && x > 0) {
        const r = y / x - 1;
        if (Math.abs(r) < 0.6) { s += r; n++; } // ignore data glitches
      }
    }
    idx.push(idx[k - 1] * (1 + (n ? s / n : 0)));
  }
  return idx;
}

function zSeries(values, w) {
  return values.map((_, k) => {
    if (k < w - 1) return null;
    const win = values.slice(k - w + 1, k + 1);
    if (win.some((x) => x == null)) return null;
    const m = win.reduce((a, b) => a + b, 0) / w;
    const sd = Math.sqrt(win.reduce((a, b) => a + (b - m) ** 2, 0) / w);
    return sd > 1e-9 ? (values[k] - m) / sd : 0;
  });
}

export function quadrantOf(ratio, mom) {
  if (ratio >= 100 && mom >= 100) return "Leading";
  if (ratio >= 100) return "Weakening";
  if (mom >= 100) return "Improving";
  return "Lagging";
}

/** RRG points for one group's index vs the benchmark index. */
const RS_SMOOTH = 3; // weeks of EMA on the raw RS line, as JdK's RRG smooths before normalising

export function rrgPoints(groupIdx, benchIdx, w = RRG_WINDOW) {
  const raw = groupIdx.map((g, k) => (100 * g) / benchIdx[k]);
  const a = 2 / (RS_SMOOTH + 1);
  const rs = [];
  raw.forEach((x, k) => rs.push(k === 0 ? x : x * a + rs[k - 1] * (1 - a)));
  const zr = zSeries(rs, w);
  const ratio = zr.map((z) => (z == null ? null : 100 + z));
  const roc = ratio.map((r, k) => (r == null || k === 0 || ratio[k - 1] == null ? null : (r / ratio[k - 1] - 1) * 100));
  const zm = zSeries(roc, w);
  return ratio.map((r, k) => (r == null || zm[k] == null ? null : { ratio: r, momentum: 100 + zm[k] }));
}

const r2 = (x) => Math.round(x * 100) / 100;
const pctChange = (arr, back) => {
  const n = arr.length - 1;
  return n - back >= 0 ? r2((arr[n] / arr[n - back] - 1) * 100) : null;
};

export async function computeRotation(panel, { kind = "sectors", groups = null } = {}) {
  const list = groups ?? (await getGroups(kind));
  const weeks = weekEnds(panel.dates);
  const bench = universeRows(panel, "top500").map((r) => r.i);
  const benchIdx = basketIndex(panel, bench, weeks);

  const out = [];
  for (const g of list) {
    const rows = [...new Set(g.symbols)].map((s) => panel.idx.get(s)).filter((i) => i != null);
    if (rows.length < MIN_MEMBERS) continue;
    const gi = basketIndex(panel, rows, weeks);
    const pts = rrgPoints(gi, benchIdx);
    const tail = [];
    for (let k = Math.max(0, weeks.length - RRG_TAIL); k < weeks.length; k++) {
      if (pts[k]) tail.push({ week: weeks[k].date, ratio: r2(pts[k].ratio), momentum: r2(pts[k].momentum) });
    }
    if (!tail.length) continue;
    const last = tail[tail.length - 1];
    const prev = tail[tail.length - 2] ?? last;
    const heading = (Math.atan2(last.momentum - prev.momentum, last.ratio - prev.ratio) * 180) / Math.PI;
    const rsLine = gi.map((x, k) => x / benchIdx[k]);
    out.push({
      key: g.key,
      name: g.name,
      members: rows.length,
      quadrant: quadrantOf(last.ratio, last.momentum),
      ratio: last.ratio,
      momentum: last.momentum,
      heading: Math.round(heading),
      ret4w: pctChange(gi, 4),
      ret13w: pctChange(gi, 13),
      rs4w: pctChange(rsLine, 4),
      rs13w: pctChange(rsLine, 13),
      tail,
    });
  }
  const order = { Leading: 0, Improving: 1, Weakening: 2, Lagging: 3 };
  out.sort((a, b) => order[a.quadrant] - order[b.quadrant] || b.ratio - a.ratio);
  return {
    kind,
    asOf: panel.latest,
    benchmark: "Equal-weight top 500 by turnover (≈ NIFTY 500)",
    window: RRG_WINDOW,
    weeks: weeks.slice(-RRG_TAIL).map((w) => w.date),
    groups: out,
  };
}
