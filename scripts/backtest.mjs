// Backtest of the Bargain Scorecard and Spring Coil: score every stock the way it looked 1, 2 and 3 years ago,
// then compare with what it really returned since (total return, dividends included) against the S&P 500 (SPY).
//   node scripts/backtest.mjs            writes backtest.json and prints a summary
//   SYMS=AAPL,KO node scripts/backtest.mjs   just those tickers
// Point-in-time fundamentals come from SEC EDGAR filings (only what was filed on or before each date),
// prices from Yahoo. Runs in GitHub Actions (.github/workflows/backtest.yml); EDGAR is not reachable from every network.
import { readFileSync, writeFileSync } from "node:fs";
import { execFile } from "node:child_process";
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const grab = re => { const m = html.match(re); if (!m) throw new Error("not found in index.html: " + re); return m[0]; };
// the app's own scoring code, so the backtest scores exactly like the app
const A = new Function([
  grab(/^const mean=.*$/m), grab(/^const sma=.*$/m),
  grab(/^function rsi\(a,n=14\)\{[\s\S]*?return l===0\?100:100-100\/\(1\+g\/l\); \}$/m),
  grab(/^const BG_POOL=\{[\s\S]*?\]\};$/m), grab(/^const COIL_EXTRA=\[.*\];$/m),
  grab(/\/\* coil-math:start[\s\S]*?\/\* coil-math:end \*\//),
  grab(/\/\* bargain-math:start[\s\S]*?\/\* bargain-math:end \*\//),
].join("\n") + "\nreturn {BG_POOL,COIL_EXTRA,coilStats,coilScore,bgScore,bgTop,BG_RATINGS,BG_METRICS_KEYS:BG_METRICS.map(m=>m[0])};")();

const POOL = [...new Set(Object.values(A.BG_POOL).flat())];
const SYMS = process.env.SYMS ? process.env.SYMS.split(",") : [...new Set(POOL.concat(A.COIL_EXTRA))];
const YEARS = [1, 2, 3], DAY = 864e5, NOW = Date.now();
// www.sec.gov answers 403 to GitHub's runners; data.sec.gov and efts.sec.gov work with this agent
const SEC_UA = { "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) GoldRabbit" };
// SEC's firewall rejects Node's fetch headers from runners but accepts plain curl, so SEC calls go through curl
const curlJson = (url, ua) => new Promise((ok, no) => execFile("curl", ["-s", "-f", "-A", ua, url], { maxBuffer: 256 << 20 }, (e, out) => { if (e) return no(new Error(`curl ${e.code} ${url}`)); try { ok(JSON.parse(out)); } catch (x) { no(new Error("bad JSON " + url)); } }));
async function sec(url) { for (let i = 0; ; i++) { try { return await curlJson(url, SEC_UA["User-Agent"]); } catch (e) { if (i >= 2 || /curl 22/.test(e.message) && i >= 1) throw e; await sleep(1500 * (i + 1)); } } }
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function get(url, headers, tries = 3) {
  for (let i = 0; ; i++) {
    const r = await fetch(url, { headers });
    if (r.ok) return r.json();
    if (i >= tries - 1 || r.status === 404) throw new Error(`${r.status} ${url}`);
    await sleep(1500 * (i + 1));
  }
}

// ---------- prices (Yahoo): split-adjusted close for the averages, adjusted close for total return, split dates ----------
async function yahoo(s) {
  const j = await get(`https://query1.finance.yahoo.com/v8/finance/chart/${s.replace(".", "-")}?range=5y&interval=1d&events=split`, { "User-Agent": "Mozilla/5.0 (GoldRabbit backtest)" });
  const q = j.chart.result[0], t = q.timestamp, c = q.indicators.quote[0].close, ac = q.indicators.adjclose[0].adjclose;
  const rows = t.map((x, i) => ({ t: x * 1000, c: c[i], ac: ac[i] })).filter(r => r.c != null && r.ac != null);
  const splits = Object.values(q.events?.splits || {}).map(e => ({ t: e.date * 1000, r: e.numerator / e.denominator }));
  return { rows, splits };
}
const at = (P, T) => { let i = -1; for (let k = 0; k < P.rows.length && P.rows[k].t <= T; k++) i = k; return i; };
// shares counted on date d, in today's split basis
const splitAdj = (P, d) => P.splits.filter(x => x.t > d).reduce((m, x) => m * x.r, 1);

// ---------- fundamentals (SEC EDGAR company facts) ----------
const TAGS = {
  rev: ["Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax", "SalesRevenueNet", "RevenueFromContractWithCustomerIncludingAssessedTax", "RevenuesNetOfInterestExpense", "SalesRevenueGoodsNet"],
  ni: ["NetIncomeLoss", "ProfitLoss", "NetIncomeLossAvailableToCommonStockholdersBasic"],
  eps: ["EarningsPerShareDiluted", "EarningsPerShareBasicAndDiluted", "EarningsPerShareBasic"],
  eq: ["StockholdersEquity", "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest"],
  ltd: ["LongTermDebt", "LongTermDebtAndCapitalLeaseObligations", "LongTermDebtNoncurrent", "LongTermDebtAndCapitalLeaseObligationsNoncurrent"],
  ltdCur: ["LongTermDebtCurrent", "LongTermDebtAndCapitalLeaseObligationsCurrent"],
  std: ["ShortTermBorrowings", "CommercialPaper", "DebtCurrent"],
  cash: ["CashAndCashEquivalentsAtCarryingValue", "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents", "Cash"],
  ocf: ["NetCashProvidedByUsedInOperatingActivities", "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations"],
  capex: ["PaymentsToAcquirePropertyPlantAndEquipment", "PaymentsToAcquireProductiveAssets", "PaymentsForCapitalImprovements"],
  op: ["OperatingIncomeLoss"],
  da: ["DepreciationDepletionAndAmortization", "DepreciationAndAmortization", "DepreciationAmortizationAndAccretionNet", "Depreciation"],
};
const annual = f => f.start && (Date.parse(f.end) - Date.parse(f.start)) / DAY > 340 && (Date.parse(f.end) - Date.parse(f.start)) / DAY < 390;
const facts = (cf, tag) => { const u = cf.facts["us-gaap"]?.[tag]?.units; return u ? (u.USD || u["USD/shares"] || Object.values(u)[0]) : []; };
// the values one annual report (accn) gave for its own fiscal year and the year before
function fromFiling(cf, accn, fyEnd, list, instant) {
  for (const tag of list) {
    const fs = facts(cf, tag).filter(f => f.accn === accn && (instant ? !f.start : annual(f)));
    const cur = fs.find(f => f.end === fyEnd);
    if (!cur) continue;
    const prev = fs.find(f => Math.abs(Date.parse(f.end) - Date.parse(fyEnd) + 365 * DAY) < 20 * DAY);
    return { v: cur.val, prev: prev ? prev.val : null, tag };
  }
  return null;
}
function pointInTime(cf, T) {
  // latest 10-K filed on or before T
  const ks = TAGS.ni.flatMap(t => facts(cf, t)).filter(f => /^10-K/.test(f.form) && annual(f) && Date.parse(f.filed) <= T && f.fp === "FY");
  if (!ks.length) return null;
  const last = ks.reduce((a, b) => (b.filed > a.filed || (b.filed === a.filed && b.end > a.end) ? b : a));
  const accn = last.accn, fyEnd = ks.filter(f => f.accn === accn).reduce((a, b) => (b.end > a ? b.end : a), "");
  const g = (k, inst) => fromFiling(cf, accn, fyEnd, TAGS[k], inst);
  const o = { accn, fyEnd, filed: last.filed };
  for (const k of ["rev", "ni", "eps", "ocf", "capex", "op", "da"]) o[k] = g(k);
  for (const k of ["eq", "ltd", "ltdCur", "std", "cash"]) o[k] = g(k, true);
  // shares outstanding: latest cover-page count filed on or before T (10-K or 10-Q), all share classes added up
  const sh = (cf.facts.dei?.EntityCommonStockSharesOutstanding?.units?.shares || []).filter(f => Date.parse(f.filed) <= T);
  if (sh.length) { const lastAccn = sh.reduce((a, b) => (b.filed > a.filed ? b : a)).accn, mine = sh.filter(f => f.accn === lastAccn), end = mine.reduce((a, b) => (b.end > a ? b.end : a), "");
    o.shares = { v: mine.filter(f => f.end === end).reduce((a, f) => a + f.val, 0), end }; }
  if (!o.shares) { const w = fromFiling(cf, accn, fyEnd, ["WeightedAverageNumberOfDilutedSharesOutstanding", "WeightedAverageNumberOfSharesOutstandingBasic"]); if (w) o.shares = { v: w.v, end: fyEnd }; }
  return o;
}
// the same field names Finnhub uses, so the app's bgScore and coilScore run unchanged
function metricsAt(F, P, T) {
  const i = at(P, T); if (i < 0 || !F || !F.shares || !F.ni) return null;
  const px = P.rows[i].c, cap = F.shares.v * splitAdj(P, Date.parse(F.shares.end)) * px; // both in today's split basis
  const v = x => x && x.v, gr = x => x && x.prev ? (x.v / x.prev - 1) * 100 * Math.sign(x.prev) : null;
  const debt = (v(F.ltd) || 0) + (F.ltd && /Noncurrent$/.test(F.ltd.tag) ? v(F.ltdCur) || 0 : 0) + (v(F.std) || 0);
  const ebitda = F.op ? v(F.op) + (v(F.da) || 0) : null, fcf = F.ocf ? v(F.ocf) - (v(F.capex) || 0) : null;
  const m = { marketCapitalization: cap / 1e6, peTTM: cap / v(F.ni),
    epsGrowthTTMYoy: F.eps && F.eps.prev ? gr(F.eps) : gr(F.ni), revenueGrowthTTMYoy: gr(F.rev) };
  if (ebitda) m.evEbitdaTTM = (cap + debt - (v(F.cash) || 0)) / ebitda;
  if (fcf) m.pfcfShareTTM = cap / fcf;
  if (F.eq && v(F.eq) > 0) { m.pbQuarterly = cap / v(F.eq); m["totalDebt/totalEquityQuarterly"] = debt / v(F.eq); m.roeTTM = v(F.ni) / v(F.eq) * 100; m.roiTTM = v(F.ni) / (v(F.eq) + debt) * 100; }
  if (F.rev && v(F.rev) > 0) m.netProfitMarginTTM = v(F.ni) / v(F.rev) * 100;
  return { m, px, cap };
}

// ---------- stats ----------
const avg = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
const med = a => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y), h = s.length >> 1; return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2; };
const rank = a => { const idx = a.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0]), r = Array(a.length); for (let i = 0; i < idx.length;) { let j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++; for (let k = i; k <= j; k++) r[idx[k][1]] = (i + j) / 2 + 1; i = j + 1; } return r; };
function spearman(x, y) { if (x.length < 5) return null; const a = rank(x), b = rank(y), ma = avg(a), mb = avg(b); let n = 0, da = 0, db = 0; for (let i = 0; i < a.length; i++) { n += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; } return da && db ? n / Math.sqrt(da * db) : null; }
const group = (rows, key) => { const r = rows.map(key); return { n: r.length, avg: avg(r), med: med(r), beat: r.length ? r.filter(v => v > 0).length / r.length : null }; };
const r1 = v => v == null ? null : Math.round(v * 10) / 10, r2 = v => v == null ? null : Math.round(v * 100) / 100;
const pct = v => v == null ? "   —  " : (v >= 0 ? "+" : "") + v.toFixed(1) + "%";

