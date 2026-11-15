"use client";
import { fmt } from "@/lib/format";

// Shared rendering for a stock's stage "journey" (see stageJourney() in
// lib/stageAnalysis.js): the stage it was in before, every dip out of the
// current stage and back, and the weekly close that would end it.
// Used by the Stage 2 / Wyckoff / Weinstein screeners and the stock page
// so the same facts read the same way everywhere.

function fmtDate(iso) {
  if (!iso) return "—";
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "2-digit", timeZone: "UTC" });
}

const TONE = {
  1: "var(--text-muted)",
  2: "var(--gain)",
  3: "var(--tier-mid)",
  4: "var(--loss)",
};

const SHORT = { 1: "Basing", 2: "Advancing", 3: "Topping", 4: "Declining" };

export function StageTag({ stage, withName = false, className = "" }) {
  if (stage == null) return <span style={{ color: "var(--text-faint)" }}>—</span>;
  return (
    <span
      className={`text-[10px] px-1.5 py-0.5 rounded border whitespace-nowrap ${className}`}
      style={{ borderColor: TONE[stage], color: TONE[stage] }}
    >
      Stage {stage}
      {withName ? ` · ${SHORT[stage]}` : ""}
    </span>
  );
}

function weeksText(w) {
  return `${w} wk${w === 1 ? "" : "s"}`;
}

// ---- Table cells -------------------------------------------------------

export function PrevStageCell({ journey }) {
  const p = journey?.previousStage;
  if (!p) {
    return (
      <span className="text-[11px]" style={{ color: "var(--text-faint)" }} title="No earlier stage in the ~2 years of history fetched">
        —
      </span>
    );
  }
  return (
    <span
      className="inline-flex flex-col items-start gap-0.5"
      title={`${p.label} from ${p.from} to ${p.to} (${weeksText(p.weeks)}${p.openStart ? ", possibly longer — history starts there" : ""})`}
    >
      <StageTag stage={p.stage} />
      <span className="text-[10px]" style={{ color: "var(--text-faint)" }}>
        {p.openStart ? "≥" : ""}
        {weeksText(p.weeks)} · to {fmtDate(p.to)}
      </span>
    </span>
  );
}

export function StageChangesCell({ journey }) {
  if (!journey) return <span style={{ color: "var(--text-faint)" }}>—</span>;
  const list = journey.interruptions;
  if (!list.length) {
    return (
      <span
        className="text-[11px]"
        style={{ color: "var(--text-muted)" }}
        title={`Held Stage ${journey.stage} on every weekly close since ${journey.episode.enteredOn}`}
      >
        None
      </span>
    );
  }
  const last = list[list.length - 1];
  return (
    <span
      className="inline-flex flex-col items-start gap-0.5"
      title={list
        .map((x) => `${x.label}: ${x.from} → ${x.to} (${weeksText(x.weeks)}), then back to Stage ${journey.stage}`)
        .join("\n")}
    >
      <span className="text-[11px] font-medium" style={{ color: "var(--tier-mid)" }}>
        {list.length} dip{list.length === 1 ? "" : "s"}, recovered
      </span>
      <span className="text-[10px]" style={{ color: "var(--text-faint)" }}>
        last: St.{last.stage} {fmtDate(last.from)}
      </span>
    </span>
  );
}

export function InvalidationCell({ invalidation }) {
  if (!invalidation) return <span style={{ color: "var(--text-faint)" }}>—</span>;
  const { down, up, atRisk } = invalidation;
  return (
    <span className="inline-flex flex-col items-end gap-0.5 whitespace-nowrap">
      {atRisk && (
        <span
          className="text-[10px] px-1 rounded"
          style={{ color: "var(--loss)", background: "var(--loss-dim)" }}
          title={`Even an unchanged close would make it ${atRisk.becomesLabel}`}
        >
          at risk → St.{atRisk.becomes}
        </span>
      )}
      {down && (
        <span className="font-mono text-xs" style={{ color: "var(--text)" }} title={down.rule}>
          &lt; ₹{fmt(down.price)}
          <span className="text-[10px] ml-1" style={{ color: "var(--loss)" }}>
            {fmt(down.pctFromClose, 1)}%
          </span>
        </span>
      )}
      {up && (
        <span className="font-mono text-xs" style={{ color: "var(--text)" }} title={up.rule}>
          &gt; ₹{fmt(up.price)}
          <span className="text-[10px] ml-1" style={{ color: "var(--gain)" }}>
            +{fmt(up.pctFromClose, 1)}%
          </span>
        </span>
      )}
      <span className="text-[10px]" style={{ color: "var(--text-faint)" }}>
        weekly close
      </span>
    </span>
  );
}

// ---- Full panel --------------------------------------------------------

