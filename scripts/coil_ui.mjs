// Browser test of the Spring Coil screen with mocked market data (no keys or network needed).
//   npm i --no-save playwright && npx playwright install chromium && node scripts/coil_ui.mjs
// Every number on screen is checked against values computed here independently from the same mock data.
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const req = createRequire(import.meta.url);
let pw; try { pw = req("playwright"); } catch { pw = createRequire("/opt/node-tools/node_modules/")("playwright"); }
const root = new URL("..", import.meta.url).pathname;
const html = readFileSync(root + "index.html", "utf8").replace(/\n\}\)\(\);\n<\/script>/, "\nwindow.__t={S,today,parseET,renderCoil,coilUniverse,saveDaily,COIL_EXTRA,BG_POOL};\n})();\n</script>");
if (!html.includes("window.__t")) throw new Error("test hook not injected");
const srv = createServer((q, r) => { const p = q.url.split("?")[0]; if (p === "/" || p === "/index.html") { r.setHeader("content-type", "text/html"); return r.end(html); }
  try { r.end(readFileSync(root + p.slice(1))); } catch { r.statusCode = 404; r.end(); } }).listen(0);
const URL0 = `http://localhost:${srv.address().port}/`;

const h = s => { let x = 7; for (const c of s) x = (x * 31 + c.charCodeAt(0)) >>> 0; return x; };
const DAY = 864e5, END = Date.now() - 2 * DAY;
function series(sym) { // 460 daily closes ending two days ago
  let r = h(sym) || 1; const rnd = () => (r = (r * 1103515245 + 12345) >>> 0) / 2 ** 32;
  const drift = (rnd() - .5) * .003; let p = 40 + rnd() * 300; const out = [];
  for (let i = 0; i < 460; i++) { p *= 1 + drift + (rnd() - .5) * .028; if (sym === "SPLT" && i === 400) p /= 2; out.push([END - (459 - i) * DAY, +p.toFixed(2)]); }
  return out;
}
const live = s => +(series(s).at(-1)[1] * (1 + ((h(s + "L") % 41) - 20) / 1000)).toFixed(2);
const metric = s => h(s + "m") % 5 === 0 ? {} : { peTTM: (h(s + "p") % 60) - 8, epsGrowthTTMYoy: (h(s + "g") % 70) - 20, revenueGrowthTTMYoy: (h(s + "r") % 40) - 10, "totalDebt/totalEquityQuarterly": (h(s + "d") % 30) / 10 };
const sma = (a, n) => a.slice(-n).reduce((x, y) => x + y, 0) / n;
function rsi(a, n = 14) { const ch = a.slice(1).map((v, i) => v - a[i]); let g = ch.slice(0, n).filter(d => d > 0).reduce((x, y) => x + y, 0) / n, l = -ch.slice(0, n).filter(d => d < 0).reduce((x, y) => x + y, 0) / n;
  for (const d of ch.slice(n)) { g = (g * (n - 1) + Math.max(d, 0)) / n; l = (l * (n - 1) + Math.max(-d, 0)) / n; } return l === 0 ? 100 : 100 - 100 / (1 + g / l); }
function expect(s) { const c = series(s).map(x => x[1]).concat([live(s)]); const p = c.at(-1), s50 = sma(c, 50), s200 = sma(c, 200);
  let jump = false; for (let i = c.length - 200; i < c.length; i++) { const r = c[i] / c[i - 1]; if (r < .55 || r > 1.8) jump = true; }
  const m = metric(s), peg = m.peTTM > 0 && m.epsGrowthTTMYoy > 0 ? m.peTTM / m.epsGrowthTTMYoy : NaN;
  const R = rsi(c), s10 = sma(c, 10), b200 = (p / s200 - 1) * 100, de = m["totalDebt/totalEquityQuarterly"];
  // Coil Score, written out separately from the app
  const q = [m.epsGrowthTTMYoy == null ? null : m.epsGrowthTTMYoy > 0, m.revenueGrowthTTMYoy == null ? null : m.revenueGrowthTTMYoy > 0, de == null || de < 0 ? null : de < 1].filter(v => v != null);
  const d = -b200, disc = d <= 0 ? 0 : d <= 20 ? d / 20 : d <= 35 ? 1 : Math.max(.4, 1 - (d - 35) / 50), val = isNaN(peg) ? 0 : Math.max(0, Math.min(1, (2 - peg) / 1.5));
  const time = p > s10 ? 1 : R < 30 ? .6 : R < 35 ? .4 : R < 50 ? .2 : 0;
  const coil = Math.round(45 * (q.length ? q.filter(Boolean).length / q.length : 0) + 20 * val + 20 * disc + 15 * time);
  return { p, s50, s200, b50: (p / s50 - 1) * 100, b200, R, coiled: p < s50 && p < s200, jump, peg, coil }; }

