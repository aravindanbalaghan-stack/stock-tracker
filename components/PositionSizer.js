"use client";

import { useEffect, useMemo, useState } from "react";
import { Panel, SectionTitle, ErrorState } from "@/components/ui/Chrome";
import InfoNote from "@/components/InfoNote";
import MoneyRules from "@/components/MoneyRules";
import { sizePosition } from "@/lib/sizing";
import { usePersistentState } from "@/lib/usePersistentState";
import { fmt, toneOf } from "@/lib/format";

// "How many shares should I buy?" — fixed-fractional position sizing:
// shares = (capital × risk %) ÷ (entry − stop), capped by your
// max-position rule, then checked against your sector and total-risk
// limits. The stop comes first; the share count follows from it.

const input =
  "w-full rounded-[var(--radius-sm)] border px-2.5 py-2 text-sm font-mono bg-[var(--surface-2)] border-[var(--border)] text-[var(--text)] focus:outline-none focus:border-[var(--accent)]";
const rupees = (v, d = 0) => (v == null ? "—" : `₹${fmt(v, d)}`);

function Check({ ok, warn, children }) {
  const color = ok ? "var(--gain)" : warn ? "var(--tier-mid)" : "var(--loss)";
  return (
    <li className="flex items-start gap-2 text-sm">
      <span aria-hidden className="mt-0.5 font-mono" style={{ color }}>
        {ok ? "✓" : warn ? "!" : "✕"}
      </span>
      <span style={{ color: "var(--text)" }}>{children}</span>
    </li>
  );
}

