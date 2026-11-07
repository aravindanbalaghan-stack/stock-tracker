// Stock master data — the details YOU supply for each stock (sector,
// industry, market cap, name, and any extra columns you like), imported
// from a CSV / Excel / JSON file on the Stock Data tab.
//
// Once imported, the rest of the app uses it:
//   - Sectors: a stock with a sector here is placed in THAT sector (or
//     sectors, separated by ";") everywhere sectors are used — the sector
//     screens, sector delivery, the stock page, Holdings — and taken out of
//     any built-in sector list that disagrees. A sector name that doesn't
//     match an existing sector becomes a new sector.
//   - Market cap: used instead of asking NSE (lib/marketCap.js), so screens
//     with a market-cap floor work even when NSE blocks the lookup.
//   - Name / industry / your own columns: shown on the stock page and
//     included in every export.
//
// Stored in Redis in chunks (MASTER_CHUNK symbols per key) to stay well
// under Upstash's per-request size limit.

import { kv } from "@/lib/kv";
import { getRecentBhavcopies } from "@/lib/nseBhavcopy";
import { SECTOR_LIST } from "@/lib/sectors";

const INDEX_KEY = "master:index:v1";
const CHUNK_PREFIX = "master:chunk:v1:";
const MASTER_CHUNK = 400;
const MEMO_MS = 30 * 1000;

let memo = null; // { at, map, index }

// ---------------------------------------------------------------------
// Column handling
// ---------------------------------------------------------------------

/** Columns Panel itself understands, and the header spellings accepted for each. */
export const EDITABLE_FIELDS = {
  name: ["name", "company", "company name", "companyname", "name of company"],
  sector: ["sector", "sectors"],
  industry: ["industry", "basic industry", "sub sector", "subsector"],
  marketCapCr: ["marketcapcr", "market cap cr", "market cap (cr)", "market cap (₹ cr)", "mcap", "mcap cr", "market cap", "marketcap"],
};

/** Columns that only exist in the export (computed live) — ignored on import. */
export const READ_ONLY_COLUMNS = [
  "isin",
  "series",
  "listingDate",
  "faceValue",
  "currentSectors",
  "lastClose",
  "changePct",
  "volume",
  "turnoverCr",
  "deliveryPct",
  "avgTurnover20Cr",
  "avgDelivery20Pct",
  "asOf",
  "masterUpdatedAt",
];

const norm = (h) => String(h ?? "").trim().toLowerCase().replace(/[_\s]+/g, " ");

function fieldFor(header) {
  const h = norm(header);
  for (const [field, names] of Object.entries(EDITABLE_FIELDS)) {
    if (names.includes(h) || h === field.toLowerCase()) return field;
  }
  return null;
}

const SYMBOL_HEADERS = ["symbol", "nse symbol", "ticker", "nse code", "scrip", "stock"];
const READ_ONLY_SET = new Set(READ_ONLY_COLUMNS.map((c) => norm(c)));

function toNumber(v) {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const n = Number(String(v).replace(/[₹,\s]/g, ""));
  return Number.isFinite(n) ? n : null;
}