let fails = 0, passes = 0; const ok = (c, m) => { if (c) passes++; else { fails++; console.log("FAIL", m); } };
const money = t => +t.replace(/[$,]/g, "");
const b = await pw.chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
async function page(w, keys = true) {
  const pg = await b.newPage({ viewport: { width: w, height: 844 }, deviceScaleFactor: 2 }); const errs = [];
  pg.on("pageerror", e => errs.push(e.message));
  await pg.route(/^https?:\/\/(?!localhost)/, r => { const u = new URL(r.request().url()), s = u.searchParams.get("symbol") || "SPY";
    if (u.host.includes("finnhub")) { if (u.pathname.endsWith("/quote")) { const c = live(s); return r.fulfill({ json: { c, pc: series(s).at(-1)[1], d: 0, dp: 0, h: c, l: c, o: c, t: Date.now() / 1000 | 0 } }); }
      if (u.pathname.includes("metric")) return r.fulfill({ json: { metric: metric(s) } }); if (u.pathname.includes("profile")) return r.fulfill({ json: { name: s } }); return r.fulfill({ json: [] }); }
    if (u.host.includes("twelvedata")) { tdCalls.push(s); if (!TD_ON) return r.fulfill({ json: { status: "error", code: 400, message: "mocked" } });
      const one = x => ({ meta: { currency: "USD" }, status: "ok", values: series(x).map(([t, c]) => ({ datetime: new Date(t).toISOString().slice(0, 10), close: String(c), volume: "1000" })).reverse() });
      const syms = s.split(","); return r.fulfill({ json: syms.length === 1 ? one(syms[0]) : Object.fromEntries(syms.map(x => [x, one(x)])) }); }
    return r.abort(); });
  await pg.addInitScript(k => { localStorage.setItem("tdl.key", '"x"'); localStorage.setItem("tdl.tdkey", JSON.stringify(k ? "y" : "")); localStorage.setItem("tdl.seenVer", '"99"'); localStorage.setItem("tdl.coilSort2", '"200"'); }, keys);
  await pg.goto(URL0); await pg.waitForTimeout(1200);
  return { pg, errs };
}
const SHOTS = process.env.SHOTS || "";
let TD_ON = false; const tdCalls = [];

