// Overnight snapshot for GoldRabbit's "Tomorrow" card: US index futures, after-hours index ETFs,
// Asia/Europe indexes, VIX, 10-year yield, oil and gold. Writes overnight.json in the repo root.
// Run by .github/workflows/overnight.yml every 30 minutes from the US close to the next open.
// Each symbol tries Yahoo's chart API, then Stooq; a symbol that fails keeps its last good value
// (marked by its own "at" time) so one bad request never blanks the card.
import { writeFileSync, readFileSync, existsSync } from "node:fs";

// [key, label, group, yahoo symbol, stooq symbol]
const SYMS = [
  ["ES", "S&P 500 futures", "fut", "ES=F", "es.f"],
  ["NQ", "Nasdaq 100 futures", "fut", "NQ=F", "nq.f"],
  ["YM", "Dow futures", "fut", "YM=F", "ym.f"],
  ["RTY", "Russell 2000 futures", "fut", "RTY=F", "rty.f"],
  ["VIX", "VIX fear gauge", "risk", "^VIX", null],
  ["TNX", "10-year yield", "risk", "^TNX", "10usy.b"],
  ["CL", "Crude oil", "risk", "CL=F", "cl.f"],
  ["GC", "Gold", "risk", "GC=F", "gc.f"],
  ["N225", "Japan · Nikkei", "world", "^N225", "^nkx"],
  ["HSI", "Hong Kong · Hang Seng", "world", "^HSI", "^hsi"],
  ["DAX", "Germany · DAX", "world", "^GDAXI", "^dax"],
  ["FTSE", "UK · FTSE 100", "world", "^FTSE", "^ukx"],
  ["SPY", "S&P 500 ETF", "etf", "SPY", null],
  ["QQQ", "Nasdaq 100 ETF", "etf", "QQQ", null],
];
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15";
const num = v => (typeof v === "number" && isFinite(v)) ? v : (typeof v === "string" && v.trim() !== "" && isFinite(+v) ? +v : null);
const r4 = v => v == null ? null : Math.round(v * 1e4) / 1e4;
async function get(url, asText) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 15000);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { "User-Agent": UA, "Accept": asText ? "text/csv,*/*" : "application/json,*/*" } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return asText ? r.text() : r.json();
  } finally { clearTimeout(t); }
}
// Yahoo chart: last price, previous close/settle, and for ETFs the after-hours price
async function yahoo(sym) {
  for (const host of ["query1", "query2"]) {
    try {
      const j = await get(`https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=2d&interval=5m&includePrePost=true`);
      const r = j && j.chart && j.chart.result && j.chart.result[0]; if (!r) throw new Error("no result");
      const m = r.meta || {}, q = (r.indicators && r.indicators.quote && r.indicators.quote[0]) || {}, ts = r.timestamp || [];
      // newest non-empty bar, which includes extended-hours trades
      let last = null, lastT = null;
      for (let i = ts.length - 1; i >= 0; i--) { const c = num(q.close && q.close[i]); if (c != null) { last = c; lastT = ts[i] * 1000; break; } }
      const reg = num(m.regularMarketPrice), prev = num(m.chartPreviousClose ?? m.previousClose);
      const regT = num(m.regularMarketTime) ? m.regularMarketTime * 1000 : null;
      if (reg == null) throw new Error("no price");
      return { p: last ?? reg, t: lastT ?? regT, reg, regT, prev, src: "yahoo" };
    } catch (e) { var err = e; }
  }
  throw err;
}
// Stooq quote CSV: Symbol,Date,Time,Open,High,Low,Close,Prev (previous close, when Stooq sends it)
async function stooq(sym) {
  const t = await get(`https://stooq.com/q/l/?s=${encodeURIComponent(sym)}&f=sd2t2ohlcp&h&e=csv`, true);
  const [, row] = t.trim().split(/\r?\n/); const c = (row || "").split(",");
  const close = num(c[6]), prev = num(c[7]); if (close == null) throw new Error("no price");
  return { p: close, t: Date.parse(`${c[1]}T${c[2] || "00:00:00"}Z`) || null, reg: close, prev, src: "stooq" };
}

const path = new URL("../overnight.json", import.meta.url);
let old = {}; try { old = JSON.parse(readFileSync(path, "utf8")).q || {}; } catch {}
const q = {}, fails = [];
await Promise.all(SYMS.map(async ([k, name, g, y, s]) => {
  let v = null, why = [];
  try { v = await yahoo(y); } catch (e) { why.push("yahoo " + e.message); }
  if (!v && s) { try { v = await stooq(s); } catch (e) { why.push("stooq " + e.message); } }
  if (v) {
    const chg = v.prev ? (v.p / v.prev - 1) * 100 : null;
    // ETFs: after-hours move is measured from today's regular close
    const ah = g === "etf" && v.reg && v.p !== v.reg ? (v.p / v.reg - 1) * 100 : null;
    q[k] = { name, g, p: r4(v.p), prev: r4(v.prev), chg: chg == null ? null : r4(chg), ah: ah == null ? null : r4(ah), at: v.t ? new Date(v.t).toISOString() : null, src: v.src };
  } else {
    fails.push(`${k}: ${why.join(" / ")}`);
    if (old[k]) q[k] = { ...old[k], stale: true };
  }
}));
const fresh = Object.values(q).filter(x => !x.stale).length;
console.log(`Fetched ${fresh} of ${SYMS.length}${fails.length ? `; failed: ${fails.join(" | ")}` : ""}`);
if (!fresh) { console.log(`::warning title=overnight::No source answered; keeping the previous file`); process.exit(0); }
const out = { made: new Date().toISOString(), q };
writeFileSync(path, JSON.stringify(out));
const f = k => q[k] && q[k].chg != null ? `${k} ${q[k].chg.toFixed(2)}%` : `${k} —`;
console.log(`Wrote overnight.json: ${["ES", "NQ", "VIX", "N225"].map(f).join(", ")}`);
