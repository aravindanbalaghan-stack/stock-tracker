// Constituent lists for the indices we show in the Indices tab.
// Hand-maintained snapshots — NSE periodically reshuffles these (usually
// semi-annually), so a name or two may drift from the live index over
// time. Good enough for a "who's leading this index today" view; refresh
// against niftyindices.com if it starts looking stale.
//
// Only indices with a constituent list here support the "top 5 stocks in
// this index" drill-down in the UI — indices not listed just show price
// and change like before.

export const INDEX_CONSTITUENTS = {
  "^NSEI": [
    "RELIANCE", "TCS", "HDFCBANK", "ICICIBANK", "INFY", "BHARTIARTL", "ITC",
    "LT", "KOTAKBANK", "SBIN", "AXISBANK", "HINDUNILVR", "BAJFINANCE",
    "MARUTI", "M&M", "SUNPHARMA", "TATAMOTORS", "TITAN", "ULTRACEMCO",
    "ADANIENT", "NTPC", "ONGC", "TATASTEEL", "POWERGRID", "ASIANPAINT",
    "WIPRO", "COALINDIA", "NESTLEIND", "BAJAJFINSV", "JSWSTEEL", "HCLTECH",
    "GRASIM", "TECHM", "INDUSINDBK", "ADANIPORTS", "CIPLA", "DRREDDY",
    "EICHERMOT", "APOLLOHOSP", "BRITANNIA", "DIVISLAB", "HEROMOTOCO",
    "BPCL", "SBILIFE", "HDFCLIFE", "SHRIRAMFIN", "TATACONSUM", "BAJAJ-AUTO",
    "HINDALCO", "LTIM",
  ],
  "^NSEBANK": [
    "HDFCBANK", "ICICIBANK", "SBIN", "KOTAKBANK", "AXISBANK", "INDUSINDBK",
    "BANKBARODA", "PNB", "IDFCFIRSTB", "FEDERALBNK", "AUBANK", "CANBK",
  ],
  "^CNXIT": [
    "TCS", "INFY", "HCLTECH", "WIPRO", "TECHM", "LTIM", "PERSISTENT",
    "COFORGE", "MPHASIS", "LTTS",
  ],
  "^CNXAUTO": [
    "MARUTI", "M&M", "TATAMOTORS", "BAJAJ-AUTO", "EICHERMOT", "HEROMOTOCO",
    "TVSMOTOR", "ASHOKLEY", "BHARATFORG", "BALKRISIND", "MOTHERSON",
    "APOLLOTYRE", "EXIDEIND", "UNOMINDA",
  ],
  "^CNXPHARMA": [
    "SUNPHARMA", "CIPLA", "DRREDDY", "DIVISLAB", "APOLLOHOSP", "LUPIN",
    "AUROPHARMA", "ALKEM", "TORNTPHARM", "ZYDUSLIFE", "MANKIND", "BIOCON",
    "GLENMARK", "LAURUSLABS", "IPCALAB",
  ],
  "^CNXFMCG": [
    "HINDUNILVR", "ITC", "NESTLEIND", "TATACONSUM", "BRITANNIA", "VBL",
    "DABUR", "GODREJCP", "MARICO", "COLPAL", "UBL", "PATANJALI", "EMAMILTD",
  ],
  "^CNXMETAL": [
    "TATASTEEL", "JSWSTEEL", "HINDALCO", "VEDL", "SAIL", "NMDC",
    "NATIONALUM", "JINDALSTEL", "HINDZINC", "APLAPOLLO",
  ],
  "^CNXREALTY": [
    "DLF", "GODREJPROP", "OBEROIRLTY", "PRESTIGE", "PHOENIXLTD", "LODHA",
    "BRIGADE", "SOBHA",
  ],
  "^CNXENERGY": [
    "RELIANCE", "ONGC", "NTPC", "POWERGRID", "COALINDIA", "BPCL", "IOC",
    "GAIL", "TATAPOWER", "ADANIGREEN", "ADANIENSOL",
  ],
  "^CNXPSUBANK": [
    "SBIN", "BANKBARODA", "PNB", "CANBK", "UNIONBANK", "INDIANB", "BANKINDIA",
    "MAHABANK", "IOB", "UCOBANK",
  ],
  "^CNXFIN": [
    "HDFCBANK", "ICICIBANK", "SBIN", "KOTAKBANK", "AXISBANK", "BAJFINANCE",
    "BAJAJFINSV", "HDFCLIFE", "SBILIFE", "SHRIRAMFIN", "CHOLAFIN",
    "ICICIPRULI", "ICICIGI", "PFC", "RECLTD", "MUTHOOTFIN", "HDFCAMC",
  ],
};