export function splitSectors(v) {
  return String(v ?? "")
    .split(/[;|]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// ---------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------

async function loadAll() {
  const index = await kv.get(INDEX_KEY);
  if (!index?.chunks) return { index: null, map: new Map() };
  const chunks = await Promise.all(Array.from({ length: index.chunks }, (_, i) => kv.get(`${CHUNK_PREFIX}${i}`)));
  const map = new Map();
  for (const c of chunks) for (const [s, r] of Object.entries(c ?? {})) map.set(s, r);
  return { index, map };
}

/** Map symbol → { name, sectors[], industry, marketCapCr, custom{} }. Never throws. */
export async function getStockMaster() {
  if (memo && Date.now() - memo.at < MEMO_MS) return memo.map;
  // An import may have happened on another server instance: re-read the
  // small index first and keep the cached chunks if nothing changed.
  if (memo) {
    try {
      const index = await kv.get(INDEX_KEY);
      if ((index?.updatedAt ?? null) === (memo.index?.updatedAt ?? null)) {
        memo.at = Date.now();
        return memo.map;
      }
    } catch {
      return memo.map;
    }
  }
  try {
    const { index, map } = await loadAll();
    memo = { at: Date.now(), map, index };
  } catch {
    memo = { at: Date.now(), map: new Map(), index: null };
  }
  return memo.map;
}

export async function getStockMasterInfo() {
  await getStockMaster();
  return memo.index ? { count: memo.index.count, updatedAt: memo.index.updatedAt, customColumns: memo.index.customColumns ?? [] } : { count: 0 };
}

async function saveAll(map, customColumns) {
  const symbols = [...map.keys()].sort();
  const chunks = [];
  for (let i = 0; i < symbols.length; i += MASTER_CHUNK) {
    chunks.push(Object.fromEntries(symbols.slice(i, i + MASTER_CHUNK).map((s) => [s, map.get(s)])));
  }
  const old = await kv.get(INDEX_KEY);
  await Promise.all(chunks.map((c, i) => kv.set(`${CHUNK_PREFIX}${i}`, c)));
  for (let i = chunks.length; i < (old?.chunks ?? 0); i++) await kv.del(`${CHUNK_PREFIX}${i}`);
  const index = { chunks: chunks.length, count: symbols.length, updatedAt: new Date().toISOString(), customColumns };
  await kv.set(INDEX_KEY, index);
  memo = { at: Date.now(), map, index };
  return index;
}

export async function clearStockMaster() {
  const old = await kv.get(INDEX_KEY);
  for (let i = 0; i < (old?.chunks ?? 0); i++) await kv.del(`${CHUNK_PREFIX}${i}`);
  await kv.del(INDEX_KEY);
  memo = null;
}

// ---------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------

/**
 * rows: array of plain objects (header → value) as parsed from the file.
 * mode: "merge" (default — blank cells keep what's stored) or "replace"
 * (start from nothing). dryRun: report what would change without saving.
 */
export async function importStockMaster(rows, { mode = "merge", dryRun = false, knownSymbols = null } = {}) {
  if (!Array.isArray(rows) || !rows.length) return { ok: false, error: "The file has no rows" };
  const headers = Object.keys(rows[0] ?? {});
  const symbolHeader = headers.find((h) => SYMBOL_HEADERS.includes(norm(h)));
  if (!symbolHeader) return { ok: false, error: `No symbol column found — name one of the columns "symbol"` };

  const fieldHeaders = {};
  const customHeaders = [];
  const ignored = [];
  for (const h of headers) {
    if (h === symbolHeader) continue;
    const f = fieldFor(h);
    if (f) fieldHeaders[f] = h;
    else if (READ_ONLY_SET.has(norm(h))) ignored.push(h);
    else if (String(h).trim()) customHeaders.push(String(h).trim());
  }

  const existing = mode === "replace" ? new Map() : new Map(await getStockMaster());
  const next = new Map(existing);
  const knownSectorNames = new Set(SECTOR_LIST.map((s) => s.name.toLowerCase()));
  const stats = { rows: rows.length, updated: 0, added: 0, skipped: 0, unknownSymbols: [], newSectors: new Set(), duplicateSymbols: 0 };
  const seen = new Set();

  for (const row of rows) {
    const symbol = String(row[symbolHeader] ?? "").trim().toUpperCase();
    if (!symbol) {
      stats.skipped++;
      continue;
    }
    if (seen.has(symbol)) stats.duplicateSymbols++;
    seen.add(symbol);
    if (knownSymbols && !knownSymbols.has(symbol)) stats.unknownSymbols.push(symbol);

    const prev = next.get(symbol) ?? {};
    const rec = { ...prev, custom: { ...(prev.custom ?? {}) } };
    let touched = false;
    const set = (k, v) => {
      if (v === null || v === undefined || v === "") return; // blank keeps what's there
      rec[k] = v;
      touched = true;
    };
    if (fieldHeaders.name) set("name", String(row[fieldHeaders.name] ?? "").trim());
    if (fieldHeaders.industry) set("industry", String(row[fieldHeaders.industry] ?? "").trim());
    if (fieldHeaders.marketCapCr) set("marketCapCr", toNumber(row[fieldHeaders.marketCapCr]));
    if (fieldHeaders.sector) {
      const sectors = splitSectors(row[fieldHeaders.sector]);
      if (sectors.length) {
        rec.sectors = sectors;
        touched = true;
        for (const s of sectors) if (!knownSectorNames.has(s.toLowerCase())) stats.newSectors.add(s);
      }
    }
    for (const h of customHeaders) {
      const v = row[h];
      if (v === null || v === undefined || v === "") continue;
      rec.custom[h] = typeof v === "number" ? v : String(v).trim();
      touched = true;
    }
    if (!touched) {
      stats.skipped++;
      continue;
    }
    if (next.has(symbol)) stats.updated++;
    else stats.added++;
    rec.updatedAt = new Date().toISOString();
    next.set(symbol, rec);
  }

  const customColumns = [...new Set([...(mode === "replace" ? [] : memo?.index?.customColumns ?? []), ...customHeaders])];
  const summary = {
    ok: true,
    dryRun,
    mode,
    symbolColumn: symbolHeader,
    columnsUsed: Object.fromEntries(Object.entries(fieldHeaders)),
    customColumns: customHeaders,
    ignoredColumns: ignored,
    rows: stats.rows,
    added: stats.added,
    updated: stats.updated,
    skipped: stats.skipped,
    duplicateSymbols: stats.duplicateSymbols,
    unknownSymbols: stats.unknownSymbols.length,
    unknownSample: stats.unknownSymbols.slice(0, 15),
    newSectors: [...stats.newSectors].slice(0, 50),
    totalAfter: next.size,
  };
  if (dryRun) return summary;
  const index = await saveAll(next, customColumns);
  return { ...summary, savedAt: index.updatedAt };
}

// ---------------------------------------------------------------------
// Lookups used across the app
// ---------------------------------------------------------------------

export async function getMasterMarketCapCr(symbol) {
  const r = (await getStockMaster()).get(symbol);
  return typeof r?.marketCapCr === "number" ? r.marketCapCr : null;
}

const slug = (s) =>
  String(s)
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

/**
 * Applies master sectors on top of a resolved sector list (see
 * getResolvedSectorList). A symbol with master sectors ends up in exactly
 * those sectors; unmatched sector names become new sectors.
 */
export async function applyMasterSectors(list) {
  const master = await getStockMaster();
  const assigned = new Map(); // symbol → Set(lower-case sector names)
  for (const [symbol, r] of master) {
    if (r.sectors?.length) assigned.set(symbol, new Set(r.sectors.map((s) => s.toLowerCase())));
  }
  if (!assigned.size) return list;

  const byName = new Map(list.map((s) => [s.name.toLowerCase(), s]));
  const byKey = new Map(list.map((s) => [s.key, s]));
  const out = list.map((s) => {
    const name = s.name.toLowerCase();
    const keep = s.symbols.filter((sym) => !assigned.has(sym) || assigned.get(sym).has(name) || assigned.get(sym).has(s.key));
    const addedByMaster = [];
    for (const [sym, names] of assigned) {
      if ((names.has(name) || names.has(s.key)) && !keep.includes(sym)) addedByMaster.push(sym);
    }
    return { ...s, symbols: [...keep, ...addedByMaster], masterSymbols: addedByMaster };
  });

  // Sector names that don't match any existing sector become new sectors.
  const extra = new Map();
  for (const [sym, names] of assigned) {
    for (const lower of names) {
      if (byName.has(lower) || byKey.has(lower)) continue;
      const display = master.get(sym).sectors.find((s) => s.toLowerCase() === lower) ?? lower;
      const key = `x-${slug(display)}`;
      if (!extra.has(key)) extra.set(key, { key, name: display, symbols: [], addedSymbols: [], excludedSymbols: [], masterSymbols: [], fromMaster: true });
      extra.get(key).symbols.push(sym);
      extra.get(key).masterSymbols.push(sym);
    }
  }
  return [...out, ...[...extra.values()].sort((a, b) => a.name.localeCompare(b.name))];
}

// ---------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

// NSE's list of every listed equity: name, ISIN, listing date, face value.
async function fetchEquityList() {
  try {
    const res = await fetch("https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv", {
      headers: { "User-Agent": UA, Accept: "text/csv" },
      next: { revalidate: 86400 },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return new Map();
    const text = await res.text();
    const lines = text.split(/\r?\n/).filter(Boolean);
    const head = lines[0].split(",").map((h) => h.trim().toUpperCase());
    const idx = (n) => head.findIndex((h) => h.includes(n));
    const iSym = idx("SYMBOL");
    const iName = idx("NAME OF COMPANY");
    const iSeries = idx("SERIES");
    const iList = idx("DATE OF LISTING");
    const iIsin = idx("ISIN");
    const iFace = idx("FACE VALUE");
    const map = new Map();
    for (const line of lines.slice(1)) {
      // Company names can contain commas inside quotes.
      const cells = line.match(/("([^"]|"")*"|[^,]*)(,|$)/g)?.map((c) => c.replace(/,$/, "").replace(/^"|"$/g, "").replace(/""/g, '"').trim()) ?? [];
      const sym = cells[iSym];
      if (!sym) continue;
      map.set(sym, {
        name: cells[iName] ?? null,
        series: cells[iSeries] ?? null,
        listingDate: cells[iList] ?? null,
        isin: cells[iIsin] ?? null,
        faceValue: cells[iFace] ? Number(cells[iFace]) : null,
      });
    }
    return map;
  } catch {
    return new Map();
  }
}

/**
 * Every stock Panel knows, one row each: NSE's own details, the live
 * figures from the latest bhavcopies, its current sectors, and everything
 * from the master data (including your custom columns).
 */
export async function buildStockExport(resolvedSectors) {
  const [days, equityList, master] = await Promise.all([getRecentBhavcopies(20, 45), fetchEquityList(), getStockMaster()]);
  const latest = days[days.length - 1];
  const sectorsBySymbol = new Map();
  for (const s of resolvedSectors) for (const sym of s.symbols) sectorsBySymbol.set(sym, [...(sectorsBySymbol.get(sym) ?? []), s.name]);

  const symbols = new Set([...(latest ? [...latest.bySymbol.entries()].filter(([, r]) => ["EQ", "BE", "BZ", "SM", "ST"].includes(r.series)).map(([s]) => s) : []), ...master.keys()]);
  const customColumns = [...new Set([...master.values()].flatMap((r) => Object.keys(r.custom ?? {})))];
  const r2 = (n) => (n == null || !Number.isFinite(n) ? null : Math.round(n * 100) / 100);

  const rows = [...symbols].sort().map((symbol) => {
    const nse = equityList.get(symbol) ?? {};
    const m = master.get(symbol) ?? {};
    const today = latest?.bySymbol.get(symbol);
    let tv = 0;
    let tn = 0;
    let dq = 0;
    let dv = 0;
    for (const d of days) {
      const r = d.bySymbol.get(symbol);
      if (!r?.volume || r.close == null) continue;
      tv += r.close * r.volume;
      tn++;
      dq += r.deliveryQty || 0;
      dv += r.volume;
    }
    const row = {
      symbol,
      name: m.name ?? nse.name ?? "",
      sector: (m.sectors ?? []).join("; "),
      industry: m.industry ?? "",
      marketCapCr: m.marketCapCr ?? "",
      currentSectors: (sectorsBySymbol.get(symbol) ?? []).join("; "),
      isin: nse.isin ?? "",
      series: today?.series ?? nse.series ?? "",
      listingDate: nse.listingDate ?? "",
      faceValue: nse.faceValue ?? "",
      lastClose: today?.close ?? "",
      changePct: today?.prevClose && today?.close ? r2(((today.close - today.prevClose) / today.prevClose) * 100) : "",
      volume: today?.volume ?? "",
      turnoverCr: today?.close && today?.volume ? r2((today.close * today.volume) / 1e7) : "",
      deliveryPct: today?.deliveryPct ?? "",
      avgTurnover20Cr: tn ? r2(tv / tn / 1e7) : "",
      avgDelivery20Pct: dv ? r2((dq / dv) * 100) : "",
      asOf: latest?.date ?? "",
      masterUpdatedAt: m.updatedAt ?? "",
    };
    for (const c of customColumns) row[c] = m.custom?.[c] ?? "";
    return row;
  });

  return {
    asOf: latest?.date ?? null,
    columns: [
      "symbol",
      "name",
      "sector",
      "industry",
      "marketCapCr",
      ...customColumns,
      ...READ_ONLY_COLUMNS.filter((c) => c !== "masterUpdatedAt"),
      "masterUpdatedAt",
    ],
    editableColumns: ["name", "sector", "industry", "marketCapCr", ...customColumns],
    readOnlyColumns: READ_ONLY_COLUMNS,
    rows,
    knownSymbols: [...symbols],
  };
}