// Bargain Scorecard with preloaded fundamentals: right stocks, right order, dots add up to the score
{ const { pg, errs } = await page(390);
  const pool = await pg.evaluate(() => [...new Set(Object.values(__t.BG_POOL).flat())]);
  const F = Object.fromEntries(pool.map(x => [x, { cap: 1000 + h(x + "c") % 900000, px: 20 + h(x + "x") % 900, m: { peTTM: 5 + h(x + "1") % 50, forwardPE: 5 + h(x + "2") % 40, epsGrowthTTMYoy: (h(x + "3") % 50) - 10, revenueGrowthTTMYoy: (h(x + "4") % 40) - 5, evEbitdaTTM: 4 + h(x + "5") % 30, pfcfShareTTM: 8 + h(x + "6") % 70, pbQuarterly: 1 + h(x + "7") % 15, "totalDebt/totalEquityQuarterly": (h(x + "8") % 25) / 10, roiTTM: h(x + "9") % 30, roeTTM: h(x + "0") % 25, netProfitMarginTTM: h(x + "a") % 35 } }]));
  await pg.evaluate(F => { const S = __t.S, now = Date.now(); for (const [x, f] of Object.entries(F)) { S.metric[x] = { m: f.m, at: now }; S.profile[x] = { name: x, cap: f.cap, ex: "", at: now }; S.quotes[x] = { c: f.px, pc: f.px, at: now }; S.bg.rec[x] = { at: now, r: [] }; } }, F);
  await pg.click("#bargainBtn"); await pg.waitForTimeout(800);
  const rows = async () => pg.$$eval(".bg-r", els => els.map(e => ({ x: e.dataset.bgx, sc: +e.querySelector(".bg-sc b").textContent, dots: [...e.querySelectorAll(".bg-dots i")].map(i => i.className) })));
  for (const [k, by] of [["sp", "cap"], ["ndx", "cap"], ["dow", "px"]]) {
    await pg.click(`[data-bgidx="${k}"]`); await pg.waitForTimeout(300);
    const R = await rows(), poolK = await pg.evaluate(k => __t.BG_POOL[k], k), want = [...poolK].sort((a, b) => F[b][by] - F[a][by]).slice(0, 25);
    ok(R.map(r => r.x).join() === want.join(), `${k}: top 25 by ${by}`);
    ok(R.every(r => { const known = r.dots.filter(d => d !== "dn"), raw = known.reduce((a, d) => a + +d.slice(1), 0); return r.sc === Math.round(raw / known.length * 10); }), `${k}: every score equals its dots`);
    if (k === "sp" && SHOTS) await pg.screenshot({ path: SHOTS + "/bargain-sp.png" }); }
  await pg.click('[data-bgidx="all"]'); await pg.waitForTimeout(300);
  const A = await rows(); ok(A.every((r, i) => !i || A[i - 1].sc >= r.sc) && new Set(A.map(r => r.x)).size === A.length, "Ranking: highest first, each stock once");
  const bank = A.find(r => r.x === "JPM"); ok(!bank || bank.dots.filter(d => d === "dn").length === 3, "bank has 3 metrics skipped");
  await pg.click(`.bg-r[data-bgx="${A[0].x}"]`); await pg.waitForTimeout(300);
  ok((await pg.$$(".bg-det > div")).length === 10, "tapping a stock shows all 10 metrics");
  if (SHOTS) await pg.screenshot({ path: SHOTS + "/bargain-detail.png" });
  await pg.click(`[data-bgopen="${A[0].x}"]`); await pg.waitForTimeout(600); ok((await pg.evaluate(() => __t.S.open)) === A[0].x, "Open chart button works");
  const over = await pg.evaluate(() => document.getElementById("sheet").scrollWidth - document.getElementById("sheet").clientWidth); ok(over <= 0, "scorecard fits the phone width");
  ok(!errs.length, "no errors in scorecard: " + errs.join("; ")); await pg.close(); }

// a fresh scan asks for price history right away, watchlist and big names first, and shows progress
{ TD_ON = true; const { pg, errs } = await page(390); await pg.click("#coilBtn"); await pg.waitForTimeout(4000);
  const first = (tdCalls.find(c => c.split(",").length === 8) || "").split(","), big = await pg.evaluate(() => __t.S.list.concat(__t.COIL_EXTRA));
  ok(first.length === 8 && first.every(x => big.includes(x)), "first history request is 8 watchlist or large-cap stocks: " + first);
  ok(/Loading price history: 8 of \d+ stocks/.test(await pg.textContent("#sheetIn")), "progress shows 8 loaded");
  ok(await pg.$(".coil-bar"), "progress bar shown"); ok(!errs.length, "no errors during scan: " + errs.join("; ")); await pg.close(); TD_ON = false; }

