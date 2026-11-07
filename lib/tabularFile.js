"use client";

// Reading and writing table files in the browser — CSV, Excel (.xlsx) and
// JSON — for the Stock Data and Trading Journal tabs. The Excel libraries
// are loaded only when an Excel file is actually read or written.

// ---------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;
  const t = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (inQuotes) {
      if (ch === '"') {
        if (t[i + 1] === '"') {
          cell += '"';
          i++;
        } else inQuotes = false;
      } else cell += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && t[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => String(c).trim() !== ""));
}

function csvCell(v) {
  if (v === null || v === undefined) return "";
  const s = v instanceof Date ? v.toISOString().slice(0, 10) : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows, columns) {
  return [columns.map(csvCell).join(","), ...rows.map((r) => columns.map((c) => csvCell(r[c])).join(","))].join("\r\n");
}

// ---------------------------------------------------------------------
// Parsing any supported file into { columns, rows: [{ header: value }] }
// ---------------------------------------------------------------------

function tableToObjects(table) {
  if (!table.length) return { columns: [], rows: [] };
  const columns = table[0].map((h) => String(h ?? "").trim());
  const rows = table.slice(1).map((r) => {
    const o = {};
    columns.forEach((c, i) => {
      if (!c) return;
      let v = r[i];
      if (v instanceof Date) v = v.toISOString().slice(0, 10);
      if (typeof v === "string") v = v.trim();
      o[c] = v === undefined ? null : v;
    });
    return o;
  });
  return { columns: columns.filter(Boolean), rows };
}

export async function parseTableFile(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith(".json")) {
    const json = JSON.parse(await file.text());
    const rows = Array.isArray(json) ? json : Array.isArray(json?.rows) ? json.rows : Array.isArray(json?.trades) ? json.trades : null;
    if (!rows) throw new Error("The JSON file should be a list of rows (or { rows: [...] })");
    const columns = [...new Set(rows.flatMap((r) => Object.keys(r ?? {})))];
    return { columns, rows };
  }
  if (name.endsWith(".csv") || name.endsWith(".txt")) {
    return tableToObjects(parseCsv(await file.text()));
  }
  if (name.endsWith(".xlsx")) {
    const { readSheet } = await import("read-excel-file/browser");
    return tableToObjects(await readSheet(file));
  }
  if (name.endsWith(".xls")) throw new Error("Old .xls files aren't supported — save it as .xlsx or .csv first");
  throw new Error("Use a .csv, .xlsx or .json file");
}

// ---------------------------------------------------------------------
// Downloading
// ---------------------------------------------------------------------

function saveBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function downloadText(text, fileName, type = "text/plain") {
  saveBlob(new Blob([text], { type }), fileName);
}

/**
 * format: "csv" | "xlsx" | "json". extraSheets (Excel only): [{ name, rows, columns }]
 * — e.g. a README or summary sheet alongside the data.
 */
export async function downloadTable(rows, columns, { format, baseName, sheetName = "Data", extraSheets = [], jsonExtra = {} }) {
  if (format === "json") {
    downloadText(JSON.stringify({ ...jsonExtra, rows }, null, 2), `${baseName}.json`, "application/json");
    return;
  }
  if (format === "csv") {
    // BOM so Excel opens ₹ and other non-ASCII characters correctly.
    downloadText("\uFEFF" + toCsv(rows, columns), `${baseName}.csv`, "text/csv;charset=utf-8");
    return;
  }
  const { default: writeXlsxFile } = await import("write-excel-file/browser");
  const cellOf = (v) =>
    v === null || v === undefined || v === ""
      ? null
      : typeof v === "number"
      ? { type: Number, value: v }
      : typeof v === "boolean"
      ? { type: Boolean, value: v }
      : { type: String, value: String(v) };
  const sheetOf = (name, rs, cols) => ({
    sheet: name.slice(0, 31),
    data: [cols.map((c) => ({ value: c, fontWeight: "bold" })), ...rs.map((r) => cols.map((c) => cellOf(r[c])))],
    columns: cols.map((c) => ({ width: Math.min(40, Math.max(10, String(c).length + 2)) })),
  });
  const sheets = [sheetOf(sheetName, rows, columns), ...extraSheets.map((s) => sheetOf(s.name, s.rows, s.columns))];
  await writeXlsxFile(sheets).toFile(`${baseName}.xlsx`);
}
