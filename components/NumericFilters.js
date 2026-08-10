"use client";

import { EMPTY_NUMERIC_FILTERS, hasActiveNumericFilters } from "@/lib/rowFilters";

// Price and volume bounds, rendered the same way on every screen that
// filters rows. Blank means no bound — deliberately not pre-filled with 0,
// which would silently exclude nothing while looking like a real filter.

function Field({ label, value, onChange, placeholder, width = "w-24" }) {
  return (
    <label className="flex flex-col text-[10px] uppercase tracking-wider" style={{ color: "var(--text-faint)" }}>
      {label}
      <input
        type="number"
        min="0"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={`mt-1 rounded-[var(--radius-sm)] px-2 py-1 text-sm border ${width}`}
        style={{ background: "var(--surface-2)", borderColor: "var(--border)", color: "var(--text)" }}
      />
    </label>
  );
}

export default function NumericFilters({ filters, onChange, priceLabel = "Price" }) {
  const set = (key) => (value) => onChange({ ...filters, [key]: value });
  const active = hasActiveNumericFilters(filters);

  return (
    <div className="flex items-end gap-2 flex-wrap">
      <Field label={`${priceLabel} min`} value={filters.minPrice} onChange={set("minPrice")} placeholder="any" />
      <Field label={`${priceLabel} max`} value={filters.maxPrice} onChange={set("maxPrice")} placeholder="any" />
      <Field
        label="Volume min"
        value={filters.minVolume}
        onChange={set("minVolume")}
        placeholder="e.g. 10000"
        width="w-28"
      />
      <Field label="Volume max" value={filters.maxVolume} onChange={set("maxVolume")} placeholder="any" width="w-28" />
      {active && (
        <button
          type="button"
          onClick={() => onChange({ ...EMPTY_NUMERIC_FILTERS })}
          className="px-2 py-1 rounded-[var(--radius-sm)] border text-[11px] mb-0.5"
          style={{ borderColor: "var(--border)", color: "var(--accent)" }}
          title="Clear the price and volume bounds"
        >
          Clear
        </button>
      )}
    </div>
  );
}
