"use client";

import Link from "next/link";

// Every symbol shown in a table links to that stock's insight page. Kept
// as one component so the affordance (and the hover treatment) is
// identical everywhere, rather than each tab rolling its own.
export default function SymbolLink({ symbol, className = "", style = {} }) {
  return (
    <Link
      href={`/stock/${encodeURIComponent(symbol)}`}
      className={`font-mono hover:underline ${className}`}
      style={{ color: "var(--text)", ...style }}
      title={`Open the insight page for ${symbol}`}
      onClick={(e) => e.stopPropagation()}
    >
      {symbol}
    </Link>
  );
}
