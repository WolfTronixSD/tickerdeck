// Checks the Spring Coil math in index.html.
//   node scripts/coil_check.mjs          unit tests on known data
//   REAL=1 node scripts/coil_check.mjs   also pulls real daily closes (Yahoo and Stooq) and cross-checks them
import { readFileSync } from "node:fs";
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const grab = re => { const m = html.match(re); if (!m) throw new Error("not found in index.html: " + re); return m[0]; };
const src = [
  grab(/^const mean=.*$/m), grab(/^const sma=.*$/m),
  grab(/^function rsi\(a,n=14\)\{[\s\S]*?return l===0\?100:100-100\/\(1\+g\/l\); \}$/m),
  grab(/\/\* coil-math:start[\s\S]*?\/\* coil-math:end \*\//),
  grab(/\/\* bargain-math:start[\s\S]*?\/\* bargain-math:end \*\//),
].join("\n");
const C = new Function(src + "\nreturn {mean,sma,rsi,pegCalc,coilStats,coilPick,coilScore,COIL_FILTERS,COIL_SORTS,bgValues,bgScore,bgRedFlag,bgTop,BG_RATINGS};")();

let fails = 0, passes = 0;
const ok = (cond, msg) => { if (cond) passes++; else { fails++; console.log("FAIL", msg); } };
const near = (a, b, tol, msg) => ok(a != null && b != null && Math.abs(a - b) <= tol, `${msg}: got ${a}, want ${b} ±${tol}`);

// independent reference implementations
const refSma = (a, n) => { let s = 0; for (let i = a.length - n; i < a.length; i++) s += a[i]; return s / n; };
function refRsi(a, n = 14) { // Wilder, written separately from the app
  const ch = a.slice(1).map((v, i) => v - a[i]);
  let ag = ch.slice(0, n).filter(d => d > 0).reduce((x, y) => x + y, 0) / n;
  let al = -ch.slice(0, n).filter(d => d < 0).reduce((x, y) => x + y, 0) / n;
  for (const d of ch.slice(n)) { ag = (ag * (n - 1) + Math.max(d, 0)) / n; al = (al * (n - 1) + Math.max(-d, 0)) / n; }
  return al === 0 ? 100 : 100 - 100 / (1 + ag / al);
}
const rng = seed => () => (seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32;
const walk = (n, start, drift, seed) => { const r = rng(seed), o = [start]; for (let i = 1; i < n; i++) o.push(o[i - 1] * (1 + drift + (r() - .5) * .03)); return o; };

// 1. moving averages
for (const seed of [1, 7, 42, 99]) {
  const c = walk(460, 100, 0, seed);
  for (const n of [10, 50, 200]) near(C.sma(c, n), refSma(c, n), 1e-9, `sma${n} seed ${seed}`);
}
ok(C.sma([1, 2, 3], 5) === null, "sma with too few closes is null");

// 2. RSI: StockCharts' published Wilder example (first values 70.53, 66.32, 66.55).
// Their sheet rounds the average gain/loss to 2 decimals, which moves RSI by about 0.07, so allow 0.1.
const ex = [44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.10, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28, 46.00, 46.03];
near(C.rsi(ex.slice(0, 15)), 70.53, .1, "RSI textbook day 15");
near(C.rsi(ex.slice(0, 16)), 66.32, .1, "RSI textbook day 16");
near(C.rsi(ex.slice(0, 17)), 66.55, .1, "RSI textbook day 17");
for (const seed of [3, 5, 8]) { const c = walk(460, 50, .0005, seed); near(C.rsi(c), refRsi(c), 1e-9, `RSI vs reference seed ${seed}`); }
ok(C.rsi(Array.from({ length: 30 }, (_, i) => 10 + i)) === 100, "RSI of a straight rise is 100");

// 3. coiled means strictly below both averages
const flat = Array(250).fill(100);
ok(C.coilStats(flat, null).coiled === false, "price equal to both averages is not coiled");
const down = Array.from({ length: 250 }, (_, i) => 200 - i * .4);
let st = C.coilStats(down, null);
ok(st.coiled, "steady decline is coiled");
near(st.s50, refSma(down, 50), 1e-9, "coilStats s50"); near(st.s200, refSma(down, 200), 1e-9, "coilStats s200");
near(st.b200, (down.at(-1) / refSma(down, 200) - 1) * 100, 1e-9, "% below 200-day");
near(st.hi, Math.max(...down.slice(-252)), 1e-9, "1-year high"); near(st.off, (down.at(-1) / st.hi - 1) * 100, 1e-9, "% off high");
const below50only = Array(200).fill(100).concat(Array(50).fill(100).map((v, i) => 140 - i * .5));
st = C.coilStats(below50only, null); ok(!st.coiled && st.p < st.s50 && st.p > st.s200, "below the 50-day but above the 200-day is not coiled");
ok(C.coilStats(down.slice(0, 199), null) === null, "fewer than 200 closes is skipped");

// 4. PEG
near(C.pegCalc({ peTTM: 20, epsGrowthTTMYoy: 10 }), 2, 1e-12, "PEG 20/10");
near(C.pegCalc({ peBasicExclExtraTTM: 15, epsGrowthTTMYoy: 30 }), .5, 1e-12, "PEG falls back to basic P/E");
ok(Number.isNaN(C.pegCalc({ peTTM: -5, epsGrowthTTMYoy: 10 })), "PEG with losses is n/a");
ok(Number.isNaN(C.pegCalc({ peTTM: 20, epsGrowthTTMYoy: -3 })), "PEG with shrinking earnings is n/a");
ok(Number.isNaN(C.pegCalc({})), "PEG with no fields is n/a");
ok(C.pegCalc(null) === null, "PEG before fundamentals load is pending");

// 5. setup checks
const m = { peTTM: 12, epsGrowthTTMYoy: 20, revenueGrowthTTMYoy: 5, "totalDebt/totalEquityQuarterly": .4 };
st = C.coilStats(down, m);
const chk = Object.fromEntries(st.checks.map(x => [x[0], x[2]]));
ok(chk.peg === true && chk.eps === true && chk.rev === true && chk.debt === true, "fundamental checks pass on good numbers");
ok(chk.rsi === (C.rsi(down) < 35), "RSI check follows RSI"); ok(chk.bounce === (down.at(-1) > refSma(down, 10)), "bounce check follows 10-day average");
ok(st.known === 6 && st.good === Object.values(chk).filter(Boolean).length, "score counts passing checks");
st = C.coilStats(down, null); ok(st.known === 2, "without fundamentals only RSI and bounce count");

// 6. split / bad tick guard
const split = walk(260, 100, 0, 11); for (let i = 200; i < 260; i++) split[i] /= 2;
ok(C.coilStats(split, null).jump, "a 2-for-1 split is flagged");
ok(!C.coilStats(walk(460, 100, 0, 12), null).jump, "normal moves are not flagged");

// 7. sorting and filtering
const mk = (x, b200, b50, peg, good, R, epsG, p = 1, s10 = 2) => ({ x, coiled: true, jump: false, b200, b50, peg, good, known: 6, R, epsG, p, s10 });
const rows = [mk("A", -10, -5, 2, 2, 40, 5), mk("B", -30, -2, NaN, 4, 25, -1), mk("C", -20, -9, .8, 5, 33, 9, 3, 2), { ...mk("D", -50, -50, 1, 1, 20, 1), jump: true }, { ...mk("E", -5, -5, 1, 1, 20, 1), coiled: false }];
ok(C.coilPick(rows, "200", "all").map(o => o.x).join() === "B,C,A", "sort by 200-day, skipping flagged and uncoiled");
ok(C.coilPick(rows, "50", "all").map(o => o.x).join() === "C,A,B", "sort by 50-day");
ok(C.coilPick(rows, "peg", "all").map(o => o.x).join() === "C,A,B", "sort by PEG puts n/a last");
ok(C.coilPick(rows, "score", "all").map(o => o.x).join() === "C,B,A", "sort by setup score");
ok(C.coilPick(rows, "rsi", "all").map(o => o.x).join() === "B,C,A", "sort by RSI");
ok(C.coilPick(rows, "200", "eps").map(o => o.x).join() === "C,A", "filter earnings growing");
ok(C.coilPick(rows, "200", "peg").map(o => o.x).join() === "C", "filter PEG under 1.5");
ok(C.coilPick(rows, "200", "rsi").map(o => o.x).join() === "B,C", "filter oversold");
ok(C.coilPick(rows, "200", "bounce").map(o => o.x).join() === "C", "filter bouncing");

// 8. Coil Score: 65 for the drop under the 50-day (full at 15%), 35 for the discount under the 200-day (full at 40%)
const mkS = (o) => ({ b50: -15, b200: -40, ...o });
ok(C.coilScore(mkS({})).score === 100, "15% under the 50-day and 40% under the 200-day scores 100");
ok(C.coilScore(mkS({ b50: -30, b200: -80 })).score === 100, "deeper never goes past 100");
near(C.coilScore(mkS({ b50: -7.5 })).parts.dip, 32.5, 1e-9, "7.5% under the 50-day earns half the drop points");
near(C.coilScore(mkS({ b200: -10 })).parts.discount, 8.75, 1e-9, "10% under the 200-day earns a quarter of the discount points");
ok(C.coilScore(mkS({ b50: 2, b200: 0 })).score === 0, "above the 50-day and at the 200-day scores 0");
ok(C.coilScore({ b50: -3, b200: -12 }).score === Math.round(65 * .2 + 35 * .3), "mixed example");
ok(C.coilPick([mk("A", -10, -5, 2, 2, 40, 5), mk("B", -25, -5, .5, 2, 40, 5)], "coil", "all").map(o => o.x).join() === "B,A", "sort by Coil Score");

// 9. Bargain Scorecard
const cheap = { peTTM: 12, forwardPE: 11, epsGrowthTTMYoy: 20, revenueGrowthTTMYoy: 12, evEbitdaTTM: 8, pfcfShareTTM: 15, pbQuarterly: 2, "totalDebt/totalEquityQuarterly": .3, roiTTM: 20, netProfitMarginTTM: 25 };
let g = C.bgScore(cheap, 100, "XYZ", null);
ok(g.score === 20 && g.raw === 20 && g.known === 10 && g.rating[2] === "Strong bargain", "all-strong stock scores 20/20, Strong bargain");
near(g.v.fcfY, 100 / 15, 1e-9, "FCF yield from price/FCF"); near(g.v.peg, .6, 1e-9, "PEG"); near(g.v.growth, 16, 1e-9, "growth averages sales and EPS");
const pricey = { peTTM: 60, forwardPE: 45, epsGrowthTTMYoy: -5, revenueGrowthTTMYoy: -2, evEbitdaTTM: 40, pfcfShareTTM: 80, pbQuarterly: 20, "totalDebt/totalEquityQuarterly": 3, roiTTM: 4, netProfitMarginTTM: 3 };
g = C.bgScore(pricey, 100, "XYZ", null); ok(g.score === 0 && g.rating[2] === "Avoid for now", "all-weak stock scores 0, Avoid");
const mid = { peTTM: 20, forwardPE: 20, epsGrowthTTMYoy: 15, revenueGrowthTTMYoy: 5, evEbitdaTTM: 15, pfcfShareTTM: 30, pbQuarterly: 5, "totalDebt/totalEquityQuarterly": 1, roiTTM: 10, netProfitMarginTTM: 10 };
g = C.bgScore(mid, 100, "XYZ", null); ok(g.score === 10 && g.pts.every(x => x.p === 1) && g.rating[2] === "Pricey or mixed", "all-neutral scores 10 (Pricey or mixed)");
ok(C.bgScore({ ...mid, peTTM: 14.99 }, 100, "XYZ", null).pts[0].p === 2 && C.bgScore({ ...mid, peTTM: 30 }, 100, "XYZ", null).pts[0].p === 1 && C.bgScore({ ...mid, peTTM: 30.1 }, 100, "XYZ", null).pts[0].p === 0, "P/E cut-offs 15 and 30");
ok(C.bgScore({ ...mid, peTTM: -8 }, 100, "XYZ", null).pts[0].p === 0, "negative P/E (losses) is weak");
g = C.bgScore({ peTTM: 12, epsGrowthTTMYoy: 20 }, 100, "XYZ", null);
ok(g.known === 3 && g.score === Math.round(g.raw / 3 * 10), "missing metrics: score scaled from the ones with data");
g = C.bgScore({ ...cheap, roeTTM: 15, pbQuarterly: 1.2 }, 100, "JPM", null);
ok(g.bank && g.known === 7 && ["ev", "fcfY", "de"].every(k => g.pts.find(x => x.k === k).p === null) && g.pts.find(x => x.k === "roic").p === 2, "banks skip EV/EBITDA, FCF yield, D/E and use ROE");
ok(C.bgScore({ ...cheap, pbQuarterly: 2 }, 100, "JPM", null).pts.find(x => x.k === "pb").p === 1, "bank P/B 2 is neutral");
ok(C.bgScore({}, 100, "XYZ", null).score === null, "no data, no score");
const rec = (b0, b3) => [{ buy: b0, hold: 10 - b0 }, { buy: 5, hold: 5 }, { buy: 5, hold: 5 }, { buy: b3, hold: 10 - b3 }];
ok(typeof C.bgRedFlag(rec(5, 7)) === "string" && C.bgRedFlag(rec(6, 7)) === false && C.bgRedFlag(null) === null, "red flag when buy share falls 10+ points in 3 months");
ok(C.bgScore(cheap, 100, "XYZ", rec(5, 7)).rating[2] === "Fair / watchlist", "red flag drops the rating one level");
ok(C.bgScore(pricey, 100, "XYZ", rec(5, 7)).rating[2] === "Avoid for now", "red flag can't drop below Avoid");
const caps = { A: 3, B: 9, C: 1, D: null }, px = { A: 500, B: 50, C: 900, D: 10 };
ok(C.bgTop(["A", "B", "C", "D"], "sp", x => caps[x], x => px[x], 2).join() === "B,A", "S&P/Nasdaq top by market cap");
ok(C.bgTop(["A", "B", "C", "D"], "dow", x => caps[x], x => px[x], 2).join() === "C,A", "Dow top by share price");

console.log(`unit tests: ${passes} passed, ${fails} failed`);

// 8. real market data
if (process.env.REAL) {
  const SYMS = (process.env.SYMS || "AAPL,MSFT,NVDA,AMZN,GOOGL,META,TSLA,JPM,KO,PFE,NKE,INTC,BA,XOM,DIS,UNH,SBUX,CVS,TGT,F").split(",");
  const UA = { "User-Agent": "Mozilla/5.0 (tickerdeck coil check)" };
  async function yahoo(s) {
    const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${s}?range=2y&interval=1d`, { headers: UA });
    if (!r.ok) throw new Error("yahoo " + r.status); const j = await r.json(); const q = j.chart.result[0];
    const t = q.timestamp, c = q.indicators.quote[0].close; // split-adjusted closes (not dividend-adjusted)
    return t.map((x, i) => [new Date(x * 1000).toISOString().slice(0, 10), c[i]]).filter(x => x[1] != null);
  }
  async function stooq(s) {
    const r = await fetch(`https://stooq.com/q/d/l/?s=${s.toLowerCase().replace(".", "-")}.us&i=d`, { headers: UA });
    if (!r.ok) throw new Error("stooq " + r.status); const txt = await r.text(); if (!txt.startsWith("Date")) throw new Error("stooq no data");
    return txt.trim().split("\n").slice(1).map(l => l.split(",")).map(f => [f[0], +f[4]]).filter(x => isFinite(x[1]));
  }
  async function nasdaq(s) {
    const to = new Date().toISOString().slice(0, 10), from = new Date(Date.now() - 400 * 864e5).toISOString().slice(0, 10);
    const r = await fetch(`https://api.nasdaq.com/api/quote/${s.replace(".", "%25sl%25")}/historical?assetclass=stocks&fromdate=${from}&todate=${to}&limit=9999`, { headers: { ...UA, Accept: "application/json" } });
    if (!r.ok) throw new Error("nasdaq " + r.status); const j = await r.json(); const rows = j && j.data && j.data.tradesTable && j.data.tradesTable.rows; if (!rows) throw new Error("nasdaq no data");
    return rows.map(x => { const [m, d, y] = x.date.split("/"); return [`${y}-${m}-${d}`, +x.close.replace(/[$,]/g, "")]; }).filter(x => isFinite(x[1])).reverse();
  }
  const out = []; let cross = 0, crossBad = 0, got = 0;
  for (const s of SYMS) {
    let y = null, z = null;
    try { y = await yahoo(s); } catch (e) { console.log(s, "Yahoo failed:", e.message); }
    try { z = await stooq(s); } catch (e) { try { z = await nasdaq(s); } catch (e2) { console.log(s, "second source failed:", e.message, "/", e2.message); } }
    const base = y || z; if (!base || base.length < 200) { console.log(s, "no usable history"); continue; }
    got++;
    const c = base.map(x => x[1]), st = C.coilStats(c, null);
    near(st.s50, refSma(c, 50), 1e-6, `${s} real 50-day`); near(st.s200, refSma(c, 200), 1e-6, `${s} real 200-day`); near(st.R, refRsi(c), 1e-6, `${s} real RSI`);
    if (y && z) { // same trading days from two independent feeds should give the same averages
      const zm = new Map(z), days = y.filter(x => zm.has(x[0])).slice(-200);
      if (days.length === 200) { cross++; const a = refSma(days.map(x => x[1]), 200), b = refSma(days.map(x => zm.get(x[0])), 200), d = Math.abs(a / b - 1) * 100;
        if (d > 1) { crossBad++; console.log(`  ${s}: Yahoo and the second source's 200-day differ by ${d.toFixed(2)}% (${a.toFixed(2)} vs ${b.toFixed(2)})`); } }
    }
    out.push({ s, last: base.at(-1)[0], ...st });
  }
  if (got < SYMS.length / 2) { fails++; console.log(`FAIL only ${got} of ${SYMS.length} tickers had real data`); }
  if (crossBad) { fails++; console.log(`FAIL ${crossBad} of ${cross} tickers disagree between Yahoo and the second source`); }
  console.log(`\nReal data, ${got} tickers (${cross} cross-checked against Stooq or Nasdaq):`);
  console.log("ticker  last close  price     50-day    200-day   vs50     vs200    RSI  coiled");
  for (const o of out.sort((a, b) => a.b200 - b.b200)) console.log(`${o.s.padEnd(7)} ${o.last}  ${o.p.toFixed(2).padStart(8)}  ${o.s50.toFixed(2).padStart(8)}  ${o.s200.toFixed(2).padStart(8)}  ${o.b50.toFixed(1).padStart(6)}%  ${o.b200.toFixed(1).padStart(6)}%  ${o.R.toFixed(0).padStart(3)}  ${o.coiled ? "YES" : ""}${o.jump ? " (jump flagged)" : ""}`);
}
console.log(fails ? `\n${fails} FAILED` : "\nALL PASSED");
process.exit(fails ? 1 : 0);