// ---------- run ----------
// ticker to SEC company number, from EDGAR's own company search
async function cikOf(s) {
  const t = s.replace(".", "-"), j = await sec(`https://efts.sec.gov/LATEST/search-index?keysTyped=${encodeURIComponent(t)}`);
  const hit = (j.hits?.hits || []).find(h => String(h._source?.tickers || "").split(/,\s*/).map(x => x.toUpperCase()).includes(t));
  return hit ? String(hit._id).padStart(10, "0") : null;
}
const spy = await yahoo("SPY"), spyNow = spy.rows.at(-1);
const data = {}, skipped = [];
for (const s of SYMS) {
  let cik = null; try { cik = await cikOf(s); } catch (e) { skipped.push(`${s} (lookup failed: ${e.message})`); continue; }
  if (!cik) { skipped.push(`${s} (no SEC filer)`); continue; }
  try {
    const [cf, P] = [await sec(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`), await yahoo(s)];
    data[s] = { cf, P }; await sleep(150); // SEC asks for at most 10 requests a second
  } catch (e) { skipped.push(`${s} (${e.message.split(" ")[0]})`); }
}
console.log(`Loaded ${Object.keys(data).length} of ${SYMS.length} tickers. Skipped: ${skipped.join(", ") || "none"}`);
if (!process.env.SYMS && Object.keys(data).length < SYMS.length / 2) { console.log("Too few tickers loaded, not writing results"); process.exit(1); }

const out = { generated: new Date(NOW).toISOString(), priceAsOf: new Date(spyNow.t).toISOString().slice(0, 10), tickers: Object.keys(data).length, skipped, horizons: [] };
for (const y of YEARS) {
  const T = NOW - y * 365.25 * DAY, si = at(spy, T), spyRet = (spyNow.ac / spy.rows[si].ac - 1) * 100;
  const rows = [];
  for (const [s, { cf, P }] of Object.entries(data)) {
    const i = at(P, T); if (i < 0 || Date.now() - P.rows[0].t < (y + 0.05) * 365 * DAY) continue; // listed long enough
    const F = pointInTime(cf, T), M = metricsAt(F, P, T); if (!M) continue;
    const ret = (P.rows.at(-1).ac / P.rows[i].ac - 1) * 100, b = A.bgScore(M.m, M.px, s, null);
    const closes = P.rows.slice(0, i + 1).map(r => r.c), st = A.coilStats(closes, M.m);
    const cs = st ? A.coilScore(st) : null;
    rows.push({ x: s, ret: r1(ret), ex: r1(ret - spyRet), score: b.score, known: b.known, rating: b.rating ? A.BG_RATINGS.indexOf(b.rating) : null,
      coiled: st ? st.coiled && !st.jump : null, coil: cs ? cs.score : null, parts: cs ? Object.fromEntries(Object.entries(cs.parts).map(([k, v]) => [k, r1(v)])) : null, b200: st ? r1(st.b200) : null, cap: Math.round(M.cap / 1e9), fy: F.fyEnd,
      pe: r1(M.m.peTTM), inPool: POOL.includes(s), pts: b.pts.map(p => p.p) });
  }
  const bg = rows.filter(r => r.inPool && r.score != null).sort((a, b) => b.score - a.score || b.ex - a.ex);
  // the app's top 25 per index, picked by market cap (price for the Dow) at that date
  const capOf = x => rows.find(r => r.x === x)?.cap ?? null, pxOf = x => { const d = data[x]; if (!d) return null; const i = at(d.P, T); return i < 0 ? null : d.P.rows[i].c; };
  const top25 = new Set(["sp", "ndx", "dow"].flatMap(k => A.bgTop(A.BG_POOL[k], k, capOf, pxOf)));
  const shown = bg.filter(r => top25.has(r.x)), q = Math.max(3, Math.round(shown.length / 4));
  const coilU = rows.filter(r => r.coiled != null), coiled = coilU.filter(r => r.coiled).sort((a, b) => b.coil - a.coil), half = Math.ceil(coiled.length / 2);
  out.horizons.push({
    years: y, from: new Date(spy.rows[si].t).toISOString().slice(0, 10), spy: r1(spyRet), all: group(rows, r => r.ex),
    bargain: { n: shown.length,
      ratings: A.BG_RATINGS.map((r, i) => ({ i, label: r[2], ...group(shown.filter(o => o.rating === i), o => o.ex) })),
      top: { n: q, ...group(shown.slice(0, q), o => o.ex) }, bottom: { n: q, ...group(shown.slice(-q), o => o.ex) },
      rho: r2(spearman(shown.map(o => o.score), shown.map(o => o.ex))),
      // each metric on its own: does a higher 0/1/2 on it go with a better return?
      metrics: Object.fromEntries(A.BG_METRICS_KEYS.map((k, j) => { const w = shown.filter(o => o.pts[j] != null); return [k, r2(spearman(w.map(o => o.pts[j]), w.map(o => o.ex)))]; })) },
    coil: { n: coilU.length, coiled: group(coiled, o => o.ex), not: group(coilU.filter(r => !r.coiled), o => o.ex),
      best: group(coiled.slice(0, half), o => o.ex), rest: group(coiled.slice(half), o => o.ex),
      rho: r2(spearman(coiled.map(o => o.coil), coiled.map(o => o.ex))),
      parts: Object.fromEntries(["quality", "value", "discount", "timing"].map(k => [k, r2(spearman(coiled.map(o => o.parts[k]), coiled.map(o => o.ex)))])) },
    rows: rows.map(({ pts, inPool, ...r }) => ({ ...r, top25: top25.has(r.x) })),
  });
  // printed summary (read in the Actions log)
  const H = out.horizons.at(-1);
  console.log(`\n=== ${y} year${y > 1 ? "s" : ""} back: scored as of ${H.from}, return to ${out.priceAsOf}. S&P 500 (SPY) ${pct(spyRet)} ===`);
  console.log(`All ${rows.length} stocks: avg vs S&P ${pct(H.all.avg)}, median ${pct(H.all.med)}, ${Math.round(H.all.beat * 100)}% beat it`);
  console.log(`Bargain Scorecard (${shown.length} stocks in the top-25 lists then), Spearman score vs excess return: ${H.bargain.rho}`);
  for (const r of H.bargain.ratings) console.log(`  ${r.label.padEnd(17)} n=${String(r.n).padStart(3)}  avg vs S&P ${pct(r.avg)}  median ${pct(r.med)}  beat ${r.beat == null ? "—" : Math.round(r.beat * 100) + "%"}`);
  console.log(`  top ${q} by score: avg ${pct(H.bargain.top.avg)}   bottom ${q}: avg ${pct(H.bargain.bottom.avg)}`);
  console.log(`  top 10: ${shown.slice(0, 10).map(o => `${o.x} ${o.score} (${pct(o.ex).trim()})`).join(", ")}`);
  console.log(`Spring Coil (${coilU.length} stocks): coiled n=${H.coil.coiled.n} avg vs S&P ${pct(H.coil.coiled.avg)} | not coiled n=${H.coil.not.n} avg ${pct(H.coil.not.avg)}`);
  console.log(`  each metric vs return (Spearman): ${Object.entries(H.bargain.metrics).map(([k, v]) => `${k} ${v}`).join(", ")}`);
  console.log(`  Coil Score parts vs return among coiled (Spearman): ${Object.entries(H.coil.parts).map(([k, v]) => `${k} ${v}`).join(", ")}`);
  console.log(`  coiled, higher Coil Score half: ${pct(H.coil.best.avg)}  lower half: ${pct(H.coil.rest.avg)}  Spearman ${H.coil.rho}`);
  console.log(`  coiled: ${coiled.map(o => `${o.x} ${o.coil} (${pct(o.ex).trim()})`).join(", ")}`);
}

// Rolling panel for tuning: every 2 months from 4 years ago to 1 year ago, each stock's inputs and its next-12-month return vs SPY.
// Many more data points than the three snapshots above, so a score change can be judged on more than one market moment.
const panel = [];
for (let T = NOW - 4 * 365.25 * DAY; T <= NOW - 365.25 * DAY; T += 61 * DAY) {
  const si = at(spy, T), sj = at(spy, T + 365.25 * DAY); if (si < 0 || sj <= si) continue;
  const spyFwd = (spy.rows[sj].ac / spy.rows[si].ac - 1) * 100, d = new Date(spy.rows[si].t).toISOString().slice(0, 10);
  for (const [s, { cf, P }] of Object.entries(data)) {
    const i = at(P, T), j = at(P, T + 365.25 * DAY); if (i < 200 || j <= i) continue;
    const F = pointInTime(cf, T), M = metricsAt(F, P, T); if (!M) continue;
    const st = A.coilStats(P.rows.slice(0, i + 1).map(r => r.c), M.m); if (!st || st.jump) continue;
    const b = A.bgScore(M.m, M.px, s, null), v = b.v, cs = A.coilScore(st);
    panel.push({ d, x: s, ex: r1((P.rows[j].ac / P.rows[i].ac - 1) * 100 - spyFwd), coiled: st.coiled, coil: cs.score, bg: b.score,
      b200: r1(st.b200), b50: r1(st.b50), off: r1(st.off), R: r1(st.R), up10: st.p > st.s10, epsG: r1(st.epsG), revG: r1(st.revG), de: r2(st.de), peg: st.peg == null || isNaN(st.peg) ? null : r2(st.peg),
      pe: r1(v.pe), pb: r2(v.pb), fcfY: r1(v.fcfY), ev: r1(v.ev), roic: r1(v.roic), margin: r1(v.margin) });
  }
}
const pc = panel.filter(r => r.coiled);
console.log(`\nRolling panel: ${panel.length} stock-dates (${pc.length} coiled), next-12-month return vs S&P`);
console.log(`  Coil Score vs return among coiled: Spearman ${r2(spearman(pc.map(r => r.coil), pc.map(r => r.ex)))}; coiled avg ${pct(avg(pc.map(r => r.ex)))}, not coiled avg ${pct(avg(panel.filter(r => !r.coiled).map(r => r.ex)))}`);
console.log(`  Bargain score vs return, all: Spearman ${r2(spearman(panel.filter(r => r.bg != null).map(r => r.bg), panel.filter(r => r.bg != null).map(r => r.ex)))}`);
writeFileSync(new URL("../backtest_panel.json", import.meta.url), JSON.stringify(panel));
// sanity sample: inputs for a few names at the 1-year date
const s1 = out.horizons[0].rows.filter(r => ["AAPL", "MSFT", "NVDA", "JPM", "KO", "XOM", "INTC"].includes(r.x));
console.log("\nSanity sample (1 year back): ticker, FY used, market cap $B, P/E, score");
for (const r of s1) console.log(`  ${r.x.padEnd(6)} ${r.fy}  ${String(r.cap).padStart(5)}  ${String(r.pe).padStart(6)}  ${r.score}`);
writeFileSync(new URL("../backtest.json", import.meta.url), JSON.stringify(out));
console.log("\nwrote backtest.json");
