"use client";

export default function WatchlistAddButton({ symbol, inWatchlist, onAdd }) {
  if (!onAdd) return null;
  return (
    <button
      type="button"
      disabled={inWatchlist}
      onClick={(e) => {
        e.stopPropagation();
        onAdd(symbol);
      }}
      className="text-[10px] px-1.5 py-0.5 rounded border whitespace-nowrap transition-colors disabled:opacity-50"
      style={{
        borderColor: inWatchlist ? "var(--border)" : "var(--accent)",
        color: inWatchlist ? "var(--text-faint)" : "var(--accent)",
      }}
      title={inWatchlist ? "Already in watchlist" : `Add ${symbol} to watchlist`}
    >
      {inWatchlist ? "✓ Added" : "+ Watchlist"}
    </button>
  );
}