function Row({ label, children }) {
  return (
    <div className="grid gap-x-3 gap-y-0.5 sm:grid-cols-[9.5rem_1fr]">
      <span className="text-xs" style={{ color: "var(--text-faint)" }}>
        {label}
      </span>
      <div className="text-xs min-w-0" style={{ color: "var(--text-muted)" }}>
        {children}
      </div>
    </div>
  );
}

/**
 * Everything about the stage journey in one block. `anchorNote` explains
 * what the episode was counted from (e.g. the Stage 2 breakout); `extra`
 * renders below the invalidation rules.
 */
export function StageJourneyPanel({ journey, anchorNote, extra }) {
  if (!journey) {
    return (
      <p className="text-xs" style={{ color: "var(--text-faint)" }}>
        Not enough weekly history to trace this stock&apos;s stage changes.
      </p>
    );
  }
  const { stage, episode, streak, previousStage: prev, interruptions, path, invalidation: inv } = journey;
  const streakDiffers = streak.enteredOn !== episode.enteredOn;

  return (
    <div className="flex flex-col gap-2.5">
      {/* Path: the last few stages, oldest first */}
      <div className="flex items-center flex-wrap gap-1.5" aria-label="Recent stage sequence">
        {path.map((seg, i) => (
          <span key={`${seg.from}-${i}`} className="inline-flex items-center gap-1.5">
            {i > 0 && (
              <span className="text-[10px]" style={{ color: "var(--text-faint)" }} aria-hidden>
                →
              </span>
            )}
            <span
              className="inline-flex items-baseline gap-1 text-[11px] px-1.5 py-0.5 rounded border"
              style={{
                borderColor: TONE[seg.stage],
                color: TONE[seg.stage],
                background: seg.ongoing ? "var(--surface-3)" : "transparent",
              }}
              title={`${seg.label}: ${seg.from} → ${seg.ongoing ? "now" : seg.to}`}
            >
              {seg.stage}
              <span className="text-[10px]" style={{ color: "var(--text-faint)" }}>
                {seg.openStart ? "≥" : ""}
                {seg.weeks}w{seg.ongoing ? " · now" : ""}
              </span>
            </span>
          </span>
        ))}
      </div>

      {/* The headline date is the start of the CURRENT unbroken run — the
          first weekly close of this stage after the last close that wasn't.
          That's what "it entered Stage N on…" means on a chart. The episode
          date (which folds in dips of ≤3 weeks) is shown second, labelled. */}
      <Row label="Current stage">
        <StageTag stage={stage} withName /> since the weekly close of{" "}
        <span style={{ color: "var(--text)" }}>{fmtDate(streak.enteredOn)}</span> ({weeksText(streak.weeks)}
        {!streakDiffers && episode.openStart ? " or more" : ""})
        {anchorNote ? <span style={{ color: "var(--text-faint)" }}> · {anchorNote}</span> : null}
        {streakDiffers && (
          <span className="block mt-0.5" style={{ color: "var(--text-faint)" }}>
            It was also Stage {stage} from {fmtDate(episode.enteredOn)}, apart from the short dip
            {interruptions.length === 1 ? "" : "s"} below — {weeksText(episode.weeks)}
            {episode.openStart ? " or more" : ""} counting {interruptions.length === 1 ? "it" : "them"}.
          </span>
        )}
      </Row>

      <Row label="Previous stage">
        {prev ? (
          <>
            <StageTag stage={prev.stage} withName /> {fmtDate(prev.from)} → {fmtDate(prev.to)} (
            {prev.openStart ? "at least " : ""}
            {weeksText(prev.weeks)})
          </>
        ) : (
          <span style={{ color: "var(--text-faint)" }}>None in the history available</span>
        )}
      </Row>

      <Row label="Changes since entering">
        {interruptions.length === 0 ? (
          <span>
            None — every weekly close since {fmtDate(streak.enteredOn)} was Stage {stage}.
          </span>
        ) : (
          <ul className="flex flex-col gap-1">
            {interruptions.map((x, i) => (
              <li key={i}>
                <StageTag stage={x.stage} withName /> {fmtDate(x.from)} → {fmtDate(x.to)} ({weeksText(x.weeks)}), then
                back to Stage {stage}
              </li>
            ))}
          </ul>
        )}
      </Row>

      <Row label="Becomes invalid">
        {!inv ? (
          <span style={{ color: "var(--text-faint)" }}>Not enough history to compute.</span>
        ) : (
          <div className="flex flex-col gap-1">
            {inv.atRisk && (
              <span style={{ color: "var(--loss)" }}>
                At risk: even a close unchanged at ₹{fmt(inv.refClose)} would make it {inv.atRisk.becomesLabel}
                {inv.atRisk.keepAbove ? ` — it needs to close above ₹${fmt(inv.atRisk.keepAbove)} to stay` : ""}
                {inv.atRisk.keepBelow ? ` — it needs to close below ₹${fmt(inv.atRisk.keepBelow)} to stay` : ""}.
              </span>
            )}
            {inv.down && (
              <span>
                <span className="font-mono" style={{ color: "var(--text)" }}>
                  Below ₹{fmt(inv.down.price)}
                </span>{" "}
                ({fmt(inv.down.pctFromClose, 1)}%) → {inv.down.becomesLabel}
              </span>
            )}
            {inv.up && (
              <span>
                <span className="font-mono" style={{ color: "var(--text)" }}>
                  Above ₹{fmt(inv.up.price)}
                </span>{" "}
                (+{fmt(inv.up.pctFromClose, 1)}%) → {inv.up.becomesLabel}
              </span>
            )}
            {!inv.down && !inv.up && !inv.atRisk && <span>No single close this week would change the stage.</span>}
            <span style={{ color: "var(--text-faint)" }}>
              Judged on {inv.basis} (30-week MA now ₹{fmt(inv.ma30)}). The level moves a little each week as the
              average rolls forward.
            </span>
          </div>
        )}
      </Row>

      {extra}
    </div>
  );
}

