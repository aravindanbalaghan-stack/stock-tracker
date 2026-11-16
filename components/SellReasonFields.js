"use client";

import { SELL_REASONS, PLAN_FOLLOWED } from "@/lib/sellReasons";
import { EMOTIONS } from "@/lib/journalStats";

// "Why are you selling?" — in the sell dialog and when editing a past
// sale on Holdings → Closed. value = { reason, followedPlan, emotions, note }

function Chip({ on, children, onClick, tone = "var(--accent)" }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className="px-2 py-1 rounded-full text-[11px] border text-left"
      style={{ borderColor: on ? tone : "var(--border)", color: on ? "var(--text)" : "var(--text-muted)", background: on ? "var(--surface-3)" : "transparent" }}
    >
      {children}
    </button>
  );
}

export default function SellReasonFields({ value, onChange, required = true }) {
  const v = { reason: null, followedPlan: null, emotions: [], note: "", ...value };
  const set = (patch) => onChange({ ...v, ...patch });
  return (
    <div className="flex flex-col gap-3">
      <fieldset className="flex flex-col gap-1.5">
        <legend className="text-[10px] uppercase tracking-wider mb-1" style={{ color: "var(--text-faint)" }}>
          Why are you selling?{required && <span style={{ color: "var(--loss)" }}> *</span>}
        </legend>
        <div className="flex flex-wrap gap-1.5">
          {SELL_REASONS.map((r) => (
            <Chip key={r.id} on={v.reason === r.id} onClick={() => set({ reason: v.reason === r.id ? null : r.id })}>
              {r.label}
            </Chip>
          ))}
        </div>
      </fieldset>
      <fieldset className="flex flex-col gap-1.5">
        <legend className="text-[10px] uppercase tracking-wider mb-1" style={{ color: "var(--text-faint)" }}>
          Did you follow your plan?
        </legend>
        <div className="flex flex-wrap gap-1.5">
          {PLAN_FOLLOWED.map((p) => (
            <Chip key={p.id} on={v.followedPlan === p.id} onClick={() => set({ followedPlan: v.followedPlan === p.id ? null : p.id })} tone="var(--tier-low)">
              {p.label}
            </Chip>
          ))}
        </div>
      </fieldset>
      <fieldset className="flex flex-col gap-1.5">
        <legend className="text-[10px] uppercase tracking-wider mb-1" style={{ color: "var(--text-faint)" }}>
          How did you feel? (optional)
        </legend>
        <div className="flex flex-wrap gap-1.5">
          {EMOTIONS.map((e) => {
            const on = v.emotions.includes(e);
            return (
              <Chip key={e} on={on} tone="var(--tier-mid)" onClick={() => set({ emotions: on ? v.emotions.filter((x) => x !== e) : [...v.emotions, e] })}>
                {e}
              </Chip>
            );
          })}
        </div>
      </fieldset>
      <label className="flex flex-col gap-1">
        <span className="text-[10px] uppercase tracking-wider" style={{ color: "var(--text-faint)" }}>
          Notes (optional)
        </span>
        <textarea
          rows={2}
          value={v.note}
          onChange={(e) => set({ note: e.target.value })}
          placeholder="What made you decide — what you saw on the chart, the news, the number…"
          className="rounded px-2 py-1.5 text-sm outline-none border w-full"
          style={{ background: "var(--surface-2)", borderColor: "var(--border)", color: "var(--text)" }}
        />
      </label>
    </div>
  );
}
