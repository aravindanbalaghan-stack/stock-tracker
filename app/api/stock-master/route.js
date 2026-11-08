import {
  buildStockExport,
  importStockMaster,
  clearStockMaster,
  getStockMaster,
  getStockMasterInfo,
  getThemeIndex,
  setThemes,
} from "@/lib/stockMaster";
import { getResolvedSectorList } from "@/lib/sectorOverrides";
import { getRecentBhavcopies } from "@/lib/nseBhavcopy";
import { getSessionUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET                      → what's stored (count, last import, custom columns)
// GET ?export=1            → every stock + every detail Panel has, for the Export button
// GET ?symbol=TCS          → one stock's imported record (stock page)
// POST { rows, mode, dryRun } → import ("merge" keeps blanks as-is, "replace" starts over)
// DELETE                   → remove all imported stock data
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  try {
    if (searchParams.get("export") === "1") {
      return Response.json(await buildStockExport(await getResolvedSectorList()));
    }
    if (searchParams.get("themes") === "1") return Response.json(await getThemeIndex());
    const symbol = searchParams.get("symbol")?.trim().toUpperCase();
    if (symbol) {
      const rec = (await getStockMaster()).get(symbol) ?? null;
      return Response.json({ symbol, record: rec });
    }
    return Response.json(await getStockMasterInfo());
  } catch (err) {
    return Response.json({ error: "Couldn't load stock data", detail: String(err?.message || err) }, { status: 503 });
  }
}

export async function POST(request) {
  if (!(await getSessionUser())) return Response.json({ error: "Not signed in" }, { status: 401 });
  const body = await request.json().catch(() => null);
  if (!Array.isArray(body?.rows)) return Response.json({ error: "Expected { rows: [...] }" }, { status: 400 });
  if (body.rows.length > 20000) return Response.json({ error: "That file has more than 20,000 rows" }, { status: 400 });
  try {
    const [latest] = (await getRecentBhavcopies(1, 10)).slice(-1);
    const known = latest ? new Set(latest.bySymbol.keys()) : null;
    const result = await importStockMaster(body.rows, {
      mode: body.mode === "replace" ? "replace" : "merge",
      dryRun: body.dryRun !== false,
      knownSymbols: known,
    });
    if (!result.ok) return Response.json(result, { status: 400 });
    return Response.json(result);
  } catch (err) {
    return Response.json({ error: "Couldn't save — is the database connected?", detail: String(err?.message || err) }, { status: 503 });
  }
}

// PATCH { symbol, themes: [...] } → set one stock's themes (Sectors tab).
export async function PATCH(request) {
  if (!(await getSessionUser())) return Response.json({ error: "Not signed in" }, { status: 401 });
  const body = await request.json().catch(() => null);
  if (!body?.symbol || !Array.isArray(body.themes)) return Response.json({ error: "Expected { symbol, themes: [...] }" }, { status: 400 });
  try {
    const themes = await setThemes(body.symbol, body.themes);
    return Response.json({ ok: true, symbol: String(body.symbol).toUpperCase(), themes, index: await getThemeIndex() });
  } catch (err) {
    return Response.json({ error: String(err?.message || err) }, { status: 503 });
  }
}

export async function DELETE() {
  if (!(await getSessionUser())) return Response.json({ error: "Not signed in" }, { status: 401 });
  try {
    await clearStockMaster();
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json({ error: String(err?.message || err) }, { status: 503 });
  }
}
