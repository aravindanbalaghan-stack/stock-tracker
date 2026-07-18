// Sectors for the Sector Deliverability tab, reusing the same constituent
// lists already hand-maintained in indexConstituents.js for the Indices
// tab — one source of truth instead of a second hand-maintained list that
// could drift from the first. "^NSEI" (Nifty 50) is deliberately excluded
// here: it's a broad-market index, not a sector, and every one of its
// members already shows up under one of the sector indices below.
import { INDEX_CONSTITUENTS } from "@/lib/indexConstituents";

const SECTOR_NAMES = {
  "^NSEBANK": "Bank",
  "^CNXIT": "IT",
  "^CNXAUTO": "Auto",
  "^CNXPHARMA": "Pharma",
  "^CNXFMCG": "FMCG",
  "^CNXMETAL": "Metal",
  "^CNXREALTY": "Realty",
  "^CNXENERGY": "Energy",
  "^CNXPSUBANK": "PSU Bank",
  "^CNXFIN": "Financial Services",
};

export const SECTOR_LIST = Object.entries(INDEX_CONSTITUENTS)
  .filter(([key]) => key !== "^NSEI" && SECTOR_NAMES[key])
  .map(([key, symbols]) => ({
    key,
    name: SECTOR_NAMES[key],
    symbols,
  }));
