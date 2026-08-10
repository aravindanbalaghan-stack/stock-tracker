import {
  getResolvedSectorList,
  addSymbolToSector,
  removeSymbolFromSector,
} from "@/lib/sectorOverrides";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const sectors = await getResolvedSectorList();
    return Response.json({
      sectors: sectors.map((s) => ({
        key: s.key,
        name: s.name,
        count: s.symbols.length,
        addedSymbols: s.addedSymbols,
      })),
    });
  } catch (err) {
    return Response.json({ error: String(err?.message || err) }, { status: 502 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    const { sector, symbol } = body || {};
    if (!sector || !symbol) {
      return Response.json({ error: "Both sector and symbol are required" }, { status: 400 });
    }
    const result = await addSymbolToSector(sector, symbol);
    if (!result.added) {
      return Response.json(
        {
          added: false,
          message:
            result.reason === "already-in-sector"
              ? `${symbol.toUpperCase()} is already part of this sector.`
              : `${symbol.toUpperCase()} has already been added to this sector.`,
        },
        { status: 200 }
      );
    }
    return Response.json({ added: true });
  } catch (err) {
    const msg = String(err?.message || err);
    // A missing KV binding is the likeliest failure on a fresh deploy, and
    // it needs a different answer than a bad request.
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

export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const sector = searchParams.get("sector");
    const symbol = searchParams.get("symbol");
    if (!sector || !symbol) {
      return Response.json({ error: "Both sector and symbol are required" }, { status: 400 });
    }
    await removeSymbolFromSector(sector, symbol);
    return Response.json({ removed: true });
  } catch (err) {
    return Response.json({ error: String(err?.message || err) }, { status: 400 });
  }
}
