"use client";

import Link from "next/link";
import EventTag from "@/components/EventTag";

// Every symbol shown in a table links to that stock's insight page. Kept
// as one component so the affordance (and the hover treatment) is
// identical everywhere, rather than each tab rolling its own. It also
// carries the "Event" tag for an upcoming result / corporate action, so
// that shows up everywhere a stock is listed (pass showEvents={false} to
// leave it off).
export default function SymbolLink({ symbol, className = "", style = {}, showEvents = true }) {
  return (
    <span className="inline-flex items-center">
      <Link
        href={`/stock/${encodeURIComponent(symbol)}`}
        className={`font-mono hover:underline ${className}`}
        style={{ color: "var(--text)", ...style }}
        title={`Open the insight page for ${symbol}`}
        onClick={(e) => e.stopPropagation()}
      >
        {symbol}
      </Link>
      {showEvents && <EventTag symbol={symbol} />}
    </span>
  );
}
