"use client";

export default function SortableTh({
  label,
  sortKey,
  sort,
  onSort,
  align = "right",
  className = "",
  title,
}) {
  const sortList = Array.isArray(sort) ? sort : sort?.key ? [sort] : [];
  const priorityIndex = sortList.findIndex((s) => s.key === sortKey);
  const active = priorityIndex !== -1;
  const entry = active ? sortList[priorityIndex] : null;
  const showPriority = active && sortList.length > 1;

  const defaultTitle =
    sortList.length > 0
      ? `Click to sort by ${label} only · Shift+click to add as a tiebreaker`
      : `Click to sort by ${label} · Shift+click to add more columns as tiebreakers`;

  return (
    <th
      className={`py-2 px-2 text-xs font-medium uppercase tracking-wider select-none cursor-pointer hover:opacity-80 ${
        align === "right" ? "text-right" : "text-left"
      } ${className}`}
      style={{ color: active ? "var(--accent)" : "var(--text-faint)" }}
      onClick={(e) => onSort(sortKey, e.shiftKey)}
      title={title || defaultTitle}
    >
      <span className={`inline-flex items-center gap-0.5 ${align === "right" ? "flex-row-reverse" : ""}`}>
        {label}
        <span className="text-[9px] w-2 inline-block" style={{ opacity: active ? 1 : 0.25 }}>
          {active && entry.dir === "asc" ? "▲" : "▼"}
        </span>
        {showPriority && (
          <sup className="text-[9px] font-bold" style={{ color: "var(--accent)" }}>
            {priorityIndex + 1}
          </sup>
        )}
      </span>
    </th>
  );
}
