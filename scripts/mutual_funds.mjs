// Daily closing prices (NAV) for popular mutual funds, for StockPlotter. Writes mutual_funds.json in the repo root.
// The live price feeds the app uses in the browser don't carry mutual funds, so this fetches about two years of
// daily closes for a fixed list of widely held funds. The list is the same for everyone and says nothing about
// what any one person holds. Run by .github/workflows/mutual-funds.yml each weekday evening after NAVs publish.
// Sources, in order: Yahoo's chart API, then Stooq's daily CSV. A fund nobody answers keeps its last good data.
import { writeFileSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

// [ticker, name]
const FUNDS = [
  ["VFIAX", "Vanguard 500 Index Admiral"], ["VTSAX", "Vanguard Total Stock Market Index Admiral"], ["VTIAX", "Vanguard Total International Stock Index Admiral"],
  ["VBTLX", "Vanguard Total Bond Market Index Admiral"], ["VFTAX", "Vanguard FTSE Social Index Admiral"], ["VIGIX", "Vanguard Growth Index Institutional"],
  ["VIGAX", "Vanguard Growth Index Admiral"], ["VVIAX", "Vanguard Value Index Admiral"], ["VIIIX", "Vanguard Institutional Index Plus"], ["VINIX", "Vanguard Institutional Index"],
  ["VIMAX", "Vanguard Mid-Cap Index Admiral"], ["VSMAX", "Vanguard Small-Cap Index Admiral"], ["VTWAX", "Vanguard Total World Stock Index Admiral"],
  ["VBIAX", "Vanguard Balanced Index Admiral"], ["VWELX", "Vanguard Wellington Investor"], ["VWIAX", "Vanguard Wellesley Income Admiral"],
  ["VGSLX", "Vanguard Real Estate Index Admiral"], ["VDADX", "Vanguard Dividend Appreciation Index Admiral"], ["VHCAX", "Vanguard Capital Opportunity Admiral"],
  ["VPMAX", "Vanguard PRIMECAP Admiral"], ["VITAX", "Vanguard Information Technology Index Admiral"], ["VTTSX", "Vanguard Target Retirement 2060"],
  ["VFFVX", "Vanguard Target Retirement 2055"], ["VTIVX", "Vanguard Target Retirement 2045"], ["VTHRX", "Vanguard Target Retirement 2030"],
  ["FXAIX", "Fidelity 500 Index"], ["FSKAX", "Fidelity Total Market Index"], ["FZROX", "Fidelity ZERO Total Market Index"], ["FZILX", "Fidelity ZERO International Index"],
  ["FXNAX", "Fidelity U.S. Bond Index"], ["FCNTX", "Fidelity Contrafund"], ["FBGRX", "Fidelity Blue Chip Growth"], ["FSPGX", "Fidelity Large Cap Growth Index"],
  ["SWPPX", "Schwab S&P 500 Index"], ["SWTSX", "Schwab Total Stock Market Index"], ["SWISX", "Schwab International Index"],
  ["TRBCX", "T. Rowe Price Blue Chip Growth"], ["PRGFX", "T. Rowe Price Growth Stock"], ["AGTHX", "American Funds Growth Fund of America"], ["AIVSX", "American Funds Investment Company of America"],
];
const OUT = new URL("../mutual_funds.json", import.meta.url);
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15";
const why = e => [e && e.message, e && e.cause && (e.cause.code || e.cause.message)].filter(Boolean).join(" / ");
const ymd = ms => new Date(ms).toISOString().slice(0, 10);
const r4 = v => Math.round(v * 1e4) / 1e4;

// fetch, then curl (some hosts refuse Node's fetch from GitHub's servers but accept curl)
async function get(url, asText) {
  const errs = [];
  try {
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 10000);
    try {
      const r = await fetch(url, { signal: ctl.signal, headers: { "User-Agent": UA, "Accept": "application/json,text/csv,*/*", "Accept-Language": "en-US,en;q=0.9" } });
      const body = await r.text();
      if (!r.ok) throw new Error(`HTTP ${r.status} ${body.slice(0, 80).replace(/\s+/g, " ")}`);
      return asText ? body : JSON.parse(body);
    } finally { clearTimeout(t); }
  } catch (e) { errs.push("fetch " + why(e)); }
  try {
    const body = execFileSync("curl", ["-sS", "--fail-with-body", "--compressed", "--max-time", "12", "-A", UA, "-H", "Accept: application/json,text/csv,*/*", url],
      { encoding: "utf8", maxBuffer: 16 << 20, stdio: ["ignore", "pipe", "pipe"] });
    return asText ? body : JSON.parse(body);
  } catch (e) { errs.push("curl " + (String(e.stderr || "").trim() || why(e)).slice(0, 120)); }
  throw new Error(errs.join("; "));
}
// Yahoo daily bars; dates are the exchange's own (New York) trading days
async function yahoo(sym) {
  let err;
  for (const host of ["query1", "query2"]) {
    try {
      const j = await get(`https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=2y&interval=1d`);
      const r = j && j.chart && j.chart.result && j.chart.result[0]; if (!r) throw new Error("no result");
      const ts = r.timestamp || [], cl = (r.indicators && r.indicators.quote && r.indicators.quote[0] && r.indicators.quote[0].close) || [], off = ((r.meta && r.meta.gmtoffset) || 0) * 1000;
      const c = []; ts.forEach((t, i) => { const v = cl[i]; if (typeof v === "number" && isFinite(v) && v > 0) c.push([ymd(t * 1000 + off), r4(v)]); });
      if (c.length < 20) throw new Error("too few bars");
      return c;
    } catch (e) { err = e; }
  }
  throw err;
}
// Stooq daily CSV: Date,Open,High,Low,Close,Volume
async function stooq(sym) {
  const t = await get(`https://stooq.com/q/d/l/?s=${encodeURIComponent(sym.toLowerCase())}.us&i=d`, true);
  const c = t.trim().split(/\r?\n/).slice(1).map(l => l.split(",")).filter(x => /^\d{4}-\d\d-\d\d$/.test(x[0]) && +x[4] > 0).map(x => [x[0], r4(+x[4])]);
  if (c.length < 20) throw new Error("too few bars");
  return c.slice(-510);
}

