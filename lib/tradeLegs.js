// A trade as a series of fills ("legs"): the first buy, any adds (averaging),
// and any partial or full exits. Pure functions, shared by the form, the
// stats and the server.
//
// Cost is tracked on the average-cost method, the way Indian brokers show a
// position: adding shares re-averages the cost, an exit books
// (exit price − average cost) × quantity and leaves the average unchanged.
// For a Short trade "entry" legs are sells and "exit" legs are buy-backs.

const r2 = (n) => (n == null || !Number.isFinite(n) ? null : Math.round(n * 100) / 100);
const r4 = (n) => (n == null || !Number.isFinite(n) ? null : Math.round(n * 10000) / 10000);
const numOr = (v) => (v === "" || v == null || !Number.isFinite(Number(v)) ? null : Number(v));
const isoDate = (v) => {
  const s = String(v ?? "").trim().slice(0, 30);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = s ? new Date(s) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toISOString().slice(0, 10) : null;
};

/** Cleans a list of legs; drops rows without a positive quantity and price. */
export function normaliseLegs(list) {
  if (typeof list === "string") list = parseLegString(list);
  if (!Array.isArray(list)) return [];
  return list
    .map((l, i) => ({
      id: String(l?.id ?? `l${i}`).slice(0, 40),
      kind: l?.kind === "exit" ? "exit" : "entry",
      date: isoDate(l?.date),
      qty: numOr(l?.qty),
      price: numOr(l?.price),
    }))
    .filter((l) => l.date && l.qty > 0 && l.price > 0)
    .slice(0, 60);
}

/** Legs for a trade saved before legs existed: one entry, maybe one exit. */
export function legsFromFields(t) {
  const out = [];
  const q = numOr(t?.quantity);
  const e = numOr(t?.entryPrice);
  if (q > 0 && e > 0 && t?.entryDate) out.push({ id: "l0", kind: "entry", date: isoDate(t.entryDate), qty: q, price: e });
  const x = numOr(t?.exitPrice);
  if (q > 0 && x > 0) out.push({ id: "l1", kind: "exit", date: isoDate(t.exitDate) ?? isoDate(t.entryDate), qty: q, price: x });
  return out.filter((l) => l.date);
}

export const legsOf = (t) => (Array.isArray(t?.legs) && t.legs.some((l) => l.kind === "entry") ? normaliseLegs(t.legs) : legsFromFields(t));

/**
 * Walks the legs in date order (same-day legs keep the order entered).
 * Returns the position, realised P&L and each exit's booking — or an
 * `error` when an exit sells more than is held at that point.
 */
export function positionOf(legs, side = "Long") {
  const dir = side === "Short" ? -1 : 1;
  const ordered = legs.map((l, i) => ({ ...l, i })).sort((a, b) => (a.date === b.date ? a.i - b.i : a.date < b.date ? -1 : 1));
  let pos = 0;
  let avg = 0;
  let entered = 0;
  let enteredValue = 0;
  let exited = 0;
  let exitedValue = 0;
  let realised = 0;
  const realisations = [];
  let error = null;
  for (const l of ordered) {
    if (l.kind === "entry") {
      avg = (avg * pos + l.price * l.qty) / (pos + l.qty);
      pos += l.qty;
      entered += l.qty;
      enteredValue += l.price * l.qty;
    } else {
      if (l.qty > pos + 1e-9) {
        error = `The exit on ${l.date} is for ${l.qty}, but only ${pos} ${pos === 1 ? "is" : "are"} held at that point`;
        break;
      }
      const gross = (l.price - avg) * l.qty * dir;
      realised += gross;
      realisations.push({ date: l.date, qty: l.qty, price: l.price, avgCost: r4(avg), gross: r2(gross) });
      pos -= l.qty;
      exited += l.qty;
      exitedValue += l.price * l.qty;
      if (pos < 1e-9) {
        pos = 0;
        avg = 0;
      }
    }
  }
  const entries = ordered.filter((l) => l.kind === "entry");
  const exits = ordered.filter((l) => l.kind === "exit");
  return {
    error,
    entered,
    entryAvg: entered ? r4(enteredValue / entered) : null,
    exited,
    exitAvg: exited ? r4(exitedValue / exited) : null,
    openQty: pos,
    openAvg: pos ? r4(avg) : null,
    realisedGross: r2(realised),
    realisations,
    firstEntry: entries[0]?.date ?? null,
    lastExit: exits.at(-1)?.date ?? null,
    adds: Math.max(0, entries.length - 1),
    exitsCount: exits.length,
    status: entered === 0 ? "Open" : pos === 0 && exited > 0 ? "Closed" : exited > 0 ? "Partial" : "Open",
  };
}

/** "E 2026-11-03 50@1012.5; X 2026-11-10 20@1080" — how legs travel in CSV / Excel exports. */
export const legString = (legs) => legs.map((l) => `${l.kind === "exit" ? "X" : "E"} ${l.date} ${l.qty}@${l.price}`).join("; ");

export function parseLegString(s) {
  return String(s ?? "")
    .split(/;\s*/)
    .map((part) => part.trim().match(/^([EX])\s+(\d{4}-\d{2}-\d{2})\s+([\d.]+)\s*@\s*([\d.]+)$/i))
    .filter(Boolean)
    .map((m, i) => ({ id: `l${i}`, kind: m[1].toUpperCase() === "X" ? "exit" : "entry", date: m[2], qty: Number(m[3]), price: Number(m[4]) }));
}
