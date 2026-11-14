import { kv } from "@/lib/kv";
import { validateDefinition } from "@/lib/customFields";

// Saved custom screens, per account: custom-screens:v1:<user> → [{ id, name, def, createdAt, updatedAt }]
const KEY = (u) => `custom-screens:v1:${u}`;
const MAX = 30;

export async function listScreens(user) {
  const v = await kv.get(KEY(user));
  return Array.isArray(v) ? v : [];
}

export async function saveScreen(user, { id, name, def }) {
  const clean = validateDefinition(def);
  const title = String(name ?? "").trim().slice(0, 80);
  if (!title) throw new Error("Give the screen a name");
  const list = await listScreens(user);
  const now = new Date().toISOString();
  const existing = id ? list.find((s) => s.id === id) : null;
  if (existing) {
    Object.assign(existing, { name: title, def: clean, updatedAt: now });
  } else {
    if (list.length >= MAX) throw new Error(`Up to ${MAX} saved screens — delete one first`);
    list.push({ id: `cs_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, name: title, def: clean, createdAt: now, updatedAt: now });
  }
  await kv.set(KEY(user), list);
  return { list, saved: existing ?? list[list.length - 1] };
}

export async function deleteScreen(user, id) {
  const list = (await listScreens(user)).filter((s) => s.id !== id);
  await kv.set(KEY(user), list);
  return list;
}
