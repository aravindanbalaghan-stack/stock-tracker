// Sector definitions for the Sector Deliverability tab.
//
// This is a hand-maintained mapping from sector -> NSE stock symbols,
// broader than the ~10 official NSE sectoral indices used by the Top
// Indices tab (indexConstituents.js) — this covers niche sectors
// (Chemicals, Footwear, Sugar, Paper, Defence, ...) that don't have their
// own NSE sectoral index at all. Same freshness caveat as the other
// hand-maintained lists in this app: company classifications and listings
// drift slowly over time, so treat this as a good-enough working set, not
// NSE's official 197-basic-industry classification.
//
// Overlaps are intentional and expected: a stock genuinely belonging to
// two sectors (e.g. a bank counted in both "Banking" and the narrower
// "PSU Banks", or a diversified chemicals/fertilizer maker) is listed in
// both arrays on purpose, so it contributes to both sectors' delivery %
// — see app/api/sector-delivery/route.js, which computes each sector
// completely independently, so a symbol in two lists is simply counted
// twice, once per sector.

export const SECTOR_LIST = [
  {
    key: "banking",
    name: "Banking",
    symbols: [
      "HDFCBANK", "ICICIBANK", "SBIN", "KOTAKBANK", "AXISBANK", "INDUSINDBK",
      "BANKBARODA", "PNB", "IDFCFIRSTB", "FEDERALBNK", "AUBANK", "CANBK",
      "UNIONBANK", "INDIANB", "BANKINDIA", "MAHABANK", "UCOBANK", "IOB",
      "CENTRALBK", "KARURVYSYA", "SOUTHBANK", "DCBBANK", "CSBBANK",
      "RBLBANK", "YESBANK", "J&KBANK", "CUB", "EQUITASBNK", "UJJIVANSFB",
    ],
  },
  {
    key: "psu-banking",
    name: "PSU Banks",
    symbols: [
      "SBIN", "BANKBARODA", "PNB", "CANBK", "UNIONBANK", "INDIANB",
      "BANKINDIA", "MAHABANK", "UCOBANK", "IOB", "CENTRALBK",
    ],
  },
  {
    key: "nbfc",
    name: "NBFC",
    symbols: [
      "BAJFINANCE", "BAJAJFINSV", "SHRIRAMFIN", "CHOLAFIN", "LICHSGFIN",
      "MUTHOOTFIN", "MANAPPURAM", "PFC", "RECLTD", "HUDCO", "LTF", "MFSL",
      "SBICARD", "PNBHOUSING", "CANFINHOME", "AAVAS", "IIFL", "JMFINANCIL",
      "POONAWALLA", "M&MFIN",
    ],
  },
  {
    key: "insurance",
    name: "Insurance",
    symbols: [
      "SBILIFE", "HDFCLIFE", "ICICIPRULI", "ICICIGI", "NIACL", "GICRE",
      "LICI", "STARHEALTH", "MAXFIN", "GODIGIT",
    ],
  },
  {
    key: "capital-markets",
    name: "Capital Markets",
    symbols: [
      "HDFCAMC", "NAM-INDIA", "UTIAMC", "360ONE", "ANGELONE", "CDSL",
      "BSE", "MCX", "CRISIL", "IEX", "CAMS", "KFINTECH", "MOTILALOFS",
      "NUVAMA",
    ],
  },
  {
    key: "it",
    name: "IT",
    symbols: [
      "TCS", "INFY", "HCLTECH", "WIPRO", "TECHM", "LTIM", "LTTS",
      "PERSISTENT", "COFORGE", "MPHASIS", "OFSS", "KPITTECH", "TATAELXSI",
      "CYIENT", "ZENSARTECH", "BIRLASOFT", "MASTEK", "NEWGEN", "INTELLECT",
      "ROUTE", "HAPPSTMNDS", "SONATSOFTW", "TANLA", "LATENTVIEW",
      "RATEGAIN",
    ],
  },
  {
    key: "pharma",
    name: "Pharma",
    symbols: [
      "SUNPHARMA", "CIPLA", "DRREDDY", "DIVISLAB", "LUPIN", "AUROPHARMA",
      "ALKEM", "TORNTPHARM", "ZYDUSLIFE", "MANKIND", "BIOCON", "GLENMARK",
      "LAURUSLABS", "IPCALAB", "ABBOTINDIA", "PFIZER", "GLAXO", "SANOFI",
      "NATCOPHARM", "AJANTPHARM", "JBCHEPHARM", "GRANULES", "GLAND",
      "WOCKPHARMA", "APLLTD", "INDOCO", "SUVENPHAR",
    ],
  },
  {
    key: "healthcare-services",
    name: "Healthcare Services",
    symbols: [
      "APOLLOHOSP", "FORTIS", "MAXHEALTH", "NH", "GLOBAL", "KIMS",
      "RAINBOW", "ASTERDM", "SHALBY", "METROPOLIS", "LALPATHLAB",
      "THYROCARE", "POLYMED", "VIJAYA", "YATHARTH",
    ],
  },
  {
    key: "automobile",
    name: "Automobile",
    symbols: [
      "MARUTI", "M&M", "TATAMOTORS", "BAJAJ-AUTO", "EICHERMOT",
      "HEROMOTOCO", "TVSMOTOR", "ASHOKLEY", "ESCORTS", "FORCEMOT",
      "SMLISUZU", "ATULAUTO",
    ],
  },
  {
    key: "auto-ancillaries",
    name: "Auto Ancillaries",
    symbols: [
      "BOSCHLTD", "BHARATFORG", "MOTHERSON", "BALKRISIND", "MRF",
      "APOLLOTYRE", "CEAT", "JKTYRE", "EXIDEIND", "ARE&M", "ENDURANCE",
      "SUNDRMFAST", "SUBROS", "SCHAEFFLER", "UNOMINDA", "SANSERA",
      "MINDACORP", "GABRIEL", "JAMNAAUTO", "SUPRAJIT",
    ],
  },
  {
    key: "chemicals",
    name: "Chemicals",
    symbols: [
      "PIDILITIND", "SRF", "UPL", "AARTIIND", "DEEPAKNTR", "ATUL",
      "NAVINFLUOR", "VINATIORGA", "FINEORG", "ALKYLAMINE", "GALAXYSURF",
      "CLEAN", "PIIND", "TATACHEM", "GHCL", "GNFC", "NOCIL", "BALAMINES",
      "ROSSARI", "JUBLINGREA", "FLUOROCHEM", "PCBL", "SOLARINDS",
      "LINDEINDIA", "GUJALKALI", "DCMSHRIRAM",
    ],
  },
  {
    key: "fertilizers-agrochemicals",
    name: "Fertilizers & Agrochemicals",
    symbols: [
      "CHAMBLFERT", "COROMANDEL", "GSFC", "RCF", "NFL", "MADRASFERT",
      "DEEPAKFERT", "RALLIS", "BAYERCROP", "SUMICHEM", "DHANUKA",
      "INSECTICID", "UPL",
    ],
  },
  {
    key: "cement",
    name: "Cement",
    symbols: [
      "ULTRACEMCO", "SHREECEM", "AMBUJACEM", "ACC", "DALBHARAT",
      "JKCEMENT", "RAMCOCEM", "HEIDELBERG", "INDIACEM", "NUVOCO",
      "JKLAKSHMI", "STARCEMENT", "SAGCEM", "BIRLACORPN", "ORIENTCEM",
    ],
  },
  {
    key: "metals-mining",
    name: "Metals & Mining",
    symbols: [
      "TATASTEEL", "JSWSTEEL", "HINDALCO", "VEDL", "SAIL", "NMDC",
      "NATIONALUM", "JINDALSTEL", "HINDZINC", "APLAPOLLO", "JSL",
      "RATNAMANI", "WELCORP", "MOIL", "HINDCOPPER", "GMDCLTD",
      "SHYAMMETL", "KIOCL",
    ],
  },
  {
    key: "oil-gas",
    name: "Oil & Gas",
    symbols: [
      "RELIANCE", "ONGC", "IOC", "BPCL", "HPCL", "GAIL", "OIL", "MRPL",
      "CHENNPETRO", "PETRONET", "GUJGASLTD", "IGL", "MGL", "AEGISCHEM",
      "GSPL", "ATGL",
    ],
  },
  {
    key: "power",
    name: "Power",
    symbols: [
      "NTPC", "POWERGRID", "TATAPOWER", "ADANIPOWER", "ADANIENSOL",
      "JSWENERGY", "TORNTPOWER", "NHPC", "SJVN", "CESC",
    ],
  },
  {
    key: "renewable-energy",
    name: "Renewable Energy",
    symbols: [
      "ADANIGREEN", "SUZLON", "INOXWIND", "WAAREE", "KPIGREEN",
      "ACMESOLAR", "BOROSIL", "INOXGREEN",
    ],
  },
  {
    key: "telecom",
    name: "Telecom",
    symbols: [
      "BHARTIARTL", "IDEA", "INDUSTOWER", "TATACOMM", "RAILTEL", "HFCL",
      "STLTECH", "ITI",
    ],
  },
  {
    key: "fmcg",
    name: "FMCG",
    symbols: [
      "HINDUNILVR", "ITC", "NESTLEIND", "TATACONSUM", "BRITANNIA", "VBL",
      "DABUR", "GODREJCP", "MARICO", "COLPAL", "UBL", "PATANJALI",
      "EMAMILTD", "RADICO", "JYOTHYLAB", "GILLETTE", "BAJAJCON", "CCL",
      "HONASA",
    ],
  },
  {
    key: "consumer-durables",
    name: "Consumer Durables",
    symbols: [
      "HAVELLS", "VOLTAS", "BLUESTARCO", "DIXON", "CROMPTON", "WHIRLPOOL",
      "VGUARD", "ORIENTELEC", "IFBIND", "AMBER", "POLYCAB", "KEI",
      "FINCABLES",
    ],
  },
  {
    key: "textiles",
    name: "Textiles",
    symbols: [
      "TRIDENT", "VARDHMAN", "WELSPUNLIV", "RAYMOND", "KPRMILL", "GOKEX",
      "ARVIND", "RSWM", "SIYSIL", "SUTLEJTEX", "PAGEIND", "NAHARSPING",
    ],
  },
  {
    key: "footwear",
    name: "Footwear",
    symbols: [
      "BATAINDIA", "RELAXO", "LIBERTSHOE", "CAMPUS", "METROBRAND",
      "KHADIM", "MIRZAINT",
    ],
  },
  {
    key: "jewellery-gems",
    name: "Jewellery & Gems",
    symbols: [
      "TITAN", "KALYANKJIL", "RAJESHEXPO", "PCJEWELLER", "THANGAMAYL",
      "SENCO", "GOLDIAM", "VAIBHAVGBL",
    ],
  },
  {
    key: "retail",
    name: "Retail",
    symbols: [
      "DMART", "TRENT", "ABFRL", "SHOPERSTOP", "VMART", "ARVINDFASN",
      "GOCOLORS", "VIPIND", "NYKAA", "SAFARI",
    ],
  },
  {
    key: "media-entertainment",
    name: "Media & Entertainment",
    symbols: [
      "ZEEL", "SUNTV", "PVRINOX", "TIPS", "NAZARA", "NETWORK18",
      "TV18BRDCST", "DBCORP", "JAGRAN", "HTMEDIA", "SAREGAMA",
    ],
  },
  {
    key: "real-estate",
    name: "Real Estate",
    symbols: [
      "DLF", "GODREJPROP", "OBEROIRLTY", "PRESTIGE", "PHOENIXLTD",
      "LODHA", "BRIGADE", "SOBHA", "SUNTECK", "MAHLIFE", "IBREALEST",
      "ANANTRAJ",
    ],
  },
  {
    key: "infrastructure-construction",
    name: "Infrastructure & Construction",
    symbols: [
      "LT", "GMRAIRPORT", "ADANIPORTS", "IRB", "NBCC", "RVNL", "IRCON",
      "NCC", "HGINFRA", "PNCINFRA", "KNRCON", "GRINFRA", "ASHOKA", "JKIL",
      "KALPATPOWR", "KEC", "ENGINERSIN", "TITAGARH", "TEXRAIL",
    ],
  },
  {
    key: "capital-goods",
    name: "Capital Goods",
    symbols: [
      "SIEMENS", "ABB", "CGPOWER", "BHEL", "THERMAX", "CUMMINSIND",
      "AIAENG", "HONAUT", "TIINDIA", "SKFINDIA", "TIMKEN", "KIRLOSENG",
      "ELGIEQUIP", "GRINDWELL", "CARBORUNIV", "TRITURBINE", "KSB",
      "TDPOWERSYS",
    ],
  },
  {
    key: "defence",
    name: "Defence",
    symbols: [
      "HAL", "BEL", "BDL", "MAZDOCK", "COCHINSHIP", "GRSE", "SOLARINDS",
      "DATAPATTNS", "ASTRAMICRO", "BEML", "PARAS", "ZENTEC", "MTARTECH",
      "IDEAFORGE",
    ],
  },
  {
    key: "aviation",
    name: "Aviation",
    symbols: ["INDIGO", "SPICEJET"],
  },
  {
    key: "shipping-logistics",
    name: "Shipping & Logistics",
    symbols: [
      "CONCOR", "GESHIP", "SCI", "TCI", "GATI", "BLUEDART", "DELHIVERY",
      "MAHLOG", "ALLCARGO", "VRLLOG",
    ],
  },
  {
    key: "sugar",
    name: "Sugar",
    symbols: [
      "BALRAMCHIN", "TRIVENI", "DWARKESH", "DALMIASUG", "EIDPARRY",
      "BANARISUG", "UGARSUGAR", "RENUKA",
    ],
  },
  {
    key: "paper",
    name: "Paper",
    symbols: ["JKPAPER", "WSTCSTPAPR", "TNPL", "SESHAPAPER", "ANDHRAPAP"],
  },
  {
    key: "building-materials",
    name: "Building Materials",
    symbols: [
      "CERA", "KAJARIACER", "SOMANYCERA", "CENTURYPLY", "GREENPANEL",
      "GREENLAM", "ASTRAL", "SUPREMEIND", "FINPIPE", "PRINCEPIPE",
    ],
  },
  {
    key: "paints",
    name: "Paints",
    symbols: ["ASIANPAINT", "BERGEPAINT", "KANSAINER", "AKZOINDIA", "INDIGOPNTS"],
  },
  {
    key: "plastics-packaging",
    name: "Plastics & Packaging",
    symbols: [
      "EPL", "UFLEX", "TIMETECHNO", "COSMOFIRST", "JINDALPOLY", "AGI",
    ],
  },
];
