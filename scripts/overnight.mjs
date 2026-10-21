// Overnight snapshot for GoldRabbit's "Tomorrow" card: US index futures, after-hours index ETFs,
// Asia/Europe indexes, VIX, 10-year yield, oil and gold. Writes overnight.json in the repo root.
// Run by .github/workflows/overnight.yml every 30 minutes from the US close to the next open.
// Sources, in order: CNBC's quote service (one request for everything), then Yahoo's chart API and
// Stooq per symbol for anything still missing. A symbol nobody answers keeps its last good value,
// marked stale, so one bad request never blanks the card.
import { writeFileSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

// [key, label, group, cnbc symbol, yahoo symbol, stooq symbol]
const SYMS = [
  ["ES", "S&P 500 futures", "fut", "@SP.1", "ES=F", "es.f"],
  ["NQ", "Nasdaq 100 futures", "fut", "@ND.1", "NQ=F", "nq.f"],
  ["YM", "Dow futures", "fut", "@DJ.1", "YM=F", "ym.f"],
  ["RTY", "Russell 2000 futures", "fut", "@TFS.1", "RTY=F", null],
  ["VIX", "VIX fear gauge", "risk", ".VIX", "^VIX", null],
  ["TNX", "10-year yield", "risk", "US10Y", "^TNX", "10usy.b"],
  ["CL", "Crude oil", "risk", "@CL.1", "CL=F", "cl.f"],
  ["GC", "Gold", "risk", "@GC.1", "GC=F", "gc.f"],
  ["N225", "Japan · Nikkei", "world", ".N225", "^N225", "^nkx"],
  ["HSI", "Hong Kong · Hang Seng", "world", ".HSI", "^HSI", "^hsi"],
  ["DAX", "Germany · DAX", "world", ".GDAXI", "^GDAXI", "^dax"],
  ["FTSE", "UK · FTSE 100", "world", ".FTSE", "^FTSE", "^ukx"],
  ["SPY", "S&P 500 ETF", "etf", "SPY", "SPY", null],
  ["QQQ", "Nasdaq 100 ETF", "etf", "QQQ", "QQQ", null],
  // fiber optics & photonics for AI data centers (the card's "Fiber & photonics" row)
  ["LITE", "Lumentum · lasers", "optics", "LITE", "LITE", null],
  ["COHR", "Coherent · transceivers", "optics", "COHR", "COHR", null],
  ["AAOI", "Applied Optoelectronics · transceivers", "optics", "AAOI", "AAOI", null],
  ["CRDO", "Credo · interconnects", "optics", "CRDO", "CRDO", null],
  ["MRVL", "Marvell · optical DSPs", "optics", "MRVL", "MRVL", null],
  ["CIEN", "Ciena · data-center links", "optics", "CIEN", "CIEN", null],
  ["GLW", "Corning · fiber", "optics", "GLW", "GLW", null],
];
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15";
const num = v => { if (typeof v === "number") return isFinite(v) ? v : null; if (typeof v !== "string") return null; const s = v.replace(/[,%+\s]/g, ""); return s !== "" && isFinite(+s) ? +s : null; };
const r4 = v => v == null ? null : Math.round(v * 1e4) / 1e4;
const why = e => [e && e.message, e && e.cause && (e.cause.code || e.cause.message)].filter(Boolean).join(" / ");

// fetch, then curl (some hosts refuse Node's fetch from GitHub's servers but accept curl)
async function get(url, asText) {
  const errs = [];
  try {
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 15000);
    try {
      const r = await fetch(url, { signal: ctl.signal, headers: { "User-Agent": UA, "Accept": "application/json,text/csv,*/*", "Accept-Language": "en-US,en;q=0.9" } });
      const body = await r.text();
      if (!r.ok) throw new Error(`HTTP ${r.status} ${body.slice(0, 80).replace(/\s+/g, " ")}`);
      return asText ? body : JSON.parse(body);
    } finally { clearTimeout(t); }
  } catch (e) { errs.push("fetch " + why(e)); }
  try {
    const body = execFileSync("curl", ["-sS", "--fail-with-body", "--compressed", "--max-time", "20", "-A", UA, "-H", "Accept: application/json,text/csv,*/*", url],
      { encoding: "utf8", maxBuffer: 16 << 20, stdio: ["ignore", "pipe", "pipe"] });
    return asText ? body : JSON.parse(body);
  } catch (e) { errs.push("curl " + (String(e.stderr || "").trim() || why(e)).slice(0, 120)); }
  throw new Error(errs.join("; "));
}

