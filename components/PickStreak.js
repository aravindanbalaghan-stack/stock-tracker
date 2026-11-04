"use client";

// "How long has this been on the list" — shared by the Home tab's
// Odds-ranked picks and the Screeners tab's picks view. The ranking runs on
// weekly bars, so the list changes week to week and the streak is counted
// in weeks (see attachWeeklyStreaks in lib/picks.js).

function weekLabel(key) {
  return new Date(`${key}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
}

export function StreakBadge({ pick, horizonLabel }) {
  if (!(pick?.weeksShown > 1)) return null;
  return (
    <span
      className="text-[10px] font-medium px-1.5 py-0.5 rounded whitespace-nowrap"
      style={{ color: "var(--accent)", background: "var(--surface-2)" }}
      title={`In the ${horizonLabel.toLowerCase()} top 10 for ${pick.weeksShown}${pick.streakCapped ? "+" : ""} weeks in a row, since the week of ${weekLabel(pick.firstShownWeek)}`}
    >
      {pick.weeksShown}
      {pick.streakCapped ? "+" : ""} wks
    </span>
  );
}

export function FirstShownCell({ pick }) {
  if (!pick?.firstShownWeek) return <span style={{ color: "var(--text-faint)" }}>—</span>;
  if (pick.weeksShown <= 1) return <span style={{ color: "var(--gain)" }}>New this week</span>;
  return (
    <span title={`First ranked in the week starting ${pick.firstShownWeek}`}>
      Wk of {weekLabel(pick.firstShownWeek)}
      <span className="block text-[10px]" style={{ color: "var(--text-faint)" }}>
        {pick.weeksShown}
        {pick.streakCapped ? "+" : ""} weeks
      </span>
    </span>
  );
}
