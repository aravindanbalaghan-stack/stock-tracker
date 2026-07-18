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
  const active = sort?.key === sortKey;
  return (
    <th
      className={`py-2 px-2 text-xs font-medium uppercase tracking-wider select-none cursor-pointer hover:opacity-80 ${
        align === "right" ? "text-right" : "text-left"
      } ${className}`}
      style={{ color: active ? "var(--accent)" : "var(--text-faint)" }}
      onClick={() => onSort(sortKey)}
      title={title || `Sort by ${label}`}
    >
      <span className={`inline-flex items-center gap-1 ${align === "right" ? "flex-row-reverse" : ""}`}>
        {label}
        <span className="text-[9px] w-2 inline-block" style={{ opacity: active ? 1 : 0.25 }}>
          {active && sort.dir === "asc" ? "▲" : "▼"}
        </span>
      </span>
    </th>
  );
}
