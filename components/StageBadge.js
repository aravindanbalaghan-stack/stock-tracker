// A stock's (or group's) Weinstein stage as a small badge — shared by every
// Delivery sub-tab so "Show stage" reads the same everywhere.

export default function StageBadge({ info, loading = false }) {
  if (!info) {
    return (
      <span className="text-[10px]" style={{ color: "var(--text-faint)" }} title={loading ? "Loading stages…" : "Not enough weekly history to judge a stage"}>
        {loading ? "…" : "—"}
      </span>
    );
  }
  if (info.available === false) return <span className="text-[10px]" style={{ color: "var(--text-faint)" }}>n/a</span>;
  const tone = info.stage === 2 ? "var(--gain)" : info.stage === 4 ? "var(--loss)" : null;
  return (
    <span
      className="text-[10px] px-1.5 py-0.5 rounded border whitespace-nowrap"
      style={{ borderColor: tone ?? "var(--border)", color: tone ?? "var(--text-muted)" }}
      title={`30-week MA slope ${info.ma30SlopePct >= 0 ? "+" : ""}${info.ma30SlopePct}% over 4 weeks · price ${info.aboveMa ? "above" : "below"} it`}
    >
      {info.stageLabel ?? `Stage ${info.stage}`}
    </span>
  );
}

/** Sort value so a Stage column sorts 2 → 1 → 3 → 4 (best setups first). */
export const STAGE_RANK = { 2: 4, 1: 3, 3: 2, 4: 1 };
