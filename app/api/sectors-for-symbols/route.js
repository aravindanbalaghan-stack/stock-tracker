import { getSectorsForSymbols } from "@/lib/sectorOverrides";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const symbolsParam = searchParams.get("symbols");
  if (!symbolsParam) return Response.json({ error: "Missing ?symbols=SYM1,SYM2" }, { status: 400 });

  const symbols = [...new Set(symbolsParam.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean))];
  if (symbols.length === 0) return Response.json({ results: {} });

  try {
    const results = await getSectorsForSymbols(symbols);
    return Response.json({ results });
  } catch (err) {
    console.error("sectors-for-symbols: failed:", err?.message || err);
    return Response.json({ error: "Failed to resolve sectors", detail: String(err?.message || err) }, { status: 502 });
  }
}
