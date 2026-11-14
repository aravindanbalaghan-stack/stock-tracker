"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ScreenHeader, SectionTitle, Panel, SubNav, ErrorState, LoadingState, EmptyState } from "@/components/ui/Chrome";
import TableFrame from "@/components/ui/TableFrame";
import InfoNote from "@/components/InfoNote";
import { usePersistentState } from "@/lib/usePersistentState";
import { fmt, fmtSignedPct, toneOf } from "@/lib/format";

const GROUPS = [
  { id: "sectors", label: "Sectors" },
  { id: "themes", label: "Themes" },
];
const TAILS = [
  { id: "4", label: "4 wks" },
  { id: "8", label: "8 wks" },
  { id: "12", label: "12 wks" },
];
const Q = {
  Leading: { color: "var(--gain)", wash: "rgba(53,199,123,0.06)", hint: "Strong and getting stronger" },
  Weakening: { color: "var(--tier-mid)", wash: "rgba(224,180,85,0.06)", hint: "Still strong, but losing momentum" },
  Lagging: { color: "var(--loss)", wash: "rgba(239,83,80,0.06)", hint: "Weak and getting weaker" },
  Improving: { color: "var(--tier-low)", wash: "rgba(75,159,212,0.06)", hint: "Still weak, but gaining momentum" },
};

function useRotation(group) {
  const [state, setState] = useState({ key: null, data: null, error: null });
  useEffect(() => {
    let live = true;
    fetch(`/api/rotation?group=${group}`)
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j?.error || "Couldn't load rotation");
        if (live) setState({ key: group, data: j, error: null });
      })
      .catch((e) => live && setState({ key: group, data: null, error: e.message }));
    return () => {
      live = false;
    };
  }, [group]);
  return state.key === group ? state : { key: group, data: null, error: null };
}

function Arrow({ deg }) {
  // heading: 0° = moving right (gaining relative strength), 90° = up (gaining momentum)
  return (
    <span className="inline-block font-mono" style={{ transform: `rotate(${-deg}deg)`, color: "var(--text-muted)" }} aria-label={`heading ${deg}°`}>
      →
    </span>
  );
}

