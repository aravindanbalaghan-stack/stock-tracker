"use client";

// Shared "as of" date picker. The routes keep roughly a month of trading
// days behind whatever date is chosen, so the range is bounded to about a
// calendar month — picking further back would silently return a shorter
// lookback than the screens assume.

function todayIST() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

function earliest() {
  const d = new Date();
  d.setDate(d.getDate() - 31);
  return d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

export default function DatePicker({ value, onChange, disabled = false, label = "As of" }) {
  return (
    <label
      className="flex items-center gap-1.5 text-xs"
      style={{ color: "var(--text-faint)", opacity: disabled ? 0.4 : 1 }}
    >
      {label}
      <input
        type="date"
        value={value}
        min={earliest()}
        max={todayIST()}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-[var(--radius-sm)] px-2 py-1 text-sm border"
        style={{ background: "var(--surface-2)", borderColor: "var(--border)", color: "var(--text)" }}
      />
      {value && !disabled && (
        <button
          type="button"
          onClick={() => onChange("")}
          className="px-1.5 py-0.5 rounded border text-[11px]"
          style={{ borderColor: "var(--border)", color: "var(--accent)" }}
          title="Back to the latest session"
        >
          Latest
        </button>
      )}
    </label>
  );
}
