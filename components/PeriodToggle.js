"use client";

const PERIODS = [
  { id: "daily", label: "Daily" },
  { id: "weekly", label: "Weekly" },
  { id: "monthly", label: "Monthly" },
];

export default function PeriodToggle({ period, onChange }) {
  return (
    <div className="inline-flex rounded-md border overflow-hidden" style={{ borderColor: "var(--border)" }}>
      {PERIODS.map((p) => {
        const active = period === p.id;
        return (
          <button
            key={p.id}
            type="button"
            onClick={() => onChange(p.id)}
            className="px-3 py-1.5 text-xs font-medium transition-colors"
            style={{
              background: active ? "var(--accent)" : "transparent",
              color: active ? "var(--surface)" : "var(--text-muted)",
            }}
          >
            {p.label}
          </button>
        );
      })}
    </div>
  );
}
