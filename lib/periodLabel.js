// Turns a screen's as-of date and period into a label that says exactly
// which sessions the figures cover.
//
// Without this, a Weekly view showing "As of 2026-08-11" is ambiguous —
// it reads like a single day's data when it actually aggregates five
// sessions. Monthly is worse: 21 trading days is roughly a month, but it
// isn't a calendar month, and saying "August" would be wrong.

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function parseISO(dateStr) {
  if (!dateStr || typeof dateStr !== "string") return null;
  const d = new Date(`${dateStr}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatDayLabel(dateStr) {
  const d = parseISO(dateStr);
  if (!d) return dateStr ?? "—";
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()].slice(0, 3)} ${d.getUTCFullYear()}`;
}

/** Monday of the ISO week containing `dateStr`. */
export function weekStart(dateStr) {
  const d = parseISO(dateStr);
  if (!d) return null;
  const dow = (d.getUTCDay() + 6) % 7; // 0 = Monday
  d.setUTCDate(d.getUTCDate() - dow);
  return d;
}

function iso(d) {
  return d.toISOString().slice(0, 10);
}

/**
 * The label for a screen covering `periodTradingDays` sessions ending on
 * `asOf`. `firstDate` is the actual first session in the window when the
 * caller knows it — preferred over inferring, since holidays mean N
 * trading days rarely span N calendar days.
 */
export function periodCoverageLabel({ asOf, period = "daily", periodTradingDays = 1, firstDate = null }) {
  const end = parseISO(asOf);
  if (!end) return { short: "—", full: "—" };

  if (period === "daily" || periodTradingDays <= 1) {
    return {
      short: formatDayLabel(asOf),
      full: `Trading session of ${formatDayLabel(asOf)}`,
    };
  }

  const start = parseISO(firstDate) ?? null;

  if (period === "weekly") {
    const monday = weekStart(asOf);
    const sameWeek = start && iso(weekStart(firstDate)) === iso(monday);
    // A "week" here is the last 5 sessions, which usually — but not
    // always — matches the calendar week containing the as-of date.
    if (sameWeek || !start) {
      const friday = new Date(monday);
      friday.setUTCDate(friday.getUTCDate() + 4);
      return {
        short: `Week of ${formatDayLabel(iso(monday))}`,
        full: `Week of ${formatDayLabel(iso(monday))} – ${formatDayLabel(iso(friday))}, ${periodTradingDays} sessions ending ${formatDayLabel(asOf)}`,
      };
    }
    return {
      short: `${formatDayLabel(firstDate)} – ${formatDayLabel(asOf)}`,
      full: `${periodTradingDays} sessions, ${formatDayLabel(firstDate)} – ${formatDayLabel(asOf)} (spans two calendar weeks)`,
    };
  }

  if (period === "monthly") {
    // Deliberately not "August": 21 trading days is about a month but
    // isn't a calendar one, so naming a month would misstate the window.
    if (start) {
      const sameMonth = start.getUTCMonth() === end.getUTCMonth() && start.getUTCFullYear() === end.getUTCFullYear();
      return {
        short: sameMonth
          ? `${MONTHS[end.getUTCMonth()]} ${end.getUTCFullYear()}`
          : `${formatDayLabel(firstDate)} – ${formatDayLabel(asOf)}`,
        full: `${periodTradingDays} sessions, ${formatDayLabel(firstDate)} – ${formatDayLabel(asOf)}${
          sameMonth ? "" : " (spans two calendar months)"
        }`,
      };
    }
    return {
      short: `${periodTradingDays} sessions to ${formatDayLabel(asOf)}`,
      full: `${periodTradingDays} trading sessions ending ${formatDayLabel(asOf)} — a rolling month, not a calendar one`,
    };
  }

  return { short: formatDayLabel(asOf), full: formatDayLabel(asOf) };
}
