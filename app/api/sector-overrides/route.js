import {
  getResolvedSectorList,
  addSymbolToSector,
  removeSymbolFromSector,
  excludeSymbolFromSector,
  includeSymbolInSector,
  moveSymbolToSector,
  getAllClassifiedSymbols,
  exportSectorCustomizations,
  importSectorCustomizations,
  isSectorStorageAvailable,
} from "@/lib/sectorOverrides";

export const dynamic = "force-dynamic";

function storageError(err) {
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

export async function GET(request) {
  const { searchParams } = new URL(request.url);

  // Sector Manager tab's Export button — the raw overlay data (what's
  // been added or excluded on top of the base lists), not the full
  // resolved membership, so re-importing it elsewhere reproduces exactly
  // the same customizations rather than a frozen snapshot of the whole
  // universe.
  if (searchParams.get("export") === "1") {
    try {
      const data = await exportSectorCustomizations();
      return Response.json(data);
    } catch (err) {
      return storageError(err);
    }
  }

  try {
    const sectors = await getResolvedSectorList();
    const full = searchParams.get("full") === "1";
    return Response.json({
      sectors: sectors.map((s) => ({
        key: s.key,
        name: s.name,
        count: s.symbols.length,
        addedSymbols: s.addedSymbols,
        excludedSymbols: s.excludedSymbols,
        ...(full ? { symbols: s.symbols } : {}),
      })),
      // Symbol-centric view — what the Sector Manager tab's main table
      // renders. Only included on request since it's the full classified
      // universe, unlike the per-sector summary above.
      ...(full ? { classified: await getAllClassifiedSymbols(), storageAvailable: await isSectorStorageAvailable() } : {}),
    });
  } catch (err) {
    return Response.json({ error: String(err?.message || err) }, { status: 502 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json();

    // Sector Manager tab's Import button — wholesale replace of both
    // overlays (see importSectorCustomizations's own comment for why
    // replace rather than merge).
    if (body?.import) {
      await importSectorCustomizations(body.import);
      return Response.json({ imported: true });
    }

    // "Change sector" — move a symbol from one sector to another in one
    // call, used when a stock is filed under the wrong sector rather than
    // missing one entirely.
    if (body?.move) {
      const { symbol, from, to } = body.move;
      if (!symbol || !to) {
        return Response.json({ error: "symbol and a target sector (to) are required" }, { status: 400 });
      }
      await moveSymbolToSector(symbol, from || null, to);
      return Response.json({ moved: true });
    }

    const { sector, symbol, action } = body || {};
    if (!sector || !symbol) {
      return Response.json({ error: "Both sector and symbol are required" }, { status: 400 });
    }

    // Undoing a base-sector exclusion — restores a symbol that was
    // previously removed from this sector's base membership.
    if (action === "include") {
      await includeSymbolInSector(sector, symbol);
      return Response.json({ included: true });
    }

    // Removing a symbol from a sector's BASE (hand-maintained) list —
    // for a wrongly-classified stock, as opposed to removeSymbolFromSector
    // (via DELETE below) which only undoes a manual addition.
    if (action === "exclude") {
      await excludeSymbolFromSector(sector, symbol);
      return Response.json({ excluded: true });
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
    return storageError(err);
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
