"use client";

import CollapsibleSection from "@/components/CollapsibleSection";

// Small "ⓘ How this works" disclosure for the methodology paragraphs that
// used to sit permanently under almost every table. The text is
// unchanged — just collapsed by default so the numbers are what you see
// first, with the full explanation one click away.
export default function InfoNote({ label = "How this works", children }) {
  return (
    <CollapsibleSection
      summary={
        <span className="text-xs" style={{ color: "var(--text-faint)" }}>
          ⓘ {label}
        </span>
      }
      expandLabel="Show"
      collapseLabel="Hide"
    >
      <p className="text-xs leading-relaxed" style={{ color: "var(--text-faint)" }}>
        {children}
      </p>
    </CollapsibleSection>
  );
}
