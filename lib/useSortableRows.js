"use client";

import { useMemo, useState } from "react";

// Missing values (null/undefined) always sort to the bottom regardless of
// direction — flipping to ascending shouldn't jump blank cells to the top.
// Strings compare case-insensitively; booleans treat true as "greater";
// everything else is numeric.
export function compareForSort(a, b, dir) {
  const aMissing = a === null || a === undefined;
  const bMissing = b === null || b === undefined;
  if (aMissing && bMissing) return 0;
  if (aMissing) return 1;
  if (bMissing) return -1;

  let cmp;
  if (typeof a === "string" && typeof b === "string") {
    cmp = a.localeCompare(b);
  } else if (typeof a === "boolean" && typeof b === "boolean") {
    cmp = a === b ? 0 : a ? 1 : -1;
  } else {
    cmp = a - b;
  }
  return dir === "asc" ? cmp : -cmp;
}

// Shared sort-state + sorted-rows hook used by every table tab. Clicking
// the same column again flips direction; clicking a new column starts it
// descending (most useful default for price/volume/percent columns).
export function useSortableRows(rows, initialKey = null, initialDir = "desc") {
  const [sort, setSort] = useState({ key: initialKey, dir: initialDir });

  function onSort(key) {
    setSort((prev) => {
      if (prev.key === key) return { key, dir: prev.dir === "asc" ? "desc" : "asc" };
      return { key, dir: "desc" };
    });
  }

  const sorted = useMemo(() => {
    if (!rows || !sort.key) return rows;
    const copy = [...rows];
    copy.sort((a, b) => compareForSort(a[sort.key], b[sort.key], sort.dir));
    return copy;
  }, [rows, sort]);

  return { sorted, sort, onSort };
}
