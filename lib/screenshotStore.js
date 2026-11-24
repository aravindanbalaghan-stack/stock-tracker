// Trade screenshots — stored in the app's Upstash Redis, one key per image.
// Images are shrunk in the browser before upload (lib/imageCompress.js:
// ≤ 1600px, WebP), so each is typically 100–250 KB. A trade only keeps
// the ids; the bytes are served by app/api/journal/screenshots.

import { kv } from "@/lib/kv";

export const MAX_SHOTS_PER_TRADE = 12;
const MAX_BASE64 = 1_400_000; // ≈ 1 MB of image
const TYPES = new Set(["image/webp", "image/jpeg", "image/png"]);
const key = (user, id) => `journal-shot:v1:${user}:${id}`;
export const isShotId = (id) => typeof id === "string" && /^[a-z0-9]{8,32}$/.test(id);

export async function putShot(user, { data, type, w, h }) {
  if (!TYPES.has(type)) throw new Error("Only PNG, JPEG or WebP images");
  const b64 = String(data ?? "").replace(/^data:[^,]+,/, "");
  if (!b64 || !/^[A-Za-z0-9+/=]+$/.test(b64)) throw new Error("That image couldn't be read");
  if (b64.length > MAX_BASE64) throw new Error("That image is too large even after shrinking — try a smaller screenshot");
  const id = (Date.now().toString(36) + Math.random().toString(36).slice(2, 10)).slice(0, 20);
  await kv.set(key(user, id), { type, data: b64, w: Number(w) || null, h: Number(h) || null, at: new Date().toISOString() });
  return { id, w: Number(w) || null, h: Number(h) || null };
}

export async function getShot(user, id) {
  if (!isShotId(id)) return null;
  return kv.get(key(user, id));
}

export async function deleteShots(user, ids) {
  const good = (ids ?? []).filter(isShotId);
  if (good.length) await kv.del(...good.map((id) => key(user, id)));
}

/** A trade's screenshot list: [{id, w, h}], valid ids only, capped. */
export function normaliseShots(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  for (const s of list) {
    const id = typeof s === "string" ? s : s?.id;
    if (!isShotId(id) || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, w: Number(s?.w) || null, h: Number(s?.h) || null });
    if (out.length >= MAX_SHOTS_PER_TRADE) break;
  }
  return out;
}