// CNBC: last price, change %, and for stocks/ETFs the after-hours quote
async function cnbc(list) {
  const url = `https://quote.cnbc.com/quote-html-webservice/restQuote/symbolType/symbol?symbols=${encodeURIComponent(list.join("|"))}&requestMethod=itv&noform=1&partnerId=2&fund=1&exthrs=1&output=json&events=1`;
  const j = await get(url);
  const rows = (j && j.FormattedQuoteResult && j.FormattedQuoteResult.FormattedQuote) || [];
  const out = {};
  for (const r of rows) {
    const last = num(r.last), chg = num(r.change_pct), prev = num(r.previous_day_closing);
    if (last == null) continue;
    const x = r.ExtendedMktQuote || {}, xl = num(x.last);
    const t = Date.parse(r.last_time || "") || null, xt = Date.parse(x.last_time || "") || null;
    out[r.symbol] = { p: xl != null && (r.type === "STOCK" || r.assetType === "STOCK" || r.subType === "ETF") ? xl : last, t: xt && xl != null ? xt : t,
      reg: last, prev: prev ?? (chg != null ? last / (1 + chg / 100) : null), chgDirect: chg, src: "cnbc", ext: xl != null };
  }
  return out;
}
// Yahoo chart: last price including extended hours, the regular close, and the previous close/settle
async function yahoo(sym) {
  let err;
  for (const host of ["query1", "query2"]) {
    try {
      const j = await get(`https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=1d&interval=5m&includePrePost=true`);
      const r = j && j.chart && j.chart.result && j.chart.result[0]; if (!r) throw new Error("no result");
      const m = r.meta || {}, q = (r.indicators && r.indicators.quote && r.indicators.quote[0]) || {}, ts = r.timestamp || [];
      let last = null, lastT = null;
      for (let i = ts.length - 1; i >= 0; i--) { const c = num(q.close && q.close[i]); if (c != null) { last = c; lastT = ts[i] * 1000; break; } }
      const reg = num(m.regularMarketPrice), prev = num(m.chartPreviousClose ?? m.previousClose);
      if (reg == null) throw new Error("no price");
      return { p: last ?? reg, t: lastT ?? (m.regularMarketTime ? m.regularMarketTime * 1000 : null), reg, prev, src: "yahoo" };
    } catch (e) { err = e; }
  }
  throw err;
}
// Stooq quote CSV: Symbol,Date,Time,Open,High,Low,Close,Prev
async function stooq(sym) {
  const t = await get(`https://stooq.com/q/l/?s=${encodeURIComponent(sym)}&f=sd2t2ohlcp&h&e=csv`, true);
  const [, row] = t.trim().split(/\r?\n/); const c = (row || "").split(",");
  const close = num(c[6]), prev = num(c[7]); if (close == null) throw new Error("no price");
  return { p: close, t: Date.parse(`${c[1]}T${c[2] || "00:00:00"}Z`) || null, reg: close, prev, src: "stooq" };
}

const path = new URL("../overnight.json", import.meta.url);
let old = {}; try { old = JSON.parse(readFileSync(path, "utf8")).q || {}; } catch {}
const got = {}, notes = [];
try { const c = await cnbc(SYMS.map(s => s[3])); for (const [k, , , cs] of SYMS) if (c[cs]) got[k] = c[cs]; notes.push(`cnbc ${Object.keys(got).length}`); }
catch (e) { notes.push("cnbc failed: " + e.message.slice(0, 200)); }
await Promise.all(SYMS.filter(s => !got[s[0]]).map(async ([k, , , , y, s]) => {
  const errs = [];
  try { got[k] = await yahoo(y); return; } catch (e) { errs.push("yahoo " + e.message.slice(0, 120)); }
  if (s) { try { got[k] = await stooq(s); return; } catch (e) { errs.push("stooq " + e.message.slice(0, 120)); } }
  notes.push(`${k}: ${errs.join(" | ")}`);
}));
const q = {};
for (const [k, name, g] of SYMS) {
  const v = got[k];
  if (!v) { if (old[k]) q[k] = { ...old[k], stale: true }; continue; }
  const stock = g === "etf" || g === "optics";
  // optics stocks: chg is the regular session's move; everything else: the latest move vs the previous close/settle
  const chg = g === "optics" ? (v.chgDirect != null ? v.chgDirect : v.prev && v.reg ? (v.reg / v.prev - 1) * 100 : null)
    : v.chgDirect != null && !v.ext ? v.chgDirect : v.prev ? (v.p / v.prev - 1) * 100 : null;
  // ETFs and stocks: the after-hours or pre-market move, measured from the last regular close
  const ah = stock && v.reg && v.p !== v.reg ? (v.p / v.reg - 1) * 100 : null;
  q[k] = { name, g, p: r4(v.p), prev: r4(v.prev), chg: chg == null ? null : r4(chg), ah: ah == null ? null : r4(ah), at: v.t ? new Date(v.t).toISOString() : null, src: v.src };
}
const fresh = Object.values(q).filter(x => !x.stale).length;
console.log(`Fetched ${fresh} of ${SYMS.length}. ${notes.join(" || ")}`);
if (fresh < SYMS.length) console.log(`::warning title=overnight::${fresh} of ${SYMS.length} fetched. ${notes.join(" || ").replace(/[\r\n]+/g, " ").slice(0, 900)}`);
if (!fresh) process.exit(0);
writeFileSync(path, JSON.stringify({ made: new Date().toISOString(), q }));
const f = k => q[k] && q[k].chg != null ? `${k} ${q[k].chg.toFixed(2)}% (${q[k].src})` : `${k} —`;
console.log(`Wrote overnight.json: ${["ES", "NQ", "VIX", "N225", "SPY"].map(f).join(", ")}`);
