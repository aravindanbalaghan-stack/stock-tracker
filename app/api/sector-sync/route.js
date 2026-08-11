import { getResolvedSectorList, addSymbolToSector } from "@/lib/sectorOverrides";
import {
  fetchCandidates,
  SECTOR_SOURCE_MAP,
  ZERODHA_SECTORS,
  DEFAULT_MIN_MARKET_CAP_CR,
} from "@/lib/zerodhaSectors";
import { getRecentBhavcopies } from "@/lib/nseBhavcopy";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET — preview only. Never writes. Returns what WOULD be added to a
 * sector, so the comparison can be reviewed before anything changes.
 */
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const key = searchParams.get("key");
  const minCap = Number(searchParams.get("minCap")) || DEFAULT_MIN_MARKET_CAP_CR;
  const sourceParam = searchParams.get("sources");

  if (!key) return Response.json({ error: "A sector key is required" }, { status: 400 });

  try {
    const sectors = await getResolvedSectorList();
    const sector = sectors.find((s) => s.key === key);
    if (!sector) return Response.json({ error: "Unknown sector" }, { status: 404 });

    // Explicit sources override the default mapping — needed for sectors
    // this app splits more finely than Zerodha does (Banking, PSU Banks,
    // Insurance and Capital Markets all sit inside their "Financial
    // services"), where auto-assigning would be a guess.
    const sources = sourceParam
      ? sourceParam.split(",").map((s) => s.trim()).filter((s) => ZERODHA_SECTORS.includes(s))
      : SECTOR_SOURCE_MAP[key] ?? [];

    if (sources.length === 0) {
      return Response.json({
        key,
        name: sector.name,
        sources: [],
        needsSourceChoice: true,
        availableSources: ZERODHA_SECTORS,
        message:
          "No Zerodha sector maps cleanly onto this one — their buckets are broader than this app's here. Pick a source sector to compare against.",
        missing: [],
        alreadyPresent: 0,
      });
    }

    const { candidates, rejected, failedSlugs } = await fetchCandidates(sources, {
      minMarketCapCr: minCap,
    });

    // Only suggest symbols that actually trade on NSE in the EQ series —
    // Zerodha lists instruments this app's bhavcopy-driven screens would
    // never pick up otherwise.
    let tradable = null;
    try {
      const days = await getRecentBhavcopies(3, 12);
      if (days.length) {
        tradable = new Set();
        for (const day of days) {
          for (const [sym, row] of day.bySymbol) {
            if (row.series === "EQ") tradable.add(sym);
          }
        }
      }
    } catch {
      // Bhavcopy unavailable — fall through without the tradability check
      // rather than blocking the whole comparison.
    }

    const present = new Set(sector.symbols);
    const missing = [];
    let alreadyPresent = 0;
    let notOnNse = 0;

    for (const c of candidates) {
      if (present.has(c.symbol)) {
        alreadyPresent++;
        continue;
      }
      if (tradable && !tradable.has(c.symbol)) {
        notOnNse++;
        continue;
      }
      missing.push(c);
    }

    return Response.json({
      key,
      name: sector.name,
      sources,
      minMarketCapCr: minCap,
      currentCount: sector.symbols.length,
      candidateCount: candidates.length,
      alreadyPresent,
      missing,
      rejected: { ...rejected, notOnNse },
      failedSlugs,
      tradabilityChecked: tradable !== null,
    });
  } catch (err) {
    return Response.json(
      { error: "Failed to compare against Zerodha", detail: String(err?.message || err) },
      { status: 502 }
    );
  }
}

/**
 * POST — applies a chosen set of symbols to a sector. The symbols come
 * from the reviewed preview rather than being re-derived here, so what
 * gets written is exactly what was on screen.
 */
export async function POST(request) {
  try {
    const { sector, symbols } = (await request.json()) || {};
    if (!sector || !Array.isArray(symbols) || symbols.length === 0) {
      return Response.json({ error: "A sector and at least one symbol are required" }, { status: 400 });
    }

    const added = [];
    const skipped = [];
    for (const raw of symbols) {
      const symbol = String(raw).trim().toUpperCase();
      if (!symbol) continue;
      try {
        const result = await addSymbolToSector(sector, symbol);
        if (result.added) added.push(symbol);
        else skipped.push({ symbol, reason: result.reason });
      } catch (err) {
        skipped.push({ symbol, reason: String(err?.message || err) });
      }
    }

    return Response.json({ added, addedCount: added.length, skipped });
  } catch (err) {
    const msg = String(err?.message || err);
    const isStorage = /kv|redis|url|token|credential/i.test(msg);
    return Response.json(
      {
        error: isStorage
          ? "Couldn't save — the KV store this uses (the same one the alerts feature needs) doesn't look configured for this deployment."
          : msg,
      },
      { status: isStorage ? 503 : 400 }
    );
  }
}
