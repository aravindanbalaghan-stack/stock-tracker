import { getSessionUser } from "@/lib/auth";
import { getHoldings, saveHoldings, addHolding, removeHolding, updateHolding } from "@/lib/holdingsStore";
import { recordSale } from "@/lib/salesLog";

export const dynamic = "force-dynamic";

// The username comes ONLY from the signed session cookie (lib/auth.js), so
// it can't be spoofed — and the same account on any device reads and
// writes the same server-side list.
async function currentIdentity() {
  return getSessionUser();
}

function unavailable(entries) {
  return Response.json(
    {
      storage: "unavailable",
      message:
        "Server-side holdings storage isn't configured for this deployment, so your holdings are being kept in this browser only.",
      entries: entries ?? [],
    },
    { status: 200 }
  );
}

export async function GET() {
  const identity = await currentIdentity();
  if (!identity) return Response.json({ error: "Not signed in" }, { status: 401 });

  const entries = await getHoldings(identity);
  if (entries === null) return unavailable(null);
  return Response.json({ storage: "server", identity, entries });
}

export async function POST(request) {
  const identity = await currentIdentity();
  if (!identity) return Response.json({ error: "Not signed in" }, { status: 401 });

  try {
    const body = await request.json();

    // Bulk replace — used for the browser-local -> server migration on
    // first sign-in, same as the watchlist route.
    if (Array.isArray(body?.entries)) {
      const saved = await saveHoldings(identity, body.entries);
      return Response.json({ storage: "server", entries: saved });
    }

    const { symbol, quantity, avgPrice, buyDate } = body || {};
    if (!symbol) return Response.json({ error: "A symbol is required" }, { status: 400 });

    const result = await addHolding(identity, { symbol, quantity, avgPrice, buyDate });
    return Response.json({ storage: "server", ...result });
  } catch (err) {
    const msg = String(err?.message || err);
    // Storage down: answer like GET does, so the Holdings tab applies the
    // add in this browser instead of failing outright.
    if (/kv|redis|upstash|url|token|credential|not configured/i.test(msg)) return unavailable(null);
    return Response.json({ error: msg }, { status: 400 });
  }
}

export async function PATCH(request) {
  const identity = await currentIdentity();
  if (!identity) return Response.json({ error: "Not signed in" }, { status: 401 });
  try {
    const { symbol, ...body } = (await request.json()) || {};
    if (!symbol) return Response.json({ error: "A symbol is required" }, { status: 400 });
    // Only the fields the Holdings tab edits, validated.
    const patch = {};
    if (body.quantity !== undefined) {
      const q = Number(body.quantity);
      if (!(q > 0)) return Response.json({ error: "Quantity must be greater than 0" }, { status: 400 });
      patch.quantity = q;
    }
    if (body.avgPrice !== undefined) {
      const a = body.avgPrice === null || body.avgPrice === "" ? null : Number(body.avgPrice);
      if (a !== null && !(a >= 0)) return Response.json({ error: "Average price must be 0 or more" }, { status: 400 });
      patch.avgPrice = a;
    }
    if (body.buyDate !== undefined) patch.buyDate = body.buyDate || null;
    if (typeof body.notes === "string") patch.notes = body.notes.slice(0, 2000);
    for (const f of ["stopLoss", "target"]) {
      if (body[f] === undefined) continue;
      const v = body[f] === null || body[f] === "" ? null : Number(body[f]);
      if (v !== null && !(v > 0)) return Response.json({ error: `${f === "stopLoss" ? "Stop-loss" : "Target"} must be a positive price` }, { status: 400 });
      patch[f] = v;
    }
    if (body.historyEntry && typeof body.historyEntry === "object") {
      const h = body.historyEntry;
      patch.historyEntry = {
        type: ["buy", "sell", "edit"].includes(h.type) ? h.type : "edit",
        quantity: Number(h.quantity) || null,
        price: h.price != null && h.price !== "" ? Number(h.price) : null,
        date: typeof h.date === "string" ? h.date : null,
      };
    }
    // A partial sell is logged (with why) for Holdings → Closed, using the
    // position as it was before the sale.
    const before =
      patch.historyEntry?.type === "sell" ? (await getHoldings(identity))?.find((h) => h.symbol === String(symbol).trim().toUpperCase()) : null;
    const result = await updateHolding(identity, symbol, patch);
    if (before) {
      await recordSale(identity, before, {
        ...(body.sale ?? {}),
        quantity: patch.historyEntry.quantity,
        price: patch.historyEntry.price,
        date: patch.historyEntry.date,
      }).catch(() => {});
    }
    return Response.json({ storage: "server", ...result });
  } catch (err) {
    return Response.json({ error: String(err?.message || err) }, { status: 400 });
  }
}

export async function DELETE(request) {
  const identity = await currentIdentity();
  if (!identity) return Response.json({ error: "Not signed in" }, { status: 401 });
  try {
    const { searchParams } = new URL(request.url);
    const symbol = searchParams.get("symbol");
    if (!symbol) return Response.json({ error: "A symbol is required" }, { status: 400 });
    // A sale of the whole position (not just "remove"): log it with why,
    // for Holdings → Closed. Details come in the JSON body (sale) or, from
    // older clients, as ?sellPrice=&sellDate=.
    const body = await request.json().catch(() => null);
    const sale = body?.sale ?? (searchParams.get("sellPrice") ? { price: searchParams.get("sellPrice"), date: searchParams.get("sellDate") } : null);
    if (sale) {
      const held = (await getHoldings(identity))?.find((h) => h.symbol === symbol.trim().toUpperCase());
      if (held) await recordSale(identity, held, { ...sale, quantity: held.quantity });
    }
    const result = await removeHolding(identity, symbol);
    return Response.json({ storage: "server", ...result });
  } catch (err) {
    return Response.json({ error: String(err?.message || err) }, { status: 400 });
  }
}
