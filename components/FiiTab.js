"use client";

// FII / DII — what foreign and domestic institutions are doing.
//   Flows    daily cash buy / sell / net, month-to-date, streaks, and FII
//            positioning in index derivatives
//   Sectors  NSDL's fortnightly sector-wise FPI investment
//   Stocks   FII / DII bulk & block deals, netted per stock and per sector
// Data: app/api/fii/route.js (lib/fii.js).

import { useEffect, useMemo, useState } from "react";
import { ScreenHeader, SectionTitle, Panel, ErrorState, LoadingState, SubNav } from "@/components/ui/Chrome";
import TableFrame from "@/components/ui/TableFrame";
import SymbolLink from "@/components/SymbolLink";
import { usePersistentState } from "@/lib/usePersistentState";
import { useSortableRows } from "@/lib/useSortableRows";
import SortableTh from "@/components/SortableTh";
import { VIEW_EVENT } from "@/lib/navigation";

const VIEWS = [
  { id: "flows", label: "Flows" },
  { id: "sectors", label: "Sectors" },
  { id: "stocks", label: "Stocks" },
];
const IDS = VIEWS.map((v) => v.id);
// Distinct in both themes (the accent and tier tokens are both amber).
export const FII_COLOR = "#3b82f6";
export const DII_COLOR = "#f59e0b";