export default function PositionSizer({ onAdd }) {
  const [symbol, setSymbol] = usePersistentState("sizer.symbol", "");
  const [loaded, setLoaded] = useState({ key: null, data: null, error: null });
  const [entry, setEntry] = useState("");
  const [stop, setStop] = useState("");
  const [useBreadth, setUseBreadth] = useState(true);
  const [added, setAdded] = useState(null);
  const [rulesVersion, setRulesVersion] = useState(0);

  const sym = symbol.trim().toUpperCase();
  const key = `${sym}|${rulesVersion}`;

  useEffect(() => {
    let live = true;
    const t = setTimeout(() => {
      fetch(`/api/position-size?symbol=${encodeURIComponent(sym)}`)
        .then(async (r) => {
          const j = await r.json();
          if (!r.ok) throw new Error(j?.error || "Couldn't load");
          if (!live) return;
          setLoaded({ key, data: j, error: null });
          if (j.context?.close) {
            setEntry(String(j.context.close));
            setStop(j.stops?.[0] ? String(j.stops[0].price) : "");
          }
        })
        .catch((e) => live && setLoaded({ key, data: null, error: e.message }));
    }, sym ? 350 : 0);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [sym, key]);

  const data = loaded.key === key ? loaded.data : null;
  const settings = data?.settings;
  const capital = settings?.capital > 0 ? settings.capital : data?.exposure?.portfolioValue || null;
  const mult = useBreadth && settings?.breadthAdjust && data?.breadth ? data.breadth.multiplier : 1;
  const e = Number(entry), st = Number(stop);

  const plan = useMemo(
    () => (settings && capital ? sizePosition({ capital, riskPct: settings.riskPct, maxPositionPct: settings.maxPositionPct, entry: e, stop: st, multiplier: mult }) : null),
    [settings, capital, e, st, mult]
  );

  const checks = useMemo(() => {
    if (!plan || !data) return [];
    const out = [];
    const ex = data.exposure;
    const newSectorPct = capital ? ((ex.sectorValue + plan.positionValue) / capital) * 100 : null;
    const newRiskPct = capital ? ((ex.openRisk + plan.riskAmount) / capital) * 100 : null;
    out.push({
      ok: plan.positionPct <= settings.maxPositionPct + 0.01,
      text: `Position is ${fmt(plan.positionPct, 1)}% of capital (limit ${settings.maxPositionPct}%)${plan.cappedBy === "position limit" ? " — the share count was capped by this limit, so you're risking less than your full budget" : ""}`,
      warn: plan.cappedBy === "position limit",
    });
    if (data.sector) {
      out.push({
        ok: newSectorPct <= settings.maxSectorPct,
        warn: newSectorPct > settings.maxSectorPct * 0.85,
        text: `${data.sector} would be ${fmt(newSectorPct, 1)}% of capital after this trade (limit ${settings.maxSectorPct}%)`,
      });
    }
    out.push({
      ok: newRiskPct <= settings.maxOpenRiskPct,
      text: `Total open risk would be ${fmt(newRiskPct, 1)}% of capital (limit ${settings.maxOpenRiskPct}%)${ex.openRisk === 0 ? " — counting only holdings that have a stop set" : ""}`,
    });
    const ctx = data.context;
    if (ctx?.stage === 4) out.push({ ok: false, text: `${sym} is in Stage 4 (below a falling 30-week average) — Weinstein's rule is never to buy Stage 4` });
    else if (ctx?.stage === 3) out.push({ ok: false, warn: true, text: `${sym} is in Stage 3 (topping) — late to buy` });
    else if (ctx?.stage === 2) out.push({ ok: true, text: `${sym} is in Stage 2 (advancing)` });
    if (plan.stopPct < -12) out.push({ ok: false, warn: true, text: `The stop is ${fmt(Math.abs(plan.stopPct), 1)}% away — a wide stop means a small position; a closer, logical stop lets you buy more for the same risk` });
    if (ex.alreadyHeld) out.push({ ok: true, warn: true, text: `You already hold ${ex.alreadyHeld.quantity} shares at ₹${fmt(ex.alreadyHeld.avgPrice)} — this would add to it` });
    if (data.breadth?.tone && data.breadth.tone !== "risk-on") {
      out.push({ ok: false, warn: true, text: `Market breadth is ${data.breadth.tone === "risk-off" ? "Risk-off" : "Mixed"}: ${data.breadth.headline}` });
    }
    return out;
  }, [plan, data, capital, settings, sym]);

  async function addToHoldings() {
    if (!plan?.shares) return;
    await onAdd({ symbol: sym, quantity: plan.shares, avgPrice: e, buyDate: new Date().toISOString().slice(0, 10) });
    // Record the stop too, so open risk is tracked from day one.
    await fetch("/api/holdings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ symbol: sym, stopLoss: st }) }).catch(() => {});
    setAdded(`${plan.shares} ${sym} added to Holdings with a stop at ₹${fmt(st)}`);
  }

  return (
    <div className="space-y-5">
      <InfoNote label="How the size is worked out">
        Decide where you&apos;d admit you&apos;re wrong (the stop) before deciding how much to buy. The number of shares is
        your risk budget — capital × risk per trade — divided by the distance from entry to stop, so a trade that hits its
        stop always costs about the same, however volatile the stock. It&apos;s then capped by your max-position rule and
        checked against your sector and total-risk limits. Prices are the last close; suggested stops are common technical
        levels, not advice.
      </InfoNote>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <Panel>
          <SectionTitle>Trade</SectionTitle>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="block sm:col-span-1">
              <span className="text-xs" style={{ color: "var(--text-muted)" }}>Symbol</span>
              <input className={`${input} mt-1 uppercase`} value={symbol} onChange={(ev) => setSymbol(ev.target.value)} placeholder="e.g. RELIANCE" autoComplete="off" spellCheck={false} />
            </label>
            <label className="block">
              <span className="text-xs" style={{ color: "var(--text-muted)" }}>Entry ₹</span>
              <input className={`${input} mt-1`} type="number" step="0.05" value={entry} onChange={(ev) => setEntry(ev.target.value)} />
            </label>
            <label className="block">
              <span className="text-xs" style={{ color: "var(--text-muted)" }}>Stop ₹</span>
              <input className={`${input} mt-1`} type="number" step="0.05" value={stop} onChange={(ev) => setStop(ev.target.value)} />
            </label>
          </div>

          {loaded.error && <div className="mt-3"><ErrorState>{loaded.error}</ErrorState></div>}
          {data?.notFound && <p className="mt-3 text-sm" style={{ color: "var(--tier-mid)" }}>{data.notFound}</p>}

          {data?.context && (
            <div className="mt-3 text-xs flex flex-wrap gap-x-4 gap-y-1" style={{ color: "var(--text-muted)" }}>
              <span>Close <b className="font-mono" style={{ color: "var(--text)" }}>₹{fmt(data.context.close)}</b> <span style={{ color: toneOf(data.context.changePct) }}>({data.context.changePct >= 0 ? "+" : ""}{fmt(data.context.changePct, 1)}%)</span></span>
              <span>ATR <b className="font-mono">{fmt(data.context.atrPct, 1)}%</b></span>
              <span>Stage <b className="font-mono">{data.context.stage ?? "—"}</b></span>
              {data.sector && <span>{data.sector}</span>}
              <span style={{ color: "var(--text-faint)" }}>as of {data.asOf}</span>
            </div>
          )}

          {data?.stops?.length > 0 && (
            <div className="mt-4">
              <div className="text-xs mb-1.5" style={{ color: "var(--text-muted)" }}>Suggested stops</div>
              <div className="flex flex-wrap gap-1.5">
                {data.stops.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    title={s.why}
                    onClick={() => setStop(String(s.price))}
                    className="px-2.5 py-1 rounded-full text-xs border"
                    style={{ borderColor: String(s.price) === stop ? "var(--accent)" : "var(--border)", color: "var(--text)" }}
                  >
                    {s.label} <span className="font-mono">₹{fmt(s.price)}</span> <span style={{ color: "var(--text-faint)" }}>({fmt(s.pct, 1)}%)</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {data?.breadth && settings?.breadthAdjust && (
            <label className="mt-4 flex items-center gap-2 text-sm" style={{ color: "var(--text-muted)" }}>
              <input type="checkbox" checked={useBreadth} onChange={(ev) => setUseBreadth(ev.target.checked)} />
              Adjust for market breadth ({data.breadth.tone === "risk-on" ? "Risk-on — full size" : `${data.breadth.tone === "risk-off" ? "Risk-off" : "Mixed"} — ${data.breadth.multiplier}× risk`})
            </label>
          )}
        </Panel>

        <Panel>
          <SectionTitle meta={capital ? `capital ₹${fmt(capital, 0)}${settings?.capital ? "" : " (portfolio value — set yours below)"}` : null}>Position</SectionTitle>
          {!plan ? (
            <p className="text-sm py-6 text-center" style={{ color: "var(--text-muted)" }}>
              {!capital ? "Set your trading capital below (or add holdings) to size trades." : st >= e ? "The stop must be below the entry." : "Enter a symbol, entry and stop."}
            </p>
          ) : (
            <>
              <div className="flex items-baseline gap-3 flex-wrap">
                <span className="font-mono text-4xl font-semibold" style={{ color: "var(--text)" }}>
                  {fmt(plan.shares, 0)}
                </span>
                <span className="text-sm" style={{ color: "var(--text-muted)" }}>
                  shares · {rupees(plan.positionValue)} ({fmt(plan.positionPct, 1)}% of capital)
                </span>
              </div>
              <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
                If it hits the stop ({fmt(plan.stopPct, 1)}%) you lose <b className="font-mono" style={{ color: "var(--loss)" }}>{rupees(plan.riskAmount)}</b> —{" "}
                {fmt(plan.riskPctOfCapital, 2)}% of capital
                {mult !== 1 && <> (budget {rupees(plan.riskBudget)}, {mult}× for breadth)</>}.
              </p>
              <div className="mt-3 grid grid-cols-3 gap-2">
                {plan.targets.map((t) => (
                  <div key={t.r} className="rounded-[var(--radius-sm)] border px-2.5 py-2 text-center" style={{ borderColor: "var(--border)" }}>
                    <div className="text-[10px] uppercase tracking-wider" style={{ color: "var(--text-faint)" }}>{t.r}R target</div>
                    <div className="font-mono text-sm" style={{ color: "var(--gain)" }}>₹{fmt(t.price)}</div>
                    <div className="text-[10px] font-mono" style={{ color: "var(--text-faint)" }}>+{fmt(t.pct, 1)}% · +₹{fmt(plan.riskAmount * t.r, 0)}</div>
                  </div>
                ))}
              </div>
              <ul className="mt-4 space-y-1.5">
                {checks.map((c, k) => (
                  <Check key={k} ok={c.ok} warn={c.warn}>
                    {c.text}
                  </Check>
                ))}
              </ul>
              <div className="mt-4 flex items-center gap-3 flex-wrap">
                <button type="button" onClick={addToHoldings} disabled={!plan.shares} className="text-sm font-medium px-4 py-1.5 rounded-[var(--radius-sm)]" style={{ background: "var(--accent)", color: "var(--on-accent)" }}>
                  Record as bought
                </button>
                {added && <span className="text-xs" role="status" style={{ color: "var(--gain)" }}>{added}</span>}
              </div>
            </>
          )}
        </Panel>
      </div>

      {settings && <MoneyRules initial={settings} compact={false} onSaved={() => setRulesVersion((n) => n + 1)} />}
    </div>
  );
}
