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

function FlowsView({ data }) {
  const c = data.cash;
  const o = data.oi;
  const l = c.latest;
  const streak = c.fiiStreak;
  return (
    <div className="flex flex-col gap-6">
      {l ? (
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2">
          <Tile label={`FII · ${shortDate(l.date)}`} value={crore(l.fii?.net)} color={tone(l.fii?.net)} sub={`bought ${crore(l.fii?.buy, { sign: false })} · sold ${crore(l.fii?.sell, { sign: false })}`} />
          <Tile label={`DII · ${shortDate(l.date)}`} value={crore(l.dii?.net)} color={tone(l.dii?.net)} sub={`bought ${crore(l.dii?.buy, { sign: false })} · sold ${crore(l.dii?.sell, { sign: false })}`} />
          <Tile label="FII this month" value={crore(c.mtd.fii)} color={tone(c.mtd.fii)} sub={`${c.mtd.sessions} session${c.mtd.sessions === 1 ? "" : "s"} recorded`} />
          <Tile label="DII this month" value={crore(c.mtd.dii)} color={tone(c.mtd.dii)} sub={`${c.mtd.sessions} session${c.mtd.sessions === 1 ? "" : "s"} recorded`} />
          <Tile label={`Last ${c.last5.sessions} sessions`} value={crore(c.last5.fii)} color={tone(c.last5.fii)} sub={`DII ${crore(c.last5.dii)}`} />
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
            NSE&apos;s FII/DII cash figures haven&apos;t been fetched yet — they&apos;re picked up by the nightly run after the close.
          </p>
        </Panel>
      )}

      {c.days.length > 0 && (
        <div>
          <SectionTitle meta={<Legend />}>Daily net buying — cash market</SectionTitle>
          <Panel>
            {c.days.length >= 3 ? <NetBars days={c.days} /> : null}
            {c.historyDays < 20 && (
              <p className="text-[11px] mt-2" style={{ color: "var(--text-faint)" }}>
                NSE only publishes the latest day&apos;s FII/DII figures, so Panel stores each day as it comes — {c.historyDays} session
                {c.historyDays === 1 ? "" : "s"} so far. The history fills in automatically every trading day.
              </p>
            )}
          </Panel>
        </div>
      )}

      {c.days.length > 0 && (
        <div className="rounded-[var(--radius)] border overflow-hidden" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
          <TableFrame name="fii-cash">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="text-right border-b" style={{ borderColor: "var(--border)", color: "var(--text-faint)" }}>
                  <th className="py-2 pl-4 pr-2 font-medium text-left">Date</th>
                  <th className="py-2 px-2 font-medium">FII buy</th>
                  <th className="py-2 px-2 font-medium">FII sell</th>
                  <th className="py-2 px-2 font-medium">FII net</th>
                  <th className="py-2 px-2 font-medium">DII buy</th>
                  <th className="py-2 px-2 font-medium">DII sell</th>
                  <th className="py-2 px-2 font-medium">DII net</th>
                  <th className="py-2 px-2 pr-4 font-medium">Combined</th>
                </tr>
              </thead>
              <tbody>
                {[...c.days].reverse().slice(0, 40).map((d) => (
                  <tr key={d.date} className="border-b last:border-b-0 text-right font-mono" style={{ borderColor: "var(--border)" }}>
                    <td className="py-2 pl-4 pr-2 text-left" style={{ color: "var(--text-muted)" }}>{d.date}</td>
                    <td className="py-2 px-2" style={{ color: "var(--text-muted)" }}>{crore(d.fii?.buy, { sign: false })}</td>
                    <td className="py-2 px-2" style={{ color: "var(--text-muted)" }}>{crore(d.fii?.sell, { sign: false })}</td>
                    <td className="py-2 px-2" style={{ color: tone(d.fii?.net) }}>{crore(d.fii?.net)}</td>
                    <td className="py-2 px-2" style={{ color: "var(--text-muted)" }}>{crore(d.dii?.buy, { sign: false })}</td>
                    <td className="py-2 px-2" style={{ color: "var(--text-muted)" }}>{crore(d.dii?.sell, { sign: false })}</td>
                    <td className="py-2 px-2" style={{ color: tone(d.dii?.net) }}>{crore(d.dii?.net)}</td>
                    <td className="py-2 px-2 pr-4" style={{ color: tone((d.fii?.net ?? 0) + (d.dii?.net ?? 0)) }}>{crore((d.fii?.net ?? 0) + (d.dii?.net ?? 0))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableFrame>
        </div>
      )}

      <div>
        <SectionTitle meta="NSE participant-wise open interest, contracts">FII positioning in index derivatives</SectionTitle>
        {o.latest ? (
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <Tile
                label={`Index futures long % · ${shortDate(o.latest.date)}`}
                value={o.latest.longPct != null ? `${o.latest.longPct}%` : "—"}
                color={o.latest.longPct >= 50 ? "var(--gain)" : "var(--loss)"}
                sub={o.change ? `${o.change.longPct >= 0 ? "+" : ""}${o.change.longPct} pts vs previous day` : "share of FII index futures that are long"}
              />
              <Tile label="Index futures net" value={contracts(o.latest.futNet)} color={tone(o.latest.futNet)} sub={o.change ? `${contracts(o.change.futNet)} vs previous day` : null} />
              <Tile label="Index calls net" value={contracts(o.latest.callNet)} color={tone(o.latest.callNet)} sub="long − short calls" />
              <Tile label="Index puts net" value={contracts(o.latest.putNet)} color={tone(-o.latest.putNet)} sub="long puts = hedging / bearish" />
            </div>
            <p className="text-[11px] leading-relaxed" style={{ color: "var(--text-muted)" }}>
              Reading it: FIIs holding more than ~60% of their index futures long has historically gone with a supportive market; under
              ~30% means they are heavily hedged or bearish. Retail (&quot;Client&quot;) usually sits on the other side —{" "}
              {o.latest.clientLongPct != null ? `clients are ${o.latest.clientLongPct}% long today.` : "not reported today."}
            </p>
            <div className="rounded-[var(--radius)] border overflow-hidden" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
              <TableFrame name="fii-oi">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="text-right border-b" style={{ borderColor: "var(--border)", color: "var(--text-faint)" }}>
                      <th className="py-2 pl-4 pr-2 font-medium text-left">Date</th>
                      <th className="py-2 px-2 font-medium">Fut long</th>
                      <th className="py-2 px-2 font-medium">Fut short</th>
                      <th className="py-2 px-2 font-medium">Long %</th>
                      <th className="py-2 px-2 font-medium">Net futures</th>
                      <th className="py-2 px-2 font-medium">Calls net</th>
                      <th className="py-2 px-2 font-medium">Puts net</th>
                      <th className="py-2 px-2 pr-4 font-medium">Stock fut net</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...o.days].reverse().slice(0, 20).map((d) => (
                      <tr key={d.date} className="border-b last:border-b-0 text-right font-mono" style={{ borderColor: "var(--border)" }}>
                        <td className="py-2 pl-4 pr-2 text-left" style={{ color: "var(--text-muted)" }}>{d.date}</td>
                        <td className="py-2 px-2">{d.futLong.toLocaleString("en-IN")}</td>
                        <td className="py-2 px-2">{d.futShort.toLocaleString("en-IN")}</td>
                        <td className="py-2 px-2" style={{ color: d.longPct >= 50 ? "var(--gain)" : "var(--loss)" }}>{d.longPct != null ? `${d.longPct}%` : "—"}</td>
                        <td className="py-2 px-2" style={{ color: tone(d.futNet) }}>{contracts(d.futNet)}</td>
                        <td className="py-2 px-2" style={{ color: tone(d.callNet) }}>{contracts(d.callNet)}</td>
                        <td className="py-2 px-2" style={{ color: tone(-d.putNet) }}>{contracts(d.putNet)}</td>
                        <td className="py-2 px-2 pr-4" style={{ color: tone(d.stkFutNet) }}>{contracts(d.stkFutNet)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableFrame>
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
