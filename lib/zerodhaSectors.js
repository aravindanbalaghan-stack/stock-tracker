// Sector membership sourced from Zerodha's public sector pages
// (https://zerodha.com/markets/sector/, data powered by Tijori Finance).
//
// Three things make a naive import a bad idea, and this module exists to
// handle all three explicitly rather than silently:
//
//  1. SCOPE. Zerodha's buckets are far broader than this app's. Their
//     "Chemicals" carries 459 companies — plastics, packaging, adhesives,
//     rubber, agrochemicals all folded in — against roughly 26 here. Their
//     list isn't wrong, it's answering a different question. Importing it
//     whole would bury the curated lists rather than improve them.
//
//  2. EXCHANGE. Many entries are BSE-only. Every screen in this app runs
//     off NSE bhavcopy, so a BSE-only symbol would sit in a sector
//     permanently contributing nothing. Those are filtered out.
//
//  3. SIZE. The tail runs down to sub-₹10 Cr shells that barely trade.
//     Including them would drag sector delivery and volume aggregates
//     toward names nobody can actually deal in, so there's a market-cap
//     floor, adjustable by the caller.

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const BASE = "https://zerodha.com/markets/sector";

// Default floor in ₹ crore. Below this, a stock adds noise to sector
// aggregates rather than signal.
export const DEFAULT_MIN_MARKET_CAP_CR = 500;

/**
 * Which Zerodha sector(s) feed each of this app's sectors.
 *
 * Only unambiguous mappings are listed. Zerodha's "Financial services"
 * spans banks, NBFCs, insurers and brokers, which this app deliberately
 * keeps apart — auto-assigning those would be a guess, so instead they're
 * offered as a manual source the user picks per sector (see `candidates`).
 */
export const SECTOR_SOURCE_MAP = {
  "auto-ancillaries": ["auto-ancillary"],
  automobile: ["automobile"],
  aviation: ["aviation"],
  "building-materials": ["building-materials", "plastic-pipes"],
  chemicals: ["chemicals"],
  "consumer-durables": ["consumer-durables"],
  defence: ["defence"],
  "capital-goods": ["engineering-capital-goods"],
  fmcg: ["fmcg"],
  "fertilizers-agrochemicals": ["fertilizers"],
  it: ["it", "software-services"],
  "shipping-logistics": ["logistics"],
  "media-entertainment": ["media-entertainment"],
  "metals-mining": ["metals"],
  nbfc: ["nbfc"],
  "plastics-packaging": ["packaging"],
  "real-estate": ["real-estate"],
  retail: ["retail"],
  "renewable-energy": ["solar-panel"],
  telecom: ["telecom"],
  textiles: ["textiles"],
};

// Every Zerodha sector, so a user can pull from one this app doesn't map
// automatically — needed for sectors like Banking or Pharma, which sit
// inside Zerodha's broader "Financial services" and "Healthcare".
export const ZERODHA_SECTORS = [
  "agriculture", "auto-ancillary", "automobile", "aviation", "building-materials",
  "chemicals", "consumer-durables", "dairy-products", "defence", "diversified",
  "education-training", "energy", "engineering-capital-goods", "fmcg", "fertilizers",
  "financial-services", "healthcare", "it", "logistics", "media-entertainment",
  "metals", "miscellaneous", "nbfc", "packaging", "plastic-pipes", "real-estate",
  "retail", "services", "silver", "software-services", "solar-panel", "telecom",
  "textiles", "tourism-hospitality", "trading",
];

