import { getResolvedSectorList } from "@/lib/sectorOverrides";
import { getThemeIndex } from "@/lib/stockMaster";
import { getMarketCapsCr } from "@/lib/marketCap";

// Sector, themes and market cap for a set of symbols — shared by the
// portfolio analytics and the position sizer.
export async function classify(symbols) {
  const [sectors, themeIdx, caps] = await Promise.all([
    getResolvedSectorList().catch(() => []),
    getThemeIndex().catch(() => ({ bySymbol: {} })),
    getMarketCapsCr(symbols, { nseLimit: 30 }).catch(() => new Map()),
  ]);
  const sectorOf = new Map();
  for (const s of sectors) for (const sym of s.symbols ?? []) if (!sectorOf.has(sym)) sectorOf.set(sym, s.name);
  const themesOf = new Map(Object.entries(themeIdx.bySymbol ?? {}));
  return { sectorOf, themesOf, caps };
}