let old = {}; try { old = JSON.parse(readFileSync(OUT, "utf8")).funds || {}; } catch {}
const funds = {}, errors = {};
// a few funds at a time, and stop starting new ones after 3 minutes so a slow or blocking source can't time the job out
const DEADLINE = Date.now() + 180000;
async function one(sym, name) {
  const errs = [];
  let c = null;
  if (Date.now() < DEADLINE) {
    try { c = await yahoo(sym); } catch (e) { errs.push("yahoo " + why(e).slice(0, 120)); }
    if (!c && Date.now() < DEADLINE) try { c = await stooq(sym); } catch (e) { errs.push("stooq " + why(e).slice(0, 120)); }
  } else errs.push("skipped, out of time");
  if (c) funds[sym] = { n: name, c: c.slice(-510) };
  else if (old[sym]) { funds[sym] = { ...old[sym], stale: 1 }; errors[sym] = errs.join("; "); }
  else errors[sym] = errs.join("; ");
}
const queue = FUNDS.slice();
await Promise.all(Array.from({ length: 5 }, async () => { while (queue.length) { const [sym, name] = queue.shift(); await one(sym, name); } }));
const ok = Object.values(funds).filter(f => !f.stale).length;
console.log(`mutual funds: ${ok} fresh, ${Object.keys(funds).length - ok} stale, ${FUNDS.length - Object.keys(funds).length} missing`);
for (const [k, v] of Object.entries(errors)) console.log(" ", k, v);
if (!Object.keys(funds).length) { console.log("nothing fetched, keeping the old file"); process.exit(0); }
writeFileSync(OUT, JSON.stringify({ asOf: new Date().toISOString(), funds }));