function parseIndianNumber(text) {
  if (!text) return null;
  const cleaned = String(text).replace(/,/g, "").trim();
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/**
 * Pulls { symbol, name, exchange, marketCapCr } out of one Zerodha sector
 * page. Their markup renders each company as a link to
 * /markets/stocks/<EXCHANGE>/<SYMBOL>/ with the display name and market
 * cap in the link text.
 */
export async function fetchZerodhaSector(slug, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${BASE}/${slug}/`, {
      headers: { "User-Agent": UA, Accept: "text/html" },
      signal: controller.signal,
      // Sector membership changes slowly; a day of caching is plenty and
      // keeps repeat syncs off their servers.
      next: { revalidate: 60 * 60 * 24 },
    });
    if (!res.ok) return null;
    const html = await res.text();

    const out = [];
    const seen = new Set();
    // Primary parse: each company row is an anchor to its stock page, with
    // the display name and market cap inside the link body.
    const re = /<a[^>]+href="[^"]*\/markets\/stocks\/(NSE|BSE)\/([^/"]+)\/?"[^>]*>([\s\S]*?)<\/a>/gi;
    let m;
    while ((m = re.exec(html)) !== null) {
      const exchange = m[1];
      const symbol = decodeURIComponent(m[2]).trim().toUpperCase();
      if (!symbol || seen.has(`${exchange}:${symbol}`)) continue;
      seen.add(`${exchange}:${symbol}`);

      // Strip tags from the link body, then read the trailing figures.
      const text = m[3].replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
      const figures = text.match(/^(.*?)\s+([\d,]+)\s+(?:[\d.]+|--)\s*(?:View details)?$/i);
      out.push({
        symbol,
        exchange,
        name: figures ? figures[1].trim() : text.replace(/View details$/i, "").trim(),
        marketCapCr: figures ? parseIndianNumber(figures[2]) : null,
      });
    }

    // Fallback: if the row markup ever changes so the anchor no longer
    // wraps the figures, still recover the memberships. Market cap comes
    // back null, which the caller treats as "can't verify size" rather
    // than "tiny" — so those entries are surfaced separately instead of
    // being silently dropped by the cap filter.
    if (out.length === 0) {
      const hrefRe = /\/markets\/stocks\/(NSE|BSE)\/([A-Z0-9&._-]+)\/?/gi;
      let h;
      while ((h = hrefRe.exec(html)) !== null) {
        const exchange = h[1].toUpperCase();
        const symbol = decodeURIComponent(h[2]).trim().toUpperCase();
        if (!symbol || seen.has(`${exchange}:${symbol}`)) continue;
        seen.add(`${exchange}:${symbol}`);
        out.push({ symbol, exchange, name: symbol, marketCapCr: null });
      }
    }

    return out;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetches the given Zerodha slugs and returns the entries worth
 * considering: NSE-listed, at or above the market-cap floor, de-duped.
 * `rejected` carries the counts so the UI can explain what was left out
 * instead of the numbers appearing to vanish.
 */
export async function fetchCandidates(slugs, { minMarketCapCr = DEFAULT_MIN_MARKET_CAP_CR } = {}) {
  const bySymbol = new Map();
  const rejected = { bseOnly: 0, belowCap: 0, unparsed: 0 };
  const failedSlugs = [];

  for (const slug of slugs) {
    const rows = await fetchZerodhaSector(slug);
    if (!rows) {
      failedSlugs.push(slug);
      continue;
    }
    for (const row of rows) {
      if (row.exchange !== "NSE") {
        rejected.bseOnly++;
        continue;
      }
      if (row.marketCapCr == null) {
        // Unknown size, not "too small". Kept and flagged so the UI can
        // show it as unverified rather than dropping it on a guess.
        rejected.unparsed++;
        row.sizeUnknown = true;
      } else if (row.marketCapCr < minMarketCapCr) {
        rejected.belowCap++;
        continue;
      }
      const existing = bySymbol.get(row.symbol);
      if (!existing || (row.marketCapCr ?? 0) > (existing.marketCapCr ?? 0)) {
        bySymbol.set(row.symbol, row);
      }
    }
  }

  const candidates = [...bySymbol.values()].sort(
    (a, b) => (b.marketCapCr ?? 0) - (a.marketCapCr ?? 0)
  );
  return { candidates, rejected, failedSlugs };
}
