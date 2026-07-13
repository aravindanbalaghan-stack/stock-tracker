"use client";

export default function TabBar({ tabs, active, onChange }) {
  return (
    <div className="flex gap-1 border-b overflow-x-auto" style={{ borderColor: "var(--border)" }}>
      {tabs.map((tab) => {
        const isActive = tab.id === active;
        return (
          <button
            key={tab.id}
            onClick={() => onChange(tab.id)}
            className="px-4 py-2.5 text-sm whitespace-nowrap border-b-2 transition-colors"
            style={{
              borderColor: isActive ? "var(--accent)" : "transparent",
              color: isActive ? "var(--text)" : "var(--text-muted)",
              fontFamily: "var(--font-display)",
              fontWeight: isActive ? 600 : 500,
            }}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
