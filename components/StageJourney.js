"use client";

// Shared rendering for a stock's stage "journey" (see stageJourney() in
// lib/stageAnalysis.js): the stage it was in before, every dip out of the
// current stage and back, and the weekly close that would end it.
// Used by the Stage 2 / Wyckoff / Weinstein screeners and the stock page
// so the same facts read the same way everywhere.

function fmt(n, d = 2) {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return n.toLocaleString("en-IN", { maximumFractionDigits: d, minimumFractionDigits: d });
}

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

      <Row label="Current stage">
        <StageTag stage={stage} withName /> since the weekly close of{" "}
        <span style={{ color: "var(--text)" }}>{fmtDate(episode.enteredOn)}</span> ({weeksText(episode.weeks)}
        {episode.openStart ? " or more" : ""})
        {anchorNote ? <span style={{ color: "var(--text-faint)" }}> · {anchorNote}</span> : null}
        {streakDiffers && (
          <span className="block mt-0.5" style={{ color: "var(--text-faint)" }}>
            Current unbroken run: since {fmtDate(streak.enteredOn)} ({weeksText(streak.weeks)})
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
            None — every weekly close since {fmtDate(episode.enteredOn)} was Stage {stage}.
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
