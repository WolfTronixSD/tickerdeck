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
].join("\n");
const C = new Function(src + "\nreturn {mean,sma,rsi,pegCalc,coilStats,coilPick,COIL_FILTERS,COIL_SORTS};")();

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
  const out = []; let cross = 0, crossBad = 0, got = 0;
  for (const s of SYMS) {
    let y = null, z = null;
    try { y = await yahoo(s); } catch (e) { console.log(s, "Yahoo failed:", e.message); }
    try { z = await stooq(s); } catch (e) { console.log(s, "Stooq failed:", e.message); }
    const base = y || z; if (!base || base.length < 200) { console.log(s, "no usable history"); continue; }
    got++;
    const c = base.map(x => x[1]), st = C.coilStats(c, null);
    near(st.s50, refSma(c, 50), 1e-6, `${s} real 50-day`); near(st.s200, refSma(c, 200), 1e-6, `${s} real 200-day`); near(st.R, refRsi(c), 1e-6, `${s} real RSI`);
    if (y && z) { // same trading days from two independent feeds should give the same averages
      const zm = new Map(z), days = y.filter(x => zm.has(x[0])).slice(-200);
      if (days.length === 200) { cross++; const a = refSma(days.map(x => x[1]), 200), b = refSma(days.map(x => zm.get(x[0])), 200), d = Math.abs(a / b - 1) * 100;
        if (d > 1) { crossBad++; console.log(`  ${s}: Yahoo and Stooq 200-day differ by ${d.toFixed(2)}% (${a.toFixed(2)} vs ${b.toFixed(2)})`); } }
    }
    out.push({ s, last: base.at(-1)[0], ...st });
  }
  if (got < SYMS.length / 2) { fails++; console.log(`FAIL only ${got} of ${SYMS.length} tickers had real data`); }
  if (crossBad) { fails++; console.log(`FAIL ${crossBad} of ${cross} tickers disagree between Yahoo and Stooq`); }
  console.log(`\nReal data, ${got} tickers (${cross} cross-checked between Yahoo and Stooq):`);
  console.log("ticker  last close  price     50-day    200-day   vs50     vs200    RSI  coiled");
  for (const o of out.sort((a, b) => a.b200 - b.b200)) console.log(`${o.s.padEnd(7)} ${o.last}  ${o.p.toFixed(2).padStart(8)}  ${o.s50.toFixed(2).padStart(8)}  ${o.s200.toFixed(2).padStart(8)}  ${o.b50.toFixed(1).padStart(6)}%  ${o.b200.toFixed(1).padStart(6)}%  ${o.R.toFixed(0).padStart(3)}  ${o.coiled ? "YES" : ""}${o.jump ? " (jump flagged)" : ""}`);
}
console.log(fails ? `\n${fails} FAILED` : "\nALL PASSED");
process.exit(fails ? 1 : 0);
