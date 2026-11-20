// Small readers for NSE's public archive files (nsearchives.nseindia.com) —
// the same host the bhavcopy comes from, which needs no cookie handshake.
//
//   ind_close_all_DDMMYYYY.csv      every NSE index's OHLC for one day
//   fao_participant_oi_DDMMYYYY.csv open interest by participant (Client /
//                                   DII / FII / Pro) in equity derivatives

import { BROWSER_UA as UA } from "@/lib/browserUA";

const BASE = "https://nsearchives.nseindia.com";

export const ddmmyyyy = (iso) => `${iso.slice(8, 10)}${iso.slice(5, 7)}${iso.slice(0, 4)}`;

/** Split one CSV line, honouring double quotes. */
export function splitCsvLine(line) {
  const out = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (q && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else q = !q;
    } else if (ch === "," && !q) {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

/**
 * CSV → objects. `headerMatch` finds the header line (archive files often
 * start with a title line); keys are trimmed and lower-cased.
 */
export function parseCsvRows(text, headerMatch = () => true) {
  const lines = String(text ?? "").replace(/\r/g, "").split("\n").filter((l) => l.trim());
  const h = lines.findIndex((l) => headerMatch(l));
  if (h < 0) return [];
  const headers = splitCsvLine(lines[h]).map((x) => x.replace(/\s+/g, " ").trim().toLowerCase());
  const rows = [];
  for (const line of lines.slice(h + 1)) {
    const cells = splitCsvLine(line);
    if (cells.length < Math.min(3, headers.length)) continue;
    const row = {};
    headers.forEach((k, i) => (row[k] = cells[i] ?? ""));
    rows.push(row);
  }
  return rows;
}

export const num = (s) => {
  if (s == null) return null;
  const t = String(s).replace(/[,\s₹]/g, "").replace(/^\((.*)\)$/, "-$1");
  if (t === "" || t === "-") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

async function fetchText(path, ageDays) {
  try {
    const res = await fetch(`${BASE}${path}`, {
      headers: { "User-Agent": UA, Accept: "text/csv,*/*" },
      next: { revalidate: ageDays <= 2 ? 1800 : 604800 },
    });
    if (!res.ok) return null;
    const text = await res.text();
    if (!text || text.trimStart().startsWith("<")) return null; // HTML error page = no file
    return text;
  } catch {
    return null;
  }
}

const ageOf = (iso) => Math.round((Date.now() - Date.parse(`${iso}T00:00:00Z`)) / 86400000);

/** { "nifty 50": {o,h,l,c}, "nifty bank": {...}, … } for one session, or null. */
export async function indexClosesOn(iso) {
  const text = await fetchText(`/content/indices/ind_close_all_${ddmmyyyy(iso)}.csv`, ageOf(iso));
  if (!text) return null;
  const rows = parseCsvRows(text, (l) => /index name/i.test(l));
  const out = {};
  for (const r of rows) {
    const name = (r["index name"] ?? "").toLowerCase();
    const c = num(r["closing index value"]);
    if (!name || c == null) continue;
    out[name] = { o: num(r["open index value"]), h: num(r["high index value"]), l: num(r["low index value"]), c };
  }
  return Object.keys(out).length ? out : null;
}

/** Participant-wise open interest for one session, keyed client / dii / fii / pro / total. */
export async function participantOiOn(iso) {
  const text = await fetchText(`/content/nsccl/fao_participant_oi_${ddmmyyyy(iso)}.csv`, ageOf(iso));
  if (!text) return null;
  const rows = parseCsvRows(text, (l) => /client type/i.test(l));
  const pick = (r, re) => {
    const k = Object.keys(r).find((key) => re.test(key));
    return k ? num(r[k]) : null;
  };
  const out = {};
  for (const r of rows) {
    const who = (r["client type"] ?? "").toLowerCase();
    if (!who) continue;
    out[who] = {
      futIdxLong: pick(r, /future index long/),
      futIdxShort: pick(r, /future index short/),
      futStkLong: pick(r, /future stock long/),
      futStkShort: pick(r, /future stock short/),
      callIdxLong: pick(r, /option index call long/),
      putIdxLong: pick(r, /option index put long/),
      callIdxShort: pick(r, /option index call short/),
      putIdxShort: pick(r, /option index put short/),
      totalLong: pick(r, /total long/),
      totalShort: pick(r, /total short/),
    };
  }
  return out.fii ? out : null;
}