const crore = (n, { sign = true } = {}) => {
  if (n == null || !Number.isFinite(n)) return "—";
  const s = Math.abs(n) >= 1000 ? Math.round(Math.abs(n)).toLocaleString("en-IN") : Math.abs(n).toLocaleString("en-IN", { maximumFractionDigits: 1 });
  return `${sign ? (n > 0 ? "+" : n < 0 ? "−" : "") : n < 0 ? "−" : ""}₹${s} Cr`;
};
const tone = (n) => (n > 0 ? "var(--gain)" : n < 0 ? "var(--loss)" : "var(--text-muted)");
const contracts = (n) => (n == null ? "—" : `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toLocaleString("en-IN")}`);
const shortDate = (iso) => (iso ? new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" }) : "—");

function Tile({ label, value, sub, color }) {
  return (
    <div className="rounded-[var(--radius)] border p-3" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
      <p className="text-[10px] uppercase tracking-wide" style={{ color: "var(--text-faint)" }}>
        {label}
      </p>
      <p className="font-mono text-lg mt-0.5" style={{ color: color ?? "var(--text)" }}>
        {value}
      </p>
      {sub && (
        <p className="text-[11px] mt-0.5" style={{ color: "var(--text-muted)" }}>
          {sub}
        </p>
      )}
    </div>
  );
}

/** Diverging daily bars: FII and DII net side by side for each session. */
function NetBars({ days }) {
  const rows = days.slice(-30);
  const max = Math.max(1, ...rows.flatMap((d) => [Math.abs(d.fii?.net ?? 0), Math.abs(d.dii?.net ?? 0)]));
  const W = 720;
  const H = 180;
  const mid = H / 2;
  const slot = W / Math.max(rows.length, 1);
  const bw = Math.max(2, Math.min(10, slot / 2 - 2));
  return (
    <svg viewBox={`0 0 ${W} ${H + 18}`} className="w-full h-auto" role="img" aria-label="Daily FII and DII net buying, last 30 sessions">
      <line x1="0" x2={W} y1={mid} y2={mid} stroke="var(--border-strong)" strokeWidth="1" />
      {rows.map((d, i) => {
        const x = i * slot + slot / 2;
        const bar = (v, dx, color) => {
          if (v == null) return null;
          const h = (Math.abs(v) / max) * (mid - 6);
          return <rect x={x + dx} y={v >= 0 ? mid - h : mid} width={bw} height={Math.max(1, h)} rx="1" fill={color} opacity={v >= 0 ? 0.95 : 0.6} />;
        };
        return (
          <g key={d.date}>
            <title>{`${d.date} · FII ${crore(d.fii?.net)} · DII ${crore(d.dii?.net)}`}</title>
            <rect x={x - slot / 2} y="0" width={slot} height={H} fill="transparent" />
            {bar(d.fii?.net, -bw - 1, FII_COLOR)}
            {bar(d.dii?.net, 1, DII_COLOR)}
            {(i === 0 || i === rows.length - 1 || i % 5 === 0) && (
              <text x={x} y={H + 13} textAnchor="middle" fontSize="8" fill="var(--text-faint)">
                {shortDate(d.date)}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

/** Small series of fortnightly nets as bars (oldest → newest). */
function Spark({ values }) {
  const max = Math.max(1, ...values.map((v) => Math.abs(v ?? 0)));
  const W = 96;
  const H = 22;
  const slot = W / Math.max(values.length, 1);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} aria-hidden>
      <line x1="0" x2={W} y1={H / 2} y2={H / 2} stroke="var(--border)" strokeWidth="1" />
      {values.map((v, i) => {
        if (v == null) return null;
        const h = (Math.abs(v) / max) * (H / 2 - 1);
        return <rect key={i} x={i * slot + 1} y={v >= 0 ? H / 2 - h : H / 2} width={Math.max(2, slot - 2)} height={Math.max(1, h)} fill={v >= 0 ? "var(--gain)" : "var(--loss)"} />;
      })}
    </svg>
  );
}

function Legend() {
  return (
    <span className="inline-flex items-center gap-3 text-[11px]" style={{ color: "var(--text-muted)" }}>
      <span className="inline-flex items-center gap-1">
        <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: FII_COLOR }} /> FII
      </span>
      <span className="inline-flex items-center gap-1">
        <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: DII_COLOR }} /> DII
      </span>
    </span>
  );
}

// ---------------------------------------------------------------------

const pct = (n, d = 2) => (n == null ? "—" : `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toFixed(d)}%`);
const lakhs = (n) => (n == null ? "—" : `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toLocaleString("en-IN")}`);

function ExpiryTag({ kind }) {
  if (!kind) return null;
  return (
    <span
      className="ml-1.5 px-1 rounded text-[9px] font-sans font-semibold uppercase tracking-wide align-middle"
      style={kind === "monthly" ? { background: "var(--loss)", color: "#fff" } : { background: "var(--tier-mid)", color: "var(--on-accent)" }}
      title={`${kind === "monthly" ? "Monthly" : "Weekly"} NIFTY expiry — open interest and flows this day are distorted by positions expiring and rolling over`}
    >
      {kind === "monthly" ? "M-expiry" : "expiry"}
    </span>
  );
}

function Mkt({ nifty, vix }) {
  return (
    <>
      <td className="py-2 px-2 text-right">{nifty?.c != null ? Math.round(nifty.c).toLocaleString("en-IN") : "—"}</td>
      <td className="py-2 px-2 text-right" style={{ color: tone(nifty?.chg) }}>{pct(nifty?.chg)}</td>
      <td className="py-2 px-2 text-right">{vix?.c != null ? vix.c.toFixed(2) : "—"}</td>
      <td className="py-2 px-2 text-right" style={{ color: tone(-(vix?.chg ?? 0)) }} title="VIX up = fear rising">{pct(vix?.chg)}</td>
    </>
  );
}

const Chg = ({ v, invert = false }) =>
  v == null || v === 0 ? null : (
    <span className="block text-[10px]" style={{ color: tone(invert ? -v : v) }}>
      {lakhs(v)}
    </span>
  );

/** FII index-futures long % (left axis) against NIFTY (right axis), with the 20 / 30 / 60 % zones and expiry days. */
function LongPctChart({ days }) {
  const rows = days.filter((d) => d.fii?.longPct != null).slice(-60);
  if (rows.length < 3) return null;
  const W = 760;
  const H = 230;
  const L = 34;
  const R = 52;
  const T = 10;
  const B = 24;
  const iw = W - L - R;
  const ih = H - T - B;
  const x = (i) => L + (rows.length === 1 ? iw / 2 : (i / (rows.length - 1)) * iw);
  const lp = rows.map((d) => d.fii.longPct);
  const lo = Math.max(0, Math.floor(Math.min(15, ...lp) / 5) * 5);
  const hi = Math.min(100, Math.ceil(Math.max(65, ...lp) / 5) * 5);
  const yL = (v) => T + ih - ((v - lo) / (hi - lo)) * ih;
  const nv = rows.map((d) => d.nifty?.c).filter((v) => v != null);
  const nlo = nv.length ? Math.min(...nv) : 0;
  const nhi = nv.length ? Math.max(...nv) : 1;
  const pad = (nhi - nlo) * 0.08 || 1;
  const yR = (v) => T + ih - ((v - (nlo - pad)) / (nhi + pad - (nlo - pad))) * ih;
  const path = (pts) => pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join("");
  const lpPath = path(rows.map((d, i) => [x(i), yL(d.fii.longPct)]));
  const nPath = path(rows.map((d, i) => (d.nifty?.c != null ? [x(i), yR(d.nifty.c)] : null)).filter(Boolean));
  const band = (a, b, color) => <rect x={L} width={iw} y={yL(Math.min(b, hi))} height={Math.max(0, yL(Math.max(a, lo)) - yL(Math.min(b, hi)))} fill={color} opacity="0.08" />;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="FII index futures long percentage against NIFTY 50">
      {band(lo, 20, "var(--loss)")}
      {band(20, 30, "var(--tier-mid)")}
      {band(60, hi, "var(--gain)")}
      {[20, 30, 50, 60].filter((v) => v > lo && v < hi).map((v) => (
        <g key={v}>
          <line x1={L} x2={L + iw} y1={yL(v)} y2={yL(v)} stroke="var(--border)" strokeDasharray={v === 50 ? "0" : "3 3"} />
          <text x={L - 4} y={yL(v) + 3} fontSize="9" textAnchor="end" fill="var(--text-faint)">{v}%</text>
        </g>
      ))}
      {rows.map((d, i) =>
        d.expiry ? <line key={d.date} x1={x(i)} x2={x(i)} y1={T} y2={T + ih} stroke={d.expiry === "monthly" ? "var(--loss)" : "var(--tier-mid)"} strokeOpacity="0.45" strokeDasharray="2 3" /> : null
      )}
      <path d={nPath} fill="none" stroke="var(--text-muted)" strokeWidth="1.5" />
      <path d={lpPath} fill="none" stroke={FII_COLOR} strokeWidth="2.25" />
      {rows.map((d, i) => (
        <circle key={d.date} cx={x(i)} cy={yL(d.fii.longPct)} r="2.2" fill={FII_COLOR}>
          <title>{`${d.date}${d.expiry ? ` (${d.expiry} expiry)` : ""} · FII long ${d.fii.longPct}% · NIFTY ${d.nifty?.c != null ? Math.round(d.nifty.c).toLocaleString("en-IN") : "—"} ${pct(d.nifty?.chg)}`}</title>
        </circle>
      ))}
      {nv.length > 0 && (
        <>
          <text x={L + iw + 4} y={yR(nhi) + 3} fontSize="9" fill="var(--text-faint)">{Math.round(nhi).toLocaleString("en-IN")}</text>
          <text x={L + iw + 4} y={yR(nlo) + 3} fontSize="9" fill="var(--text-faint)">{Math.round(nlo).toLocaleString("en-IN")}</text>
        </>
      )}
      {[0, Math.floor(rows.length / 2), rows.length - 1].map((i) => (
        <text key={i} x={x(i)} y={H - 6} fontSize="9" textAnchor="middle" fill="var(--text-faint)">{shortDate(rows[i].date)}</text>
      ))}
    </svg>
  );
}

const WHO = [
  ["fii", "FII"],
  ["client", "Client (retail)"],
  ["pro", "Pro (prop desks)"],
  ["dii", "DII"],
];

function FlowsView({ data }) {
  const c = data.cash;
  const o = data.oi;
  const l = c.latest;
  const ol = o.latest;
  const streak = c.fiiStreak;
  const s = c.sinceStart;
  const lp = ol?.fii?.longPct;
  return (
    <div className="flex flex-col gap-6">
      {l ? (
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2">
          <Tile label={<>FII · {shortDate(l.date)}<ExpiryTag kind={l.expiry} /></>} value={crore(l.fii?.net)} color={tone(l.fii?.net)} sub={`bought ${crore(l.fii?.buy, { sign: false })} · sold ${crore(l.fii?.sell, { sign: false })}`} />
          <Tile label={`DII · ${shortDate(l.date)}`} value={crore(l.dii?.net)} color={tone(l.dii?.net)} sub={`bought ${crore(l.dii?.buy, { sign: false })} · sold ${crore(l.dii?.sell, { sign: false })}`} />
          <Tile
            label={`NIFTY 50 · ${shortDate(l.date)}`}
            value={l.nifty?.c != null ? Math.round(l.nifty.c).toLocaleString("en-IN") : "—"}
            color={tone(l.nifty?.chg)}
            sub={l.nifty?.chg != null ? `${pct(l.nifty.chg)} on the day` : "close not in yet"}
          />
          <Tile
            label={`India VIX · ${shortDate(l.date)}`}
            value={l.vix?.c != null ? l.vix.c.toFixed(2) : "—"}
            color={tone(-(l.vix?.chg ?? 0))}
            sub={l.vix?.chg != null ? `${pct(l.vix.chg)} — ${l.vix.chg > 0 ? "fear rising" : "fear easing"}` : null}
          />
          {s ? (
            <Tile
              label={`Since tracking began · ${s.sessions} session${s.sessions === 1 ? "" : "s"}`}
              value={crore(s.fii)}
              color={tone(s.fii)}
              sub={`FII since ${shortDate(s.from)} · DII ${crore(s.dii)}`}
            />
          ) : (
            <Tile label="FII this month" value={crore(c.mtd.fii)} color={tone(c.mtd.fii)} sub={`DII ${crore(c.mtd.dii)} · last 5 sessions FII ${crore(c.last5.fii)}`} />
          )}
          <Tile
            label="FII streak"
            value={streak ? `${Math.abs(streak)} day${Math.abs(streak) === 1 ? "" : "s"}` : "—"}
            color={tone(streak)}
            sub={streak > 0 ? "net buyers in a row" : streak < 0 ? "net sellers in a row" : null}
          />
        </div>
      ) : (
        <Panel>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            NSE&apos;s FII/DII cash figures haven&apos;t been fetched yet — they&apos;re picked up after the close.
          </p>
        </Panel>
      )}
      {l?.expiry && (
        <p className="text-xs rounded-[var(--radius-sm)] px-3 py-2 -mt-3" style={{ background: "var(--surface-2)", color: "var(--tier-mid)" }}>
          ⚠ {shortDate(l.date)} was a {l.expiry} NIFTY expiry. Flows and especially derivatives positions that day are dominated by contracts
          expiring and rolling over — read the next session before drawing conclusions.
        </p>
      )}

      {c.days.length > 0 && (
        <div>
          <SectionTitle meta={<Legend />}>Daily net buying — cash market</SectionTitle>
          <Panel>
            {c.days.length >= 3 ? <NetBars days={c.days} /> : null}
            {c.historyDays < 20 && (
              <p className="text-[11px] mt-2" style={{ color: "var(--text-faint)" }}>
                NSE only publishes the latest day&apos;s FII/DII cash figures, so Panel stores each day as it comes — {c.historyDays} session
                {c.historyDays === 1 ? "" : "s"}{" "}so far. NIFTY, VIX and the derivatives data below are backfilled from NSE&apos;s archive.
              </p>
            )}
          </Panel>
        </div>
      )}

      {c.days.length > 0 && (
        <div className="rounded-[var(--radius)] border overflow-hidden" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
          <TableFrame name="fii-cash">
            <table className="w-full text-xs border-collapse font-mono">
              <thead>
                <tr className="text-right border-b font-sans" style={{ borderColor: "var(--border)", color: "var(--text-faint)" }}>
                  <th className="py-2 pl-4 pr-2 font-medium text-left">Date</th>
                  <th className="py-2 px-2 font-medium">FII net</th>
                  <th className="py-2 px-2 font-medium">DII net</th>
                  <th className="py-2 px-2 font-medium">Combined</th>
                  <th className="py-2 px-2 font-medium">NIFTY</th>
                  <th className="py-2 px-2 font-medium">%</th>
                  <th className="py-2 px-2 font-medium">VIX</th>
                  <th className="py-2 px-2 font-medium">%</th>
                  <th className="py-2 px-2 font-medium">FII buy</th>
                  <th className="py-2 px-2 pr-4 font-medium">FII sell</th>
                </tr>
              </thead>
              <tbody>
                {[...c.days].reverse().slice(0, 40).map((d) => (
                  <tr key={d.date} className="border-b last:border-b-0 text-right" style={{ borderColor: "var(--border)" }}>
                    <td className="py-2 pl-4 pr-2 text-left whitespace-nowrap" style={{ color: "var(--text-muted)" }}>
                      {d.date}
                      <ExpiryTag kind={d.expiry} />
                    </td>
                    <td className="py-2 px-2" style={{ color: tone(d.fii?.net) }}>{crore(d.fii?.net)}</td>
                    <td className="py-2 px-2" style={{ color: tone(d.dii?.net) }}>{crore(d.dii?.net)}</td>
                    <td className="py-2 px-2" style={{ color: tone((d.fii?.net ?? 0) + (d.dii?.net ?? 0)) }}>{crore((d.fii?.net ?? 0) + (d.dii?.net ?? 0))}</td>
                    <Mkt nifty={d.nifty} vix={d.vix} />
                    <td className="py-2 px-2" style={{ color: "var(--text-muted)" }}>{crore(d.fii?.buy, { sign: false })}</td>
                    <td className="py-2 px-2 pr-4" style={{ color: "var(--text-muted)" }}>{crore(d.fii?.sell, { sign: false })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableFrame>
        </div>
      )}

      <div>
        <SectionTitle meta="NSE participant-wise open interest, index derivatives, contracts">Who is positioned how</SectionTitle>
        {ol ? (
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <Tile
                label={<>FII index futures long % · {shortDate(ol.date)}<ExpiryTag kind={ol.expiry} /></>}
                value={lp != null ? `${lp}%` : "—"}
                color={lp >= 60 ? "var(--gain)" : lp <= 30 ? "var(--loss)" : "var(--text)"}
                sub={ol.chg?.fii?.longPct != null ? `${ol.chg.fii.longPct >= 0 ? "+" : ""}${ol.chg.fii.longPct} pts vs previous day` : null}
              />
              <Tile label="FII futures net" value={contracts(ol.fii?.futNet)} color={tone(ol.fii?.futNet)} sub={ol.chg?.fii ? `${contracts(ol.chg.fii.futNet)} vs previous day` : null} />
              <Tile label="FII calls net" value={contracts(ol.fii?.callNet)} color={tone(ol.fii?.callNet)} sub={ol.chg?.fii ? `${contracts(ol.chg.fii.callNet)} vs previous day` : null} />
              <Tile label="FII puts net" value={contracts(ol.fii?.putNet)} color={tone(-(ol.fii?.putNet ?? 0))} sub={ol.chg?.fii ? `${contracts(ol.chg.fii.putNet)} vs previous day · long puts = hedging` : null} />
            </div>
            <p className="text-[11px] leading-relaxed" style={{ color: "var(--text-muted)" }}>
              <b>Reading FII long %:</b> above ~60% has historically gone with a supportive market; under ~30% means FIIs are heavily hedged or
              bearish. <b>At ~20% or lower it turns into a contrarian warning</b> — shorts that crowded can fuel sharp short-covering rallies when
              the market refuses to fall. Retail (Client) usually sits on the other side.
              {lp != null && lp <= 20 && <span style={{ color: "var(--loss)" }}> FIIs are at {lp}% now — crowded-short territory.</span>}
            </p>

            <Panel>
              <p className="text-[11px] mb-1 flex items-center gap-3 flex-wrap" style={{ color: "var(--text-muted)" }}>
                <span className="inline-flex items-center gap-1"><span className="inline-block w-3 h-0.5" style={{ background: FII_COLOR }} /> FII index futures long %</span>
                <span className="inline-flex items-center gap-1"><span className="inline-block w-3 h-0.5" style={{ background: "var(--text-muted)" }} /> NIFTY 50 (right axis)</span>
                <span>dashed lines = expiry days</span>
              </p>
              <LongPctChart days={o.days} />
            </Panel>

            <div className="rounded-[var(--radius)] border overflow-hidden" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
              <div className="px-4 pt-3 text-xs font-medium" style={{ color: "var(--text)" }}>
                {shortDate(ol.date)} — every participant, with the change from the previous session
              </div>
              <TableFrame name="fii-parties">
                <table className="w-full text-xs border-collapse font-mono">
                  <thead>
                    <tr className="text-right border-b font-sans" style={{ borderColor: "var(--border)", color: "var(--text-faint)" }}>
                      <th className="py-2 pl-4 pr-2 font-medium text-left">Participant</th>
                      <th className="py-2 px-2 font-medium">Futures net</th>
                      <th className="py-2 px-2 font-medium">Long %</th>
                      <th className="py-2 px-2 font-medium">Calls net</th>
                      <th className="py-2 px-2 font-medium">Puts net</th>
                      <th className="py-2 px-2 pr-4 font-medium">Stock fut Δ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {WHO.map(([k, label]) => {
                      const p = ol[k];
                      const ch = ol.chg?.[k];
                      if (!p) return null;
                      return (
                        <tr key={k} className="border-b last:border-b-0 text-right align-top" style={{ borderColor: "var(--border)" }}>
                          <td className="py-2 pl-4 pr-2 text-left font-sans" style={{ color: k === "fii" ? FII_COLOR : "var(--text)" }}>{label}</td>
                          <td className="py-2 px-2" style={{ color: tone(p.futNet) }}>{contracts(p.futNet)}<Chg v={ch?.futNet} /></td>
                          <td className="py-2 px-2">{p.longPct != null ? `${p.longPct}%` : "—"}{ch?.longPct ? <span className="block text-[10px]" style={{ color: tone(ch.longPct) }}>{ch.longPct > 0 ? "+" : ""}{ch.longPct} pts</span> : null}</td>
                          <td className="py-2 px-2" style={{ color: tone(p.callNet) }}>{contracts(p.callNet)}<Chg v={ch?.callNet} /></td>
                          <td className="py-2 px-2" style={{ color: tone(-p.putNet) }}>{contracts(p.putNet)}<Chg v={ch?.putNet} invert /></td>
                          <td className="py-2 px-2 pr-4" style={{ color: tone(ch?.stkFutNet) }} title="Day-on-day change only — the level is distorted by arbitrage funds">{ch ? contracts(ch.stkFutNet) : "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </TableFrame>
              <div className="px-4 py-2 text-[11px] border-t" style={{ borderColor: "var(--border)", color: ol.check?.ok ? "var(--gain)" : "var(--loss)" }}>
                {ol.check?.ok
                  ? "✓ Data check passed — the four participants' nets add up to zero (every contract has a buyer and a seller)."
                  : ol.check?.missing
                  ? `✗ Data check: ${ol.check.missing.join(", ")} missing from NSE's file for this day — figures may be incomplete.`
                  : `✗ Data check failed — the nets add up to futures ${contracts(ol.check?.fut)}, calls ${contracts(ol.check?.call)}, puts ${contracts(ol.check?.put)} instead of 0. NSE's file may have changed format; treat this day's figures with caution.`}
                {o.checkFailures?.length > 0 && !(o.checkFailures.length === 1 && o.checkFailures[0] === ol.date) && (
                  <span style={{ color: "var(--loss)" }}> Other days failing: {o.checkFailures.filter((d) => d !== ol.date).slice(-5).join(", ")}.</span>
                )}
              </div>
            </div>

            <div className="rounded-[var(--radius)] border overflow-hidden" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
              <div className="px-4 pt-3 text-xs font-medium" style={{ color: "var(--text)" }}>
                FII gross positions — adding or covering? <span className="font-normal" style={{ color: "var(--text-faint)" }}>(small number = change from the previous session)</span>
              </div>
              <TableFrame name="fii-oi">
                <table className="w-full text-xs border-collapse font-mono">
                  <thead>
                    <tr className="text-right border-b font-sans" style={{ borderColor: "var(--border)", color: "var(--text-faint)" }}>
                      <th className="py-2 pl-4 pr-2 font-medium text-left">Date</th>
                      <th className="py-2 px-2 font-medium">Long %</th>
                      <th className="py-2 px-2 font-medium">Fut long</th>
                      <th className="py-2 px-2 font-medium">Fut short</th>
                      <th className="py-2 px-2 font-medium">Call long</th>
                      <th className="py-2 px-2 font-medium">Call short</th>
                      <th className="py-2 px-2 font-medium">Put long</th>
                      <th className="py-2 px-2 font-medium">Put short</th>
                      <th className="py-2 px-2 font-medium">Client fut net</th>
                      <th className="py-2 px-2 font-medium">Stock fut Δ</th>
                      <th className="py-2 px-2 font-medium">NIFTY %</th>
                      <th className="py-2 px-2 pr-4 font-medium">VIX</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...o.days].reverse().slice(0, 25).map((d) => {
                      const f = d.fii;
                      const ch = d.chg?.fii;
                      if (!f) return null;
                      return (
                        <tr key={d.date} className="border-b last:border-b-0 text-right align-top" style={{ borderColor: "var(--border)", background: d.expiry ? "var(--hover-soft)" : undefined }}>
                          <td className="py-2 pl-4 pr-2 text-left whitespace-nowrap" style={{ color: "var(--text-muted)" }}>
                            {d.date}
                            <ExpiryTag kind={d.expiry} />
                            {!d.check?.ok && <span className="ml-1" style={{ color: "var(--loss)" }} title="Participants' nets don't add up to zero for this day">⚠</span>}
                          </td>
                          <td className="py-2 px-2" style={{ color: f.longPct >= 60 ? "var(--gain)" : f.longPct <= 30 ? "var(--loss)" : undefined }}>{f.longPct != null ? `${f.longPct}%` : "—"}</td>
                          <td className="py-2 px-2">{f.futLong.toLocaleString("en-IN")}<Chg v={ch?.futLong} /></td>
                          <td className="py-2 px-2">{f.futShort.toLocaleString("en-IN")}<Chg v={ch?.futShort} invert /></td>
                          <td className="py-2 px-2">{f.callLong.toLocaleString("en-IN")}<Chg v={ch?.callLong} /></td>
                          <td className="py-2 px-2">{f.callShort.toLocaleString("en-IN")}<Chg v={ch?.callShort} invert /></td>
                          <td className="py-2 px-2">{f.putLong.toLocaleString("en-IN")}<Chg v={ch?.putLong} invert /></td>
                          <td className="py-2 px-2">{f.putShort.toLocaleString("en-IN")}<Chg v={ch?.putShort} /></td>
                          <td className="py-2 px-2" style={{ color: tone(d.client?.futNet) }}>{contracts(d.client?.futNet)}<Chg v={d.chg?.client?.futNet} /></td>
                          <td className="py-2 px-2" style={{ color: tone(ch?.stkFutNet) }}>{ch ? contracts(ch.stkFutNet) : "—"}</td>
                          <td className="py-2 px-2" style={{ color: tone(d.nifty?.chg) }}>{pct(d.nifty?.chg)}</td>
                          <td className="py-2 px-2 pr-4">{d.vix?.c != null ? d.vix.c.toFixed(1) : "—"}<span className="block text-[10px]" style={{ color: tone(-(d.vix?.chg ?? 0)) }}>{d.vix?.chg != null ? pct(d.vix.chg, 1) : ""}</span></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </TableFrame>
              <p className="px-4 py-2 text-[11px] leading-relaxed border-t" style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}>
                <b>Adding vs covering:</b> futures net rising with <i>fut long</i> going up = fresh buying; with <i>fut short</i> going down = short
                covering (weaker conviction). The same for options — a call net change driven by <i>call short</i> falling is FIIs covering short
                calls, not buying calls. Green / red on the small numbers is bullish / bearish for the market, not up / down.
              </p>
            </div>
          </div>
        ) : (
          <Panel>
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              NSE&apos;s participant open-interest file couldn&apos;t be read yet.
            </p>
          </Panel>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------

function SectorsView({ data, windowId }) {
  const s = data.sectors;
  const rows = useMemo(() => s.table.map((r) => ({ ...r, key: r.name })), [s.table]);
  const { sorted, sort, onSort } = useSortableRows(rows, "last", "desc");
  const deal = data.deals.windows[windowId]?.fii;
  const top = [...s.table].filter((r) => r.last != null).sort((a, b) => b.last - a.last);
  return (
    <div className="flex flex-col gap-6">
      {s.table.length > 0 ? (
        <>
          <div className="grid gap-2 md:grid-cols-2">
            <Panel>
              <p className="text-[11px] uppercase tracking-wide mb-1.5" style={{ color: "var(--gain)" }}>
                FPIs bought most · {s.latestLabel}
              </p>
              {top.slice(0, 5).filter((r) => r.last > 0).map((r) => (
                <p key={r.name} className="text-xs flex justify-between gap-3 py-0.5">
                  <span style={{ color: "var(--text)" }}>{r.name}</span>
                  <span className="font-mono" style={{ color: "var(--gain)" }}>{crore(r.last)}</span>
                </p>
              ))}
            </Panel>
            <Panel>
              <p className="text-[11px] uppercase tracking-wide mb-1.5" style={{ color: "var(--loss)" }}>
                FPIs sold most · {s.latestLabel}
              </p>
              {[...top].reverse().slice(0, 5).filter((r) => r.last < 0).map((r) => (
                <p key={r.name} className="text-xs flex justify-between gap-3 py-0.5">
                  <span style={{ color: "var(--text)" }}>{r.name}</span>
                  <span className="font-mono" style={{ color: "var(--loss)" }}>{crore(r.last)}</span>
                </p>
              ))}
            </Panel>
          </div>
          <div>
            <SectionTitle meta="NSDL, net equity investment by FPIs, ₹ Cr — published fortnightly">Sector-wise FPI flows</SectionTitle>
            <div className="rounded-[var(--radius)] border overflow-hidden" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
              <TableFrame name="fii-sectors">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="border-b" style={{ borderColor: "var(--border)", color: "var(--text-faint)" }}>
                      <SortableTh label="Sector" sortKey="name" sort={sort} onSort={onSort} align="left" className="pl-4" />
                      <SortableTh label={s.latestLabel ?? "Latest"} sortKey="last" sort={sort} onSort={onSort} />
                      <SortableTh label="Previous" sortKey="prev" sort={sort} onSort={onSort} />
                      <SortableTh label="3 months" sortKey="sum3m" sort={sort} onSort={onSort} title="Last 6 fortnights" />
                      <SortableTh label="6 months" sortKey="sum6m" sort={sort} onSort={onSort} title="Last 12 fortnights (as many as stored)" />
                      <SortableTh label="FPI holding (AUC)" sortKey="auc" sort={sort} onSort={onSort} />
                      <th className="py-2 px-2 pr-4 font-medium text-left">Trend</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sorted.map((r) => (
                      <tr key={r.name} className="border-b last:border-b-0" style={{ borderColor: "var(--border)" }}>
                        <td className="py-2 pl-4 pr-2" style={{ color: "var(--text)" }}>{r.name}</td>
                        <td className="py-2 px-2 text-right font-mono" style={{ color: tone(r.last) }}>{crore(r.last)}</td>
                        <td className="py-2 px-2 text-right font-mono" style={{ color: tone(r.prev) }}>{crore(r.prev)}</td>
                        <td className="py-2 px-2 text-right font-mono" style={{ color: tone(r.sum3m) }}>{crore(r.sum3m)}</td>
                        <td className="py-2 px-2 text-right font-mono" style={{ color: tone(r.sum6m) }}>{crore(r.sum6m)}</td>
                        <td className="py-2 px-2 text-right font-mono" style={{ color: "var(--text-muted)" }}>{crore(r.auc, { sign: false })}</td>
                        <td className="py-2 px-2 pr-4" title={s.labels.join(" → ")}>
                          <Spark values={r.series} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableFrame>
            </div>
          </div>
        </>
      ) : (
        <Panel>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            NSDL&apos;s fortnightly sector report hasn&apos;t been read yet. It&apos;s published a few days after the 15th and the month-end, and
            the nightly run picks it up.
          </p>
        </Panel>
      )}

      {deal?.sectors?.length > 0 && (
        <div>
          <SectionTitle meta="FII bulk & block deals, grouped by Panel's sectors">Sectors in FII deals</SectionTitle>
          <Panel>
            {deal.sectors.slice(0, 12).map((g) => (
              <p key={g.key} className="text-xs flex justify-between gap-3 py-0.5">
                <span style={{ color: "var(--text)" }}>{g.key}</span>
                <span className="font-mono" style={{ color: tone(g.netCr) }}>
                  {crore(g.netCr)} <span style={{ color: "var(--text-faint)" }}>· {g.deals} deals</span>
                </span>
              </p>
            ))}
          </Panel>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------

function DealTable({ rows, title, color, name }) {
  const { sorted, sort, onSort } = useSortableRows(rows, "netCr", title.includes("sold") ? "asc" : "desc");
  return (
    <div>
      <SectionTitle meta={`${rows.length} stock${rows.length === 1 ? "" : "s"}`}>
        <span style={{ color }}>{title}</span>
      </SectionTitle>
      <div className="rounded-[var(--radius)] border overflow-hidden" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
        <TableFrame name={name}>
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="border-b" style={{ borderColor: "var(--border)", color: "var(--text-faint)" }}>
                <SortableTh label="Symbol" sortKey="symbol" sort={sort} onSort={onSort} align="left" className="pl-4" />
                <SortableTh label="Net" sortKey="netCr" sort={sort} onSort={onSort} />
                <SortableTh label="Bought" sortKey="buyCr" sort={sort} onSort={onSort} />
                <SortableTh label="Sold" sortKey="sellCr" sort={sort} onSort={onSort} />
                <SortableTh label="Deals" sortKey="deals" sort={sort} onSort={onSort} />
                <SortableTh label="Last" sortKey="last" sort={sort} onSort={onSort} className="pr-4" />
              </tr>
            </thead>
            <tbody>
              {sorted.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-4 px-4 text-xs" style={{ color: "var(--text-faint)" }}>
                    None in this window.
                  </td>
                </tr>
              )}
              {sorted.slice(0, 40).map((r) => (
                <tr key={r.symbol} className="border-b last:border-b-0" style={{ borderColor: "var(--border)" }} title={r.clients.join("\n")}>
                  <td className="py-2 pl-4 pr-2">
                    <SymbolLink symbol={r.symbol} className="text-xs" showEvents={false} />
                    <span className="block text-[10px] truncate max-w-[11rem]" style={{ color: "var(--text-faint)" }}>
                      {r.sector ?? r.clients[0]}
                    </span>
                  </td>
                  <td className="py-2 px-2 text-right font-mono" style={{ color: tone(r.netCr) }}>{crore(r.netCr)}</td>
                  <td className="py-2 px-2 text-right font-mono" style={{ color: "var(--text-muted)" }}>{r.buyCr ? crore(r.buyCr, { sign: false }) : "—"}</td>
                  <td className="py-2 px-2 text-right font-mono" style={{ color: "var(--text-muted)" }}>{r.sellCr ? crore(r.sellCr, { sign: false }) : "—"}</td>
                  <td className="py-2 px-2 text-right font-mono">{r.deals}</td>
                  <td className="py-2 px-2 pr-4 text-right font-mono" style={{ color: "var(--text-muted)" }}>{shortDate(r.last)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableFrame>
      </div>
    </div>
  );
}

function StocksView({ data, windowId, who }) {
  const v = data.deals.windows[windowId]?.[who];
  const recent = data.deals.recent.filter((x) => x.w === who.toUpperCase());
  if (!v) return null;
  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <Tile label={`${who.toUpperCase()} bought (deals)`} value={crore(v.buyCr, { sign: false })} color="var(--gain)" />
        <Tile label={`${who.toUpperCase()} sold (deals)`} value={crore(v.sellCr, { sign: false })} color="var(--loss)" />
        <Tile label="Net" value={crore((v.buyCr ?? 0) - (v.sellCr ?? 0))} color={tone((v.buyCr ?? 0) - (v.sellCr ?? 0))} />
        <Tile label="Deals" value={v.count} sub={`${v.bought.length} stocks net bought · ${v.sold.length} net sold`} />
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <DealTable rows={v.bought.map((r) => ({ ...r, key: r.symbol }))} title={`${who.toUpperCase()} net bought`} color="var(--gain)" name={`fii-bought-${who}`} />
        <DealTable rows={v.sold.map((r) => ({ ...r, key: r.symbol }))} title={`${who.toUpperCase()} net sold`} color="var(--loss)" name={`fii-sold-${who}`} />
      </div>
      {recent.length > 0 && (
        <div>
          <SectionTitle meta="Most recent first">Latest {who.toUpperCase()} deals</SectionTitle>
          <div className="rounded-[var(--radius)] border overflow-hidden" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
            <TableFrame name={`fii-recent-${who}`}>
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="border-b text-left" style={{ borderColor: "var(--border)", color: "var(--text-faint)" }}>
                    <th className="py-2 pl-4 pr-2 font-medium">Date</th>
                    <th className="py-2 px-2 font-medium">Symbol</th>
                    <th className="py-2 px-2 font-medium">Client</th>
                    <th className="py-2 px-2 font-medium">Side</th>
                    <th className="py-2 px-2 font-medium text-right">Qty</th>
                    <th className="py-2 px-2 font-medium text-right">Price</th>
                    <th className="py-2 px-2 font-medium text-right">Value</th>
                    <th className="py-2 px-2 pr-4 font-medium">Type</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.slice(0, 40).map((x, i) => (
                    <tr key={`${x.d}-${x.s}-${i}`} className="border-b last:border-b-0" style={{ borderColor: "var(--border)" }}>
                      <td className="py-2 pl-4 pr-2 font-mono" style={{ color: "var(--text-muted)" }}>{x.d}</td>
                      <td className="py-2 px-2"><SymbolLink symbol={x.s} className="text-xs" showEvents={false} /></td>
                      <td className="py-2 px-2 max-w-[18rem] truncate" style={{ color: "var(--text-muted)" }} title={x.c}>{x.c}</td>
                      <td className="py-2 px-2" style={{ color: x.side === "B" ? "var(--gain)" : "var(--loss)" }}>{x.side === "B" ? "Buy" : "Sell"}</td>
                      <td className="py-2 px-2 text-right font-mono">{x.q.toLocaleString("en-IN")}</td>
                      <td className="py-2 px-2 text-right font-mono">₹{x.p.toLocaleString("en-IN")}</td>
                      <td className="py-2 px-2 text-right font-mono">{crore(x.cr, { sign: false })}</td>
                      <td className="py-2 px-2 pr-4" style={{ color: "var(--text-faint)" }}>{x.k}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableFrame>
          </div>
        </div>
      )}
      <p className="text-[11px] leading-relaxed" style={{ color: "var(--text-faint)" }}>
        Exchanges don&apos;t publish FII trades per stock. These are bulk deals (over 0.5% of a company&apos;s shares in a day) and block
        deals, with the client read as FII or DII from its name — so they show the big, disclosed institutional trades, not every
        trade. A stock missing here may still have been bought or sold in smaller amounts.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------

export default function FiiTab() {
  const [stored, setView] = usePersistentState("fii.view", "flows");
  const view = IDS.includes(stored) ? stored : "flows";
  const [windowId, setWindowId] = usePersistentState("fii.window", "1m");
  const [who, setWho] = usePersistentState("fii.who", "fii");
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/fii")
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j?.error || `Request failed (${r.status})`);
        if (!cancelled) setData(j);
      })
      .catch((e) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    function onView(e) {
      if (e.detail?.tab === "fii") setView(e.detail.view);
    }
    window.addEventListener(VIEW_EVENT, onView);
    return () => window.removeEventListener(VIEW_EVENT, onView);
  }, [setView]);

  const sel = { background: "var(--surface-2)", borderColor: "var(--border)", color: "var(--text)" };
  const windows = data?.deals?.windowList ?? [];

  return (
    <div>
      <ScreenHeader
        title="FII / DII"
        meta={data?.asOf ? `Foreign and domestic institutions · data to ${data.asOf}${data._cache?.stale ? " · refreshing" : ""}` : "Foreign and domestic institutions — flows, sectors and the stocks they trade"}
        actions={
          (view === "stocks" || view === "sectors") && windows.length > 0 ? (
            <div className="flex items-center gap-2">
              {view === "stocks" && (
                <select value={who} onChange={(e) => setWho(e.target.value)} className="rounded px-2 py-1 text-xs border" style={sel} aria-label="Institution">
                  <option value="fii">FII / FPI</option>
                  <option value="dii">DII</option>
                </select>
              )}
              <select value={windowId} onChange={(e) => setWindowId(e.target.value)} className="rounded px-2 py-1 text-xs border" style={sel} aria-label="Deals window">
                {windows.map((w) => (
                  <option key={w.id} value={w.id}>
                    Deals · {w.label}
                  </option>
                ))}
              </select>
            </div>
          ) : null
        }
      />
      <div className="mb-4 overflow-x-auto">
        <SubNav items={VIEWS} active={view} onChange={setView} />
      </div>
      {error && <ErrorState>{error}</ErrorState>}
      {!data && !error && <LoadingState>Reading NSE and NSDL institutional data…</LoadingState>}
      {data && view === "flows" && <FlowsView data={data} />}
      {data && view === "sectors" && <SectorsView data={data} windowId={windowId} />}
      {data && view === "stocks" && <StocksView data={data} windowId={windowId} who={who} />}
    </div>
  );
}
