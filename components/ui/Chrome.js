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

// A single shimmering placeholder bar.
export function Skeleton({ width = "100%", height = 12, className = "", style = {} }) {
  return <span aria-hidden="true" className={`skeleton block ${className}`} style={{ width, height, ...style }} />;
}

// Placeholder shaped like a table: header strip + rows of uneven bars,
// so the page doesn't jump when the real table lands.
export function TableSkeleton({ rows = 8, cols = 6 }) {
  const widths = ["70%", "55%", "80%", "45%", "65%", "50%", "75%", "60%"];
  return (
    <div className="rounded-[var(--radius)] border overflow-hidden" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
      <div className="flex gap-4 px-3 py-2.5 border-b" style={{ borderColor: "var(--border)", background: "var(--surface-2)" }}>
        {Array.from({ length: cols }, (_, c) => (
          <Skeleton key={c} width={c === 0 ? "14%" : `${70 / (cols - 1)}%`} height={9} />
        ))}
      </div>
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="flex gap-4 px-3 py-3 border-b last:border-b-0" style={{ borderColor: "var(--border)" }}>
          {Array.from({ length: cols }, (_, c) => (
            <div key={c} style={{ width: c === 0 ? "14%" : `${70 / (cols - 1)}%` }}>
              <Skeleton width={widths[(r + c) % widths.length]} height={c === 0 ? 12 : 10} />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// Placeholder shaped like a row of cards (Top 5, Holdings).
export function CardSkeleton({ count = 3 }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="rounded-[var(--radius)] border p-4 space-y-3" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
          <Skeleton width="40%" height={14} />
          <Skeleton width="65%" height={22} />
          <Skeleton width="90%" height={8} />
          <Skeleton width="75%" height={8} />
        </div>
      ))}
    </div>
  );
}

// Loading state, so every screen waits in the same way: a skeleton in the
// shape of what's coming, with the explanatory text underneath (useful when
// a scan takes a while and the user wants to know why).
export function LoadingState({ children, variant = "table", rows = 8, cols = 6 }) {
  return (
    <div role="status" aria-live="polite" className="space-y-2">
      {variant === "cards" ? <CardSkeleton /> : variant === "text" ? (
        <div className="space-y-2 py-2">
          <Skeleton width="60%" /> <Skeleton width="85%" /> <Skeleton width="45%" />
        </div>
      ) : (
        <TableSkeleton rows={rows} cols={cols} />
      )}
      {children && (
        <p className="text-xs text-center pt-1" style={{ color: "var(--text-faint)" }}>
          {children}
        </p>
      )}
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
