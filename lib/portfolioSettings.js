import { kv } from "@/lib/kv";
import { DEFAULT_SETTINGS } from "@/lib/sizing";

// Money-management rules, per account: portfolio-settings:v1:<user>
const KEY = (u) => `portfolio-settings:v1:${u}`;

const LIMITS = {
  riskPct: [0.1, 5],
  maxPositionPct: [1, 100],
  maxSectorPct: [5, 100],
  maxOpenRiskPct: [0.5, 50],
};

export async function getSettings(user) {
  try {
    return { ...DEFAULT_SETTINGS, ...((await kv.get(KEY(user))) ?? {}) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function saveSettings(user, raw) {
  const next = { ...(await getSettings(user)) };
  if (raw.capital !== undefined) {
    const c = raw.capital === null || raw.capital === "" ? null : Number(raw.capital);
    if (c !== null && !(c > 0)) throw new Error("Capital must be a positive amount");
    next.capital = c;
  }
  for (const [k, [lo, hi]] of Object.entries(LIMITS)) {
    if (raw[k] === undefined) continue;
    const v = Number(raw[k]);
    if (!Number.isFinite(v) || v < lo || v > hi) throw new Error(`${k} must be between ${lo} and ${hi}`);
    next[k] = v;
  }
  if (raw.breadthAdjust !== undefined) next.breadthAdjust = !!raw.breadthAdjust;
  await kv.set(KEY(user), next);
  return next;
}
