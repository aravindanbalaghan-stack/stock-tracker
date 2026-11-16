// What your sales say about how you sell — for Holdings → Closed.
// Pure functions (run in the browser on the loaded sales).

import { reasonLabel, reasonKind, REASON_KINDS } from "@/lib/sellReasons";

const r1 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 10) / 10);
const r2 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 100) / 100);
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);

export const SOLD_EARLY_PCT = 10; // stock rose this much after you sold
export const GOOD_EXIT_PCT = -10; // stock fell this much after you sold

/** Adds "what it did after you sold" from the latest close. */
export function enrich(sales, latest = {}) {
  return sales.map((s) => {
    const l = latest[s.symbol];
    let sincePct = null;
    if (l?.close && s.sellPrice && l.date > (s.sellDate ?? "")) {
      const x = (l.close / s.sellPrice - 1) * 100;
      // A split/bonus after the sale makes the comparison meaningless
      // (closes are adjusted, your sell price isn't); drop extreme jumps.
      if (x > -60 && x < 300) sincePct = r1(x);
    }
    return {
      ...s,
      reasonLabel: reasonLabel(s.reason),
      kind: reasonKind(s.reason),
      sincePct,
      latestClose: l?.close ?? null,
      soldEarly: sincePct != null && sincePct >= SOLD_EARLY_PCT,
      goodExit: sincePct != null && sincePct <= GOOD_EXIT_PCT,
    };
  });
}

function group(rows, keyOf, labelOf) {
  const m = new Map();
  for (const r of rows) {
    const k = keyOf(r);
    const g = m.get(k) ?? { key: k, label: labelOf(r), rows: [] };
    g.rows.push(r);
    m.set(k, g);
  }
  return [...m.values()]
    .map((g) => {
      const withPct = g.rows.filter((r) => r.pnlPct != null);
      const since = g.rows.filter((r) => r.sincePct != null).map((r) => r.sincePct);
      return {
        key: g.key,
        label: g.label,
        count: g.rows.length,
        winRate: withPct.length ? r1((withPct.filter((r) => r.pnlPct > 0).length / withPct.length) * 100) : null,
        avgPct: r2(mean(withPct.map((r) => r.pnlPct))),
        totalPnl: r2(g.rows.reduce((a, r) => a + (r.pnl ?? 0), 0)),
        avgHold: r1(mean(g.rows.filter((r) => r.holdDays != null).map((r) => r.holdDays))),
        avgSincePct: since.length ? r1(mean(since)) : null,
        soldEarly: g.rows.filter((r) => r.soldEarly).length,
      };
    })
    .sort((a, b) => b.count - a.count);
}

export function summarise(rows) {
  const priced = rows.filter((r) => r.pnlPct != null);
  const wins = priced.filter((r) => r.pnlPct > 0);
  const losses = priced.filter((r) => r.pnlPct <= 0);
  const avgWin = mean(wins.map((r) => r.pnlPct));
  const avgLoss = mean(losses.map((r) => r.pnlPct));
  const answered = rows.filter((r) => r.followedPlan === "yes" || r.followedPlan === "no");
  return {
    count: rows.length,
    full: rows.filter((r) => r.full).length,
    realised: r2(rows.reduce((a, r) => a + (r.pnl ?? 0), 0)),
    winRate: priced.length ? r1((wins.length / priced.length) * 100) : null,
    avgWinPct: r2(avgWin),
    avgLossPct: r2(avgLoss),
    payoff: avgWin != null && avgLoss ? r2(avgWin / Math.abs(avgLoss)) : null,
    avgHoldWin: r1(mean(wins.filter((r) => r.holdDays != null).map((r) => r.holdDays))),
    avgHoldLoss: r1(mean(losses.filter((r) => r.holdDays != null).map((r) => r.holdDays))),
    planFollowedPct: answered.length ? r1((answered.filter((r) => r.followedPlan === "yes").length / answered.length) * 100) : null,
    noReason: rows.filter((r) => !r.reason).length,
    soldEarly: rows.filter((r) => r.soldEarly).length,
    goodExits: rows.filter((r) => r.goodExit).length,
    withSince: rows.filter((r) => r.sincePct != null).length,
  };
}

