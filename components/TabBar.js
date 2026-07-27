"use client";

// Top-level navigation. Each tab is a place you go to answer a different
// question, and there are now five of them instead of nine — related
// screens moved into sub-navigation inside the tab they belong to.
export default function TabBar({ tabs, active, onChange }) {
  return (
    <nav
      className="sticky top-0 z-20 border-b backdrop-blur"
      style={{ borderColor: "var(--border)", background: "rgba(8, 11, 19, 0.85)" }}
      aria-label="Main"
    >
      <div className="flex gap-0.5 overflow-x-auto px-4 md:px-8">
        {tabs.map((tab) => {
          const isActive = tab.id === active;
          return (
            <button
              key={tab.id}
              onClick={() => onChange(tab.id)}
              className="relative px-3.5 py-3 text-sm whitespace-nowrap transition-colors"
              style={{
                color: isActive ? "var(--text)" : "var(--text-muted)",
                fontFamily: "var(--font-display)",
                fontWeight: isActive ? 600 : 500,
              }}
              aria-current={isActive ? "page" : undefined}
            >
              {tab.label}
              <span
                className="absolute left-2 right-2 bottom-0 h-0.5 rounded-full transition-opacity"
                style={{ background: "var(--accent)", opacity: isActive ? 1 : 0 }}
              />
            </button>
          );
        })}
      </div>
    </nav>
  );
}
