// Who is behind a bulk / block deal? NSE publishes the client's name, not
// its investor category, so this is a best-effort reading of the name:
//
//   FII — foreign portfolio investors: global banks' trading arms,
//         sovereign funds, offshore funds (Singapore / Mauritius / LLC …)
//   DII — Indian mutual funds, insurers, pension funds, banks
//   null — everyone else (individuals, Indian brokers' prop desks, promoters)
//
// Domestic markers are checked first: "HDFC MUTUAL FUND" is a DII even
// though it contains "FUND", and an Indian AMC's offshore feeder is rare
// enough in bulk deals to accept the miss.

const DII = [
  /\bMUTUAL\s*FUND\b/,
  /\bM\.?\s?F\.?\b/,
  /\bMF\b/,
  /\bLIFE INSURANCE\b/,
  /\bINSURANCE\b/,
  /\bASSURANCE\b/,
  /\bL\.?I\.?C\.?\b/,
  /\bAMC\b/,
  /\bASSET MANAGEMENT\b/,
  /\bTRUSTEE\b/,
  /\bPENSION FUND\b/,
  /\bNPS TRUST\b/,
  /\bPROVIDENT FUND\b/,
  /\bEPFO\b/,
  /\bSTATE BANK OF INDIA\b/,
  /\bAIF\b|\bALTERNATIVE INVESTMENT FUND\b/,
];

// Foreign: offshore domiciles and legal forms, ODI desks, and the global
// houses that dominate FPI bulk-deal prints.
const FII = [
  /\bPTE\.?\b/,
  /\bPTE LTD\b/,
  /\bMAURITIUS\b/,
  /\bSINGAPORE\b/,
  /\bCAYMAN\b/,
  /\bLUXEMBOURG\b/,
  /\bIRELAND\b/,
  /\bNETHERLANDS\b/,
  /\bHONG KONG\b/,
  /\bJAPAN\b/,
  /\bUAE\b|\bDUBAI\b|\bABU DHABI\b/,
  /\bLLC\b/,
  /\bL\.?L\.?C\.?\b/,
  /\bPLC\b/,
  /\bL\.?P\.?$/,
  /\bLP\b/,
  /\bS\.?A\.?$/,
  /\bSA\b/,
  /\bB\.?V\.?\b/,
  /\bGMBH\b/,
  /\bAG$/,
  /\bINC\.?$/,
  /\bODI\b/,
  /\bFPI\b/,
  /\bGOLDMAN SACHS\b/,
  /\bMORGAN STANLEY\b/,
  /\bCITIGROUP\b|\bCITI\b/,
  /\bJ\.?\s?P\.?\s?MORGAN\b|\bJPMORGAN\b/,
  /\bBNP PARIBAS\b/,
  /\bSOCIETE GENERALE\b/,
  /\bNOMURA\b/,
  /\bMERRILL LYNCH\b|\bBOFA\b|\bBANK OF AMERICA\b/,
  /\bUBS\b/,
  /\bBARCLAYS\b/,
  /\bCREDIT SUISSE\b/,
  /\bDEUTSCHE\b/,
  /\bMACQUARIE\b/,
  /\bHSBC\b/,
  /\bVANGUARD\b/,
  /\bBLACKROCK\b|\bISHARES\b/,
  /\bFIDELITY\b/,
  /\bGOVERNMENT OF SINGAPORE\b|\bGIC\b/,
  /\bMONETARY AUTHORITY\b/,
  /\bNORGES\b/,
  /\bKUWAIT\b/,
  /\bQATAR\b/,
  /\bINVESTMENT AUTHORITY\b/,
  /\bSMALLCAP WORLD\b|\bWORLD FUND\b/,
  /\bEMERGING MARKETS?\b/,
  /\bCOPTHALL\b/,
  /\bINTEGRATED CORE\b/,
  /\bELARA INDIA OPPORTUNITIES\b/,
  /\bVIRTUS\b|\bAPAC\b|\bASIA\b/,
];

export function classifyClient(name) {
  const n = String(name ?? "").toUpperCase().replace(/\s+/g, " ").trim();
  if (!n) return null;
  if (DII.some((re) => re.test(n))) return "DII";
  if (FII.some((re) => re.test(n))) return "FII";
  return null;
}