// no Twelve Data key: explains what's needed
{ const { pg, errs } = await page(390, false); await pg.click("#coilBtn"); await pg.waitForTimeout(500);
  ok(/Add the free Twelve Data key/.test(await pg.textContent("#sheetIn")), "no-key message");
  await pg.click("[data-close]"); await pg.waitForTimeout(500);
  const A = await pg.$$eval("#actions > *", els => els.map(e => { const r = e.getBoundingClientRect(); return { id: e.id, x: Math.round(r.left), y: Math.round(r.top), h: r.height }; }));
  ok(A[0].id === "coilBtn", "Spring Coil is the first Home button");
  ok(A[0].x === A[1].x && A[1].y > A[0].y && new Set(A.map(a => a.y)).size === 2, "Home buttons sit in two rows");
  ok(A.every(a => a.h >= 48), "Home buttons are at least 48px tall");
  ok(await pg.$eval("#actions", e => e.scrollWidth > e.clientWidth && getComputedStyle(e).overflowX === "auto"), "Home buttons swipe sideways");
  if (SHOTS) await pg.screenshot({ path: SHOTS + "/home-grid.png" }); ok(!errs.length, "no errors without key: " + errs.join("; ")); await pg.close(); }

const { pg, errs } = await page(390);
const U = await pg.evaluate(() => __t.coilUniverse());
U.push("SPLT");
await pg.evaluate(([U, D, L]) => { const { S } = __t; U.forEach(s => { S.daily[s] = { day: __t.today(), v4: 1, c: D[s].map(x => [x[0], x[1], 1000]) }; S.quotes[s] = { c: L[s], pc: D[s].at(-1)[1], at: Date.now() }; }); S.list.push("SPLT"); },
  [U, Object.fromEntries(U.map(s => [s, series(s)])), Object.fromEntries(U.map(s => [s, live(s)]))]);
await pg.click("#coilBtn"); await pg.waitForTimeout(800);
const E = Object.fromEntries(U.map(s => [s, expect(s)]));
const want = U.filter(s => E[s].coiled && !E[s].jump).sort((a, b) => E[a].b200 - E[b].b200);
const rowsOnScreen = () => pg.$$eval(".coil-r", els => els.map(e => ({ x: e.dataset.sym, t: e.innerText })));
let R = await rowsOnScreen();
ok(R.length === want.length, `coiled count ${R.length} vs expected ${want.length}`);
ok(R.map(r => r.x).join() === want.join(), "rows are exactly the expected stocks, furthest below 200-day first");
const head = await pg.textContent("#sheetIn");
ok(head.includes(`${want.length} coiled out of ${U.length} scanned`), "header count");
ok(E.SPLT.jump && /Left out because[^]*SPLT/.test(head) === E.SPLT.coiled, "split ticker is reported, not listed");
for (const r of R) { const e = E[r.x], t = r.t;
  const px = money(t.match(/\$[\d,]+\.\d\d/)[0]); ok(Math.abs(px - e.p) < .006, `${r.x} price ${px} vs ${e.p}`);
  const m50 = t.match(/50-day (\$[\d,.]+) ([+-][\d.]+)%/), m200 = t.match(/200-day (\$[\d,.]+) ([+-][\d.]+)%/);
  ok(m50 && Math.abs(money(m50[1]) - e.s50) < .006 && Math.abs(+m50[2] - e.b50) < .006, `${r.x} 50-day ${m50 && m50[0]} vs ${e.s50.toFixed(2)} ${e.b50.toFixed(2)}%`);
  ok(m200 && Math.abs(money(m200[1]) - e.s200) < .006 && Math.abs(+m200[2] - e.b200) < .006, `${r.x} 200-day ${m200 && m200[0]} vs ${e.s200.toFixed(2)} ${e.b200.toFixed(2)}%`);
  ok(money(m50[1]) >= px - .005 && money(m200[1]) >= px - .005 && e.p < e.s50 && e.p < e.s200, `${r.x} really is below both averages`);
  const rs = t.match(/RSI (\d+)/); ok(rs && Math.abs(+rs[1] - e.R) <= .5, `${r.x} RSI ${rs && rs[1]} vs ${e.R.toFixed(1)}`); }