/**
 * Week-by-week audit of the stage rule (stageLedger() in lib/stageAnalysis):
 * every input and the stage it produced, so a date can be checked against
 * a chart line by line.
 */
export function StageLedger({ rows }) {
  if (!rows?.length) return null;
  const cell = "py-1 px-2 text-right font-mono";
  return (
    <details className="mt-3 group">
      <summary className="cursor-pointer text-xs select-none" style={{ color: "var(--text-muted)" }}>
        Week-by-week check — the last {rows.length} weekly closes and the stage each one gave
      </summary>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full border-collapse text-[11px]">
          <thead>
            <tr className="text-left uppercase tracking-wider" style={{ color: "var(--text-faint)" }}>
              <th className="py-1 px-2">Week ending</th>
              <th className="py-1 px-2 text-right">Close</th>
              <th className="py-1 px-2 text-right" title="Simple average of the last 30 weekly closes, including this one — what the stage uses">
                30-wk MA
              </th>
              <th className="py-1 px-2 text-right" title="Change in the 30-week MA over 4 weeks; beyond ±0.5% counts as rising/falling">
                MA 4-wk
              </th>
              <th className="py-1 px-2 text-right" title="30-week WEIGHTED MA, for comparison with charts that label their line 'WMA'">
                30-wk WMA
              </th>
              <th className="py-1 px-2">Stage</th>
            </tr>
          </thead>
          <tbody>
            {[...rows].reverse().map((r) => (
              <tr
                key={r.weekEnd}
                className="border-t"
                style={{ borderColor: "var(--border)", background: r.changed ? "var(--surface-3)" : undefined }}
                title={r.basis}
              >
                <td className="py-1 px-2 font-mono" style={{ color: "var(--text-muted)" }}>
                  {r.weekEnd}
                  {r.inProgress && <span style={{ color: "var(--text-faint)" }}> (so far)</span>}
                </td>
                <td className={cell} style={{ color: "var(--text)" }}>{fmt(r.close)}</td>
                <td className={cell} style={{ color: r.aboveMa ? "var(--gain)" : "var(--loss)" }}>
                  {fmt(r.ma30)} {r.aboveMa ? "▲" : "▼"}
                </td>
                <td className={cell} style={{ color: r.slope4Pct > 0.5 ? "var(--gain)" : r.slope4Pct < -0.5 ? "var(--loss)" : "var(--text-faint)" }}>
                  {r.slope4Pct >= 0 ? "+" : ""}
                  {fmt(r.slope4Pct)}%
                </td>
                <td className={cell} style={{ color: r.aboveWma == null ? "var(--text-faint)" : r.aboveWma ? "var(--gain)" : "var(--loss)" }}>
                  {r.wma30 == null ? "—" : `${fmt(r.wma30)} ${r.aboveWma ? "▲" : "▼"}`}
                </td>
                <td className="py-1 px-2">
                  <StageTag stage={r.stage} />
                  {r.changed && <span className="ml-1" style={{ color: "var(--text-faint)" }}>changed</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[11px] leading-relaxed" style={{ color: "var(--text-faint)" }}>
        ▲/▼ = the week closed above/below that average. Stage 4 needs a close below a <em>falling</em> 30-week MA (down more
        than 0.5% over 4 weeks); Stage 2 needs a close above a rising one. Panel uses the simple 30-week average, as Weinstein
        did. If your chart&apos;s &ldquo;30 WMA&rdquo; is a weighted average, compare against the WMA column — in a decline it
        sits lower than the simple MA, so price crosses it a week or two later. Hover a row for the rule that decided it.
      </p>
    </details>
  );
}
