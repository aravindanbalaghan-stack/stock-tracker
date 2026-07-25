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

// Compares two rows across a whole priority list of { key, dir } sort
// criteria — the first criterion that doesn't tie decides the order;
// later criteria only ever break ties left by earlier ones. This is what
// makes multi-column sort work: sorting by [Sector, Delivery %] groups
// rows by sector first, then orders each sector's rows by delivery %.
export function compareForSortMulti(a, b, sortList) {
  for (const { key, dir } of sortList) {
    const cmp = compareForSort(a[key], b[key], dir);
    if (cmp !== 0) return cmp;
  }
  return 0;
}

// Shared sort-state + sorted-rows hook used by every table tab. `sort` is
// a priority list, not a single { key, dir } — empty means unsorted, one
// entry means an ordinary single-column sort, more than one means a
// multi-column sort (primary, then tiebreakers in order added).
//
// onSort(key, additive):
//  - additive=false (a plain click): replaces the whole list with just
//    this column — clicking the current sole sort column flips its
//    direction, clicking any other column starts a fresh single-column
//    sort on it (dropping whatever multi-sort was active before).
//  - additive=true (shift+click, wired up in SortableTh): appends this
//    column as the next tiebreaker if it isn't already in the list, or
//    flips its direction in place if it is — without disturbing the
//    other columns' priority or direction.
export function useSortableRows(rows, initialKey = null, initialDir = "desc") {
  const [sort, setSort] = useState(initialKey ? [{ key: initialKey, dir: initialDir }] : []);

  function onSort(key, additive = false) {
    setSort((prev) => {
      const existingIndex = prev.findIndex((s) => s.key === key);

      if (additive) {
        if (existingIndex === -1) return [...prev, { key, dir: "desc" }];
        const next = [...prev];
        next[existingIndex] = { key, dir: next[existingIndex].dir === "asc" ? "desc" : "asc" };
        return next;
      }

      if (prev.length === 1 && prev[0].key === key) {
        return [{ key, dir: prev[0].dir === "asc" ? "desc" : "asc" }];
      }
      return [{ key, dir: "desc" }];
    });
  }

  function clearSort() {
    setSort([]);
  }

  const sorted = useMemo(() => {
    if (!rows || sort.length === 0) return rows;
    const copy = [...rows];
    copy.sort((a, b) => compareForSortMulti(a, b, sort));
    return copy;
  }, [rows, sort]);

  return { sorted, sort, onSort, clearSort };
}
