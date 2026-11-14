import { kvConfigured } from "@/lib/kv";

// What every panel-backed view says while its history is still filling.
export function coverageNote(panel) {
  const c = panel.coverage;
  if (c.complete) return null;
  if (!kvConfigured) {
    return "Storage isn't configured, so the price history can't be kept between visits — each load fetches what it can from NSE in a few seconds. Add the Upstash database (README → Set up storage) to get the full history.";
  }
  return `Building price history from NSE: ${c.have} of ${c.want} sessions loaded so far. It fills a little more each time this page or the nightly job runs, usually within a few loads — figures that need a long history (200-day average, 52-week highs, stages) appear as it fills.`;
}

export function panelMeta(panel) {
  return {
    asOf: panel.latest,
    coverage: panel.coverage,
    incomplete: !panel.coverage.complete,
    note: coverageNote(panel),
  };
}