export const byReason = (rows) => group(rows, (r) => r.reason ?? "none", (r) => r.reasonLabel);
export const byKind = (rows) => group(rows, (r) => r.kind, (r) => REASON_KINDS[r.kind]);

/** Plain-English observations, most useful first. Only stated with enough sales behind them. */
export function insights(rows) {
  const out = [];
  const s = summarise(rows);
  if (s.count < 3) return out;

  if (s.avgHoldWin != null && s.avgHoldLoss != null && s.avgHoldLoss > s.avgHoldWin * 1.3 && rows.length >= 6) {
    out.push({
      tone: "warn",
      text: `You hold losers longer than winners — ${s.avgHoldLoss} days on average vs ${s.avgHoldWin}. That's the classic "cut flowers, water weeds" pattern; a firm stop shortens the losers.`,
    });
  }
  if (s.payoff != null && s.winRate != null) {
    const edge = (s.winRate / 100) * s.avgWinPct + (1 - s.winRate / 100) * s.avgLossPct;
    out.push({
      tone: edge > 0 ? "good" : "warn",
      text: `You win ${s.winRate}% of sales; winners average ${s.avgWinPct > 0 ? "+" : ""}${s.avgWinPct}% and losers ${s.avgLossPct}% (payoff ${s.payoff}×). That's ${edge > 0 ? "+" : ""}${r2(edge)}% per sale on average.`,
    });
  }

  const reasons = byReason(rows).filter((g) => g.count >= 2 && g.key !== "none");
  const worst = [...reasons].sort((a, b) => a.totalPnl - b.totalPnl)[0];
  if (worst && worst.totalPnl < 0) {
    out.push({ tone: "warn", text: `"${worst.label}" sales cost you the most: ${worst.count} sales, ₹${Math.round(Math.abs(worst.totalPnl)).toLocaleString("en-IN")} lost in total.` });
  }
  const early = reasons.filter((g) => g.avgSincePct != null && g.avgSincePct >= 5).sort((a, b) => b.avgSincePct - a.avgSincePct)[0];
  if (early) {
    out.push({ tone: "warn", text: `After "${early.label}" sales the stocks went on to rise ${early.avgSincePct}% on average — those exits may be too early.` });
  }
  const protective = reasons.filter((g) => g.avgSincePct != null && g.avgSincePct <= -5).sort((a, b) => a.avgSincePct - b.avgSincePct)[0];
  if (protective) {
    out.push({ tone: "good", text: `"${protective.label}" exits worked — the stocks fell a further ${Math.abs(protective.avgSincePct)}% on average after you sold.` });
  }

  const on = rows.filter((r) => r.followedPlan === "yes" && r.pnlPct != null);
  const off = rows.filter((r) => r.followedPlan === "no" && r.pnlPct != null);
  if (on.length >= 2 && off.length >= 2) {
    const a = r2(mean(on.map((r) => r.pnlPct))), b = r2(mean(off.map((r) => r.pnlPct)));
    out.push({
      tone: a >= b ? "good" : "info",
      text: `Sales that followed your plan averaged ${a > 0 ? "+" : ""}${a}%; ones where you deviated averaged ${b > 0 ? "+" : ""}${b}%.`,
    });
  }

  const emo = rows.filter((r) => r.emotions?.some((e) => ["Fear", "FOMO", "Impatient", "Revenge"].includes(e)) && r.pnlPct != null);
  if (emo.length >= 2) {
    const since = emo.filter((r) => r.sincePct != null).map((r) => r.sincePct);
    out.push({
      tone: "info",
      text: `${emo.length} sales were made feeling fear, FOMO or impatience: they averaged ${r2(mean(emo.map((r) => r.pnlPct)))}%${since.length ? `, and the stocks then moved ${r1(mean(since))}%` : ""}.`,
    });
  }
  if (s.noReason > 0) {
    out.push({ tone: "info", text: `${s.noReason} sale${s.noReason === 1 ? " has" : "s have"} no reason recorded — add one with Edit so the patterns above include ${s.noReason === 1 ? "it" : "them"}.` });
  }
  return out;
}

/** Indian financial year (Apr–Mar) of an ISO date, e.g. "FY 2026-27". */
export function fyOf(iso) {
  if (!iso) return null;
  const [y, m] = iso.split("-").map(Number);
  const start = m >= 4 ? y : y - 1;
  return `FY ${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}