// fundamentals arrive from Finnhub
await pg.waitForFunction(() => !document.querySelector("#sheetIn").innerText.includes("PEG …"), null, { timeout: 420000, polling: 1000 }).catch(() => {});
R = await rowsOnScreen();
for (const r of R) { const e = E[r.x], g = r.t.match(/PEG (n\/a|[\d.]+)/);
  ok(g && (isNaN(e.peg) ? g[1] === "n/a" : Math.abs(+g[1] - e.peg) < .006), `${r.x} PEG ${g && g[1]} vs ${e.peg}`); }
if (SHOTS) await pg.screenshot({ path: SHOTS + "/coil-default.png" });
// Coil Score: badges, sort, top picks and map all agree with the independent calculation
await pg.click('[data-coilsort="coil"]'); await pg.waitForTimeout(300);
R = await rowsOnScreen();
const badges = await pg.$$eval(".coil-feed .coil-r", els => els.map(e => ({ x: e.dataset.sym, v: parseInt(e.querySelector(".coil-sc b").textContent) })));
ok(badges.every(b => b.v === E[b.x].coil), "Coil Score badges: " + badges.filter(b => b.v !== E[b.x].coil).slice(0, 3).map(b => `${b.x} ${b.v} vs ${E[b.x].coil}`).join(", "));
const byCoil = [...want].sort((a, b) => E[b].coil - E[a].coil || E[a].b200 - E[b].b200);
ok(badges.map(b => b.x).join() === byCoil.join(), "Coil Score order");
const picks = await pg.$$eval(".coil-top .coil-pick", els => els.map(e => e.dataset.sym));
ok(picks.join() === byCoil.slice(0, 3).join(), `top picks ${picks} vs ${byCoil.slice(0, 3)}`);
const dots = await pg.$$eval(".coil-map .cm-dot", els => els.map(e => e.dataset.sym));
ok(dots.length === want.length && dots.every(x => want.includes(x)), `map has one dot per coiled stock (${dots.length} vs ${want.length})`);
const bars = await pg.$$eval(".coil-feed .coil-r", els => els.map(e => { const l = s => parseFloat(e.querySelector(s).style.left); return { x: e.dataset.sym, p: l(".cr-p"), a: l(".m50"), b: l(".m200") }; }));
ok(bars.every(b => b.p <= b.a && b.p <= b.b), "range bar puts today's price left of both averages");
await pg.click(`.coil-map .cm-dot[data-sym="${byCoil[0]}"]`, { force: true }); await pg.waitForTimeout(600);
ok((await pg.evaluate(() => __t.S.open)) === byCoil[0], "tapping a map dot opens that stock");
await pg.evaluate(() => { __t.S.open = "__coil"; __t.renderCoil(); }); await pg.waitForTimeout(200);
if (SHOTS) { await pg.evaluate(() => document.querySelector(".coil-top").scrollIntoView()); await pg.waitForTimeout(200); await pg.screenshot({ path: SHOTS + "/coil-top.png" }); }
// sorts and filters
const order = async () => (await rowsOnScreen()).map(r => r.x);
await pg.click('[data-coilsort="peg"]'); await pg.waitForTimeout(300);
ok((await order()).join() === [...want].sort((a, b) => (isNaN(E[a].peg) ? Infinity : E[a].peg) - (isNaN(E[b].peg) ? Infinity : E[b].peg) || E[a].b200 - E[b].b200).join(), "Lowest PEG order");
await pg.click('[data-coilsort="rsi"]'); await pg.waitForTimeout(300);
ok((await order()).join() === [...want].sort((a, b) => E[a].R - E[b].R).join(), "Most oversold order");
await pg.click('[data-coilfilter="rsi"]'); await pg.waitForTimeout(300);
ok((await order()).join() === want.filter(s => E[s].R < 35).sort((a, b) => E[a].R - E[b].R).join(), "Oversold filter");
await pg.click('[data-coilfilter="peg"]'); await pg.waitForTimeout(300);
ok((await order()).every(s => E[s].peg < 1.5), "PEG under 1.5 filter");
await pg.click('[data-coilsort="score"]'); await pg.click('[data-coilfilter="all"]'); await pg.waitForTimeout(300);
const sc = await pg.$$eval(".coil-r [data-coilwhy]", els => els.map(e => +e.textContent.match(/(\d)\//)[1]));
ok(sc.every((v, i) => !i || sc[i - 1] >= v), "Best setup sorts by score");
// setup badge opens the checklist, without opening the stock
const first = (await order())[0];
await pg.click(`[data-coilwhy="${first}"]`); await pg.waitForTimeout(300);
ok(await pg.$(".coil-why") && (await pg.evaluate(() => __t.S.open)) === "__coil", "setup badge shows checks");
if (SHOTS) { await pg.evaluate(() => document.querySelector(".coil-lbl").scrollIntoView()); await pg.waitForTimeout(200); await pg.screenshot({ path: SHOTS + "/coil-rows.png" }); }
await pg.click(".coil-help summary"); await pg.waitForTimeout(500);
await pg.evaluate(() => __t.renderCoil());
ok(await pg.$eval(".coil-help", d => d.open), "help stays open after a refresh");
// tap targets and layout
const small = await pg.$$eval(".coil-chips button, #sheetIn .close", els => els.filter(e => e.getBoundingClientRect().height < 40).length);
ok(small === 0, `${small} buttons shorter than 40px`);
if (SHOTS) await pg.screenshot({ path: SHOTS + "/coil-score.png" });
await pg.click(`.coil-r[data-sym="${first}"] b`); await pg.waitForTimeout(800);
ok((await pg.evaluate(() => __t.S.open)) === first, "tapping a row opens its chart");
ok(!errs.length, "no page errors: " + errs.join("; "));
for (const w of [320, 375, 430]) { await pg.setViewportSize({ width: w, height: 800 }); await pg.evaluate(() => { __t.S.open = "__coil"; __t.renderCoil(); }); await pg.waitForTimeout(200);
  const over = await pg.evaluate(() => { const sh = document.getElementById("sheet"); return Math.max(document.documentElement.scrollWidth - innerWidth, sh.scrollWidth - sh.clientWidth); });
  if (over > 0) console.log(await pg.evaluate(() => { const sh = document.getElementById("sheet"); return [document.documentElement.scrollWidth, innerWidth, sh.scrollWidth, sh.clientWidth]; }), await pg.evaluate(() => [...document.querySelectorAll("#sheet *, body > *, header *")].filter(e => e.getBoundingClientRect().right > Math.min(innerWidth, document.getElementById("sheet").getBoundingClientRect().right) + .5).slice(0, 8).map(e => e.tagName + "." + e.className + " " + Math.round(e.getBoundingClientRect().right) + " " + (e.textContent || "").slice(0, 40))));
  ok(over <= 0, `no sideways scroll at ${w}px (${over}px over)`); }
// history survives a reload (kept in IndexedDB, not size-limited localStorage)
{ const n0 = await pg.evaluate(async () => { await __t.saveDaily(true); return Object.keys(__t.S.daily).length; });
  await pg.reload(); await pg.waitForTimeout(1500); await pg.click("#coilBtn"); await pg.waitForTimeout(1500);
  const n1 = await pg.evaluate(() => Object.keys(__t.S.daily).length);
  ok(n1 >= n0 && n0 > 150, `saved history restored after reload (${n1} of ${n0} stocks)`);
  ok((await pg.evaluate(() => localStorage.getItem("tdl.daily"))) === null, "history no longer stored in localStorage");
  ok(/coiled out of 18\d scanned/.test(await pg.textContent("#sheetIn")), "list rebuilt from saved history"); }
await b.close(); srv.close();
console.log(`UI tests: ${passes} passed, ${fails} failed`); process.exit(fails ? 1 : 0);