function RRGChart({ groups, tail, selected, onSelect, labels }) {
  const S = 600, PAD = 36;
  const pts = groups.flatMap((g) => g.tail.slice(-tail));
  const span = Math.max(1.5, ...pts.map((p) => Math.max(Math.abs(p.ratio - 100), Math.abs(p.momentum - 100)))) * 1.12;
  const x = (r) => PAD + ((r - (100 - span)) / (2 * span)) * (S - 2 * PAD);
  const y = (m) => S - PAD - ((m - (100 - span)) / (2 * span)) * (S - 2 * PAD);
  const c = x(100), cy = y(100);
  const anySel = selected.size > 0;

  return (
    <svg viewBox={`0 0 ${S} ${S}`} className="w-full h-auto select-none" role="img" aria-label="Relative rotation graph">
      <rect x={c} y={PAD} width={S - PAD - c} height={cy - PAD} fill={Q.Leading.wash} />
      <rect x={c} y={cy} width={S - PAD - c} height={S - PAD - cy} fill={Q.Weakening.wash} />
      <rect x={PAD} y={cy} width={c - PAD} height={S - PAD - cy} fill={Q.Lagging.wash} />
      <rect x={PAD} y={PAD} width={c - PAD} height={cy - PAD} fill={Q.Improving.wash} />
      <line x1={PAD} x2={S - PAD} y1={cy} y2={cy} stroke="var(--border-strong)" />
      <line x1={c} x2={c} y1={PAD} y2={S - PAD} stroke="var(--border-strong)" />
      {[
        ["Leading", S - PAD - 6, PAD + 16, "end"],
        ["Weakening", S - PAD - 6, S - PAD - 8, "end"],
        ["Lagging", PAD + 6, S - PAD - 8, "start"],
        ["Improving", PAD + 6, PAD + 16, "start"],
      ].map(([q, tx, ty, anchor]) => (
        <text key={q} x={tx} y={ty} textAnchor={anchor} fontSize="13" fontWeight="600" fill={Q[q].color} opacity="0.85" style={{ fontFamily: "var(--font-display)" }}>
          {q}
        </text>
      ))}
      <text x={S - PAD} y={cy - 6} textAnchor="end" fontSize="10" fill="var(--text-faint)">
        RS-Ratio →
      </text>
      <text x={c + 6} y={PAD - 10} fontSize="10" fill="var(--text-faint)">
        ↑ RS-Momentum
      </text>

      {groups.map((g) => {
        const t = g.tail.slice(-tail);
        if (!t.length) return null;
        const head = t[t.length - 1];
        const color = Q[g.quadrant].color;
        const isSel = selected.has(g.key);
        const dim = anySel && !isSel;
        const path = t.map((p) => `${x(p.ratio).toFixed(1)},${y(p.momentum).toFixed(1)}`).join(" ");
        return (
          <g key={g.key} opacity={dim ? 0.18 : 1} style={{ cursor: "pointer" }} onClick={() => onSelect(g.key)}>
            <title>{`${g.name} — ${g.quadrant} · RS-Ratio ${fmt(head.ratio)} · RS-Mom ${fmt(head.momentum)}`}</title>
            <polyline points={path} fill="none" stroke={color} strokeWidth={isSel ? 2.2 : 1.2} strokeOpacity={isSel || groups.length <= 12 ? 0.7 : 0.3} strokeLinejoin="round" />
            {t.slice(0, -1).map((p, k) => (
              <circle key={k} cx={x(p.ratio)} cy={y(p.momentum)} r={1.8 + (k / t.length) * 1.4} fill={color} opacity={0.35 + (k / t.length) * 0.4} />
            ))}
            <circle cx={x(head.ratio)} cy={y(head.momentum)} r={isSel ? 6.5 : 5} fill={color} stroke="var(--surface)" strokeWidth="1.5" />
            {(labels || isSel) && (
              <text x={x(head.ratio) + 8} y={y(head.momentum) + 4} fontSize="11" fill="var(--text)" style={{ paintOrder: "stroke", stroke: "var(--surface)", strokeWidth: 3 }}>
                {g.name}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

export default function RotationTab() {
  const [group, setGroup] = usePersistentState("rotation.group", "sectors");
  const [tail, setTail] = usePersistentState("rotation.tail", "4");
  const [quadFilter, setQuadFilter] = usePersistentState("rotation.quad", "all");
  const [labels, setLabels] = usePersistentState("rotation.labels", true);
  const [selected, setSelected] = useState(() => new Set());
  const { data, error } = useRotation(group);

  const shown = useMemo(
    () => (data?.groups ?? []).filter((g) => quadFilter === "all" || g.quadrant === quadFilter),
    [data, quadFilter]
  );
  const counts = useMemo(() => {
    const c = { Leading: 0, Improving: 0, Weakening: 0, Lagging: 0 };
    for (const g of data?.groups ?? []) c[g.quadrant]++;
    return c;
  }, [data]);

  function toggle(key) {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
  }

  return (
    <div>
      <ScreenHeader
        title="Sector rotation"
        meta={data?.asOf ? `Weekly · vs ${data.benchmark ?? "the market"} · as of ${data.asOf}` : "Where money is moving, week by week"}
        actions={
          <>
            <SubNav items={GROUPS} active={group} onChange={(g) => { setGroup(g); setSelected(new Set()); }} />
            <SubNav items={TAILS} active={String(tail)} onChange={setTail} />
          </>
        }
      >
        <InfoNote label="How to read this">
          Each dot is a {group === "themes" ? "theme" : "sector"} (an equal-weight basket of its stocks) compared with the
          500 most traded stocks. Right of centre means it&apos;s outperforming (RS-Ratio above 100); above centre means
          that outperformance is accelerating (RS-Momentum above 100). The tail shows the path over the past weeks, and
          groups usually travel clockwise: Improving → Leading → Weakening → Lagging. Early rotation shows up as a tail
          moving up out of Lagging into Improving. This is the standard open approximation of a Relative Rotation Graph;
          click a dot or a row to highlight it.
        </InfoNote>
      </ScreenHeader>

      {error && <ErrorState>{error}</ErrorState>}
      {!data && !error && <LoadingState variant="cards">Building weekly baskets for every {group === "themes" ? "theme" : "sector"}…</LoadingState>}
      {data?.note && (
        <div className="mb-4 rounded-[var(--radius)] border px-4 py-3 text-sm" style={{ borderColor: "var(--accent-dim)", background: "var(--accent-wash)", color: "var(--text)" }}>
          {data.note}
        </div>
      )}
      {data && !data.groups?.length && !data.note && (
        <EmptyState>
          {group === "themes"
            ? "No themes with at least 3 stocks yet. Tag stocks with themes on the Sectors tab or import them on Stock Data."
            : "No sectors with enough data yet."}
        </EmptyState>
      )}

      {data?.groups?.length > 0 && (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
          <Panel>
            <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
              <div className="flex gap-1 flex-wrap">
                {["all", "Leading", "Improving", "Weakening", "Lagging"].map((q) => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => setQuadFilter(q)}
                    className="px-2 py-1 rounded-[4px] text-[11px] font-medium border"
                    style={{
                      borderColor: quadFilter === q ? (Q[q]?.color ?? "var(--accent)") : "var(--border)",
                      color: q === "all" ? "var(--text-muted)" : Q[q].color,
                      background: quadFilter === q ? "var(--surface-3)" : "transparent",
                    }}
                  >
                    {q === "all" ? "All" : `${q} ${counts[q]}`}
                  </button>
                ))}
              </div>
              <label className="flex items-center gap-1.5 text-xs" style={{ color: "var(--text-muted)" }}>
                <input type="checkbox" checked={labels} onChange={(e) => setLabels(e.target.checked)} />
                Labels
              </label>
            </div>
            <RRGChart groups={shown} tail={Number(tail)} selected={selected} onSelect={toggle} labels={labels} />
            {selected.size > 0 && (
              <button type="button" className="text-xs mt-1" style={{ color: "var(--accent)" }} onClick={() => setSelected(new Set())}>
                Clear highlight
              </button>
            )}
          </Panel>

          <div>
            <SectionTitle meta={`${shown.length} ${group}`}>Where each one stands</SectionTitle>
            <Panel flush>
              <TableFrame name={`rotation-${group}`}>
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="text-left text-[11px] uppercase tracking-wider" style={{ color: "var(--text-faint)" }}>
                      <th className="py-2 px-3">{group === "themes" ? "Theme" : "Sector"}</th>
                      <th className="py-2 px-2">Quadrant</th>
                      <th className="py-2 px-2 text-right" title="Relative strength vs its norm (100 = in line)">RS-Ratio</th>
                      <th className="py-2 px-2 text-right" title="Change in relative strength (100 = steady)">RS-Mom</th>
                      <th className="py-2 px-2 text-center">Heading</th>
                      <th className="py-2 px-2 text-right">4 wk</th>
                      <th className="py-2 px-2 text-right">13 wk</th>
                      <th className="py-2 px-2 text-right" title="Return relative to the benchmark over 13 weeks">vs mkt 13 wk</th>
                      <th className="py-2 px-3 text-right">Stocks</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((g) => (
                      <tr
                        key={g.key}
                        className="border-t cursor-pointer"
                        style={{ borderColor: "var(--border)", background: selected.has(g.key) ? "var(--surface-3)" : undefined }}
                        onClick={() => toggle(g.key)}
                      >
                        <td className="py-1.5 px-3">
                          {group === "sectors" ? (
                            <Link href={`/sector/${encodeURIComponent(g.key)}`} className="hover:underline" style={{ color: "var(--text)" }} onClick={(e) => e.stopPropagation()}>
                              {g.name}
                            </Link>
                          ) : (
                            <span style={{ color: "var(--text)" }}>{g.name}</span>
                          )}
                        </td>
                        <td className="py-1.5 px-2">
                          <span className="text-xs font-medium" style={{ color: Q[g.quadrant].color }} title={Q[g.quadrant].hint}>
                            {g.quadrant}
                          </span>
                        </td>
                        <td className="py-1.5 px-2 text-right font-mono text-xs">{fmt(g.ratio)}</td>
                        <td className="py-1.5 px-2 text-right font-mono text-xs">{fmt(g.momentum)}</td>
                        <td className="py-1.5 px-2 text-center">
                          <Arrow deg={g.heading} />
                        </td>
                        <td className="py-1.5 px-2 text-right font-mono text-xs" style={{ color: toneOf(g.ret4w) }}>
                          {fmtSignedPct(g.ret4w, 1)}
                        </td>
                        <td className="py-1.5 px-2 text-right font-mono text-xs" style={{ color: toneOf(g.ret13w) }}>
                          {fmtSignedPct(g.ret13w, 1)}
                        </td>
                        <td className="py-1.5 px-2 text-right font-mono text-xs" style={{ color: toneOf(g.rs13w) }}>
                          {fmtSignedPct(g.rs13w, 1)}
                        </td>
                        <td className="py-1.5 px-3 text-right font-mono text-xs">{g.members}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableFrame>
            </Panel>
          </div>
        </div>
      )}
    </div>
  );
}
