"use client";

// Shared layout chrome so every screen in the app is built from the same
// pieces. Before this, each tab hand-rolled its own header markup and
// spacing, which is why the app read as scattered — same information,
// different shape on every screen.

// Screen title + optional right-hand controls + optional "as of" stamp.
export function ScreenHeader({ title, meta, actions, children }) {
  return (
    <div className="mb-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <h2 className="font-display text-xl font-semibold" style={{ color: "var(--text)" }}>
            {title}
          </h2>
          {meta && (
            <p className="text-xs mt-0.5" style={{ color: "var(--text-faint)" }}>
              {meta}
            </p>
          )}
        </div>
        {actions && <div className="flex items-center gap-2 flex-wrap shrink-0">{actions}</div>}
      </div>
      {children && <div className="mt-3">{children}</div>}
    </div>
  );
}

// Card container. `flush` drops the inner padding for tables, which bring
// their own cell padding and should meet the card edge.
export function Panel({ children, flush = false, className = "", style = {} }) {
  return (
    <div
      className={`rounded-[var(--radius)] border overflow-hidden ${flush ? "" : "p-4"} ${className}`}
      style={{ borderColor: "var(--border)", background: "var(--surface)", ...style }}
    >
      {children}
    </div>
  );
}

// Smaller heading used for sections inside a screen (e.g. "Backtest").
export function SectionTitle({ children, meta }) {
  return (
    <div className="flex items-baseline justify-between gap-3 mb-2 flex-wrap">
      <h3 className="font-display text-sm font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
        {children}
      </h3>
      {meta && (
        <span className="text-xs" style={{ color: "var(--text-faint)" }}>
          {meta}
        </span>
      )}
    </div>
  );
}

// Pill sub-navigation for switching between the screens grouped inside
// one top-level tab (e.g. Delivery → Leaders / Sectors).
export function SubNav({ items, active, onChange }) {
  return (
    <div
      className="inline-flex rounded-[var(--radius-sm)] border p-0.5 gap-0.5"
      style={{ borderColor: "var(--border)", background: "var(--surface)" }}
    >
      {items.map((item) => {
        const isActive = item.id === active;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onChange(item.id)}
            className="px-3 py-1.5 text-xs font-medium rounded-[4px] transition-colors whitespace-nowrap"
            style={{
              background: isActive ? "var(--surface-3)" : "transparent",
              color: isActive ? "var(--text)" : "var(--text-muted)",
            }}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

// Empty / no-results state. Kept deliberately plain and instructive
// rather than apologetic.
export function EmptyState({ children }) {
  return (
    <Panel>
      <p className="py-8 text-center text-sm" style={{ color: "var(--text-muted)" }}>
        {children}
      </p>
    </Panel>
  );
}

// Loading state, so every screen waits in the same way.
export function LoadingState({ children }) {
  return (
    <div className="py-14 text-center text-sm" style={{ color: "var(--text-muted)" }}>
      {children}
    </div>
  );
}

// Error state.
export function ErrorState({ children }) {
  return (
    <div
      className="rounded-[var(--radius)] border px-4 py-3 text-sm"
      style={{ borderColor: "var(--loss)", background: "var(--loss-dim)", color: "var(--text)" }}
    >
      {children}
    </div>
  );
}
