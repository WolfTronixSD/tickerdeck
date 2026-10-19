// Closed-end fund discounts to net asset value (NAV), for the NAV discounts sheet in GoldRabbit.
// Source: CEFConnect daily pricing (Nuveen). Writes nav_discounts.json in the repo root.
// Run by .github/workflows/nav-discounts.yml every weekday evening. Keeps the old file if the fetch looks wrong.
import { writeFileSync, readFileSync, existsSync } from "node:fs";

const PROPS = ["Ticker","Name","CategoryName","Strategy","SponsorName","Price","NAV","Discount","Discount52WkAvg","ZScore1Yr",
  "DistributionRatePrice","DistributionFrequency","MarketCapUSDm","AvgDailyVolume","ExpenseRatio","IsLeveraged","LastUpdated"];
// The API trims fields when it is given a props list, so try the full payload first and keep the richest answer.
const BASE = "https://www.cefconnect.com/api/v3/DailyPricing";
const APIS = [`${BASE}/`, `${BASE}?props=Ticker,Name,PriceDate/`, `${BASE}?props=${PROPS.join(",")}/`];

const num = v => (typeof v === "number" && isFinite(v)) ? v : (typeof v === "string" && v.trim() !== "" && isFinite(+v) ? +v : null);
const r2 = v => v == null ? null : Math.round(v * 100) / 100;

import { execFileSync } from "node:child_process";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15";
const why = e => [e && e.message, e && e.cause && (e.cause.code || e.cause.message)].filter(Boolean).join(" / ");
const parse = (body, what) => { try { return JSON.parse(body); } catch { throw new Error(`${what} not JSON: ${body.slice(0, 160).replace(/\s+/g, " ")}`); } };
async function viaFetch(API) {
  const res = await fetch(API, { headers: { "Accept": "application/json, text/plain, */*", "User-Agent": UA, "Referer": "https://www.cefconnect.com/closed-end-funds-daily-pricing" } });
  const body = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${body.slice(0, 160).replace(/\s+/g, " ")}`);
  return parse(body, "fetch");
}
function viaCurl(API) {
  const body = execFileSync("curl", ["-sS", "--fail-with-body", "--compressed", "--max-time", "60", "--retry", "2", "-A", UA,
    "-H", "Accept: application/json, text/plain, */*", "-H", "Referer: https://www.cefconnect.com/closed-end-funds-daily-pricing", API],
    { encoding: "utf8", maxBuffer: 64 << 20, stdio: ["ignore", "pipe", "pipe"] });
  return parse(body, "curl");
}
async function getOne(API) {
  const errs = [];
  for (let i = 0; i < 2; i++) {
    try { return await viaFetch(API); } catch (e) { errs.push("fetch: " + why(e)); }
    try { return viaCurl(API); } catch (e) { errs.push("curl: " + (String(e.stderr || "").trim() || why(e)).slice(0, 200)); }
    await new Promise(r => setTimeout(r, 5000));
  }
  throw new Error(errs.join(" | "));
}
// share of funds that came back with fund size and volume
const rich = a => Array.isArray(a) && a.length ? a.filter(f => f && f.MarketCapUSDm != null && f.AvgDailyVolume != null).length / a.length : 0;
async function get() {
  let best = null, errs = [];
  for (const API of APIS) {
    try { const a = await getOne(API); if (Array.isArray(a) && a.length >= 100 && (!best || rich(a) > rich(best))) best = a; if (rich(best) > .5) break; }
    catch (e) { errs.push(e.message); }
  }
  if (!best) throw new Error(errs.join(" || "));
  console.log(`Using ${best.length} funds, ${Math.round(rich(best) * 100)}% with size and volume`);
  return best;
}

// surface failures as GitHub annotations so they can be read without the full log
process.on("uncaughtException", e => { console.log(`::error title=nav-discounts::${String(e && e.message || e).replace(/[\r\n]+/g, " ")}`); process.exit(1); });
process.on("unhandledRejection", e => { console.log(`::error title=nav-discounts::${String(e && e.message || e).replace(/[\r\n]+/g, " ")}`); process.exit(1); });
const raw = await get();
if (!Array.isArray(raw)) throw new Error("Unexpected response (not a list)");

const funds = raw.map(f => {
  const price = num(f.Price), nav = num(f.NAV);
  let disc = num(f.Discount);
  if (disc == null && price && nav) disc = (price / nav - 1) * 100;
  return {
    s: String(f.Ticker || "").trim().toUpperCase(),
    n: String(f.Name || "").trim(),
    c: String(f.CategoryName || "").replace(/^Morningstar US CEF\s*/i, "").trim() || String(f.Strategy || "").trim(),
    sp: String(f.SponsorName || "").trim(),
    p: r2(price), nav: r2(nav), d: r2(disc),
    d52: r2(num(f.Discount52WkAvg)), z: r2(num(f.ZScore1Yr)),
    y: r2(num(f.DistributionRatePrice)), fq: f.DistributionFrequency || null,
    mc: r2(num(f.MarketCapUSDm)), v: num(f.AvgDailyVolume),
    er: r2(num(f.ExpenseRatio)), lev: f.IsLeveraged === true,
    at: f.LastUpdated ? String(f.LastUpdated).slice(0, 10) : null,
  };
}).filter(f => /^[A-Z][A-Z0-9.]{0,6}$/.test(f.s) && f.p > 0 && f.nav > 0 && f.d != null)
  .sort((a, b) => a.d - b.d);

if (funds.length < 100) throw new Error(`Only ${funds.length} usable funds; keeping the previous file`);

const dates = funds.map(f => f.at).filter(Boolean).sort();
const out = { asOf: dates[dates.length - 1] || null, made: new Date().toISOString(), source: "CEFConnect", count: funds.length, funds };
const path = new URL("../nav_discounts.json", import.meta.url);
const prev = existsSync(path) ? readFileSync(path, "utf8") : "";
const next = JSON.stringify(out);
// only rewrite when the fund data changed (ignore the "made" stamp), so quiet days make no commit
const strip = s => { try { const j = JSON.parse(s); delete j.made; return JSON.stringify(j); } catch { return ""; } };
if (strip(prev) === strip(next)) { console.log("No change"); process.exit(0); }
writeFileSync(path, next);
const top = funds.slice(0, 5).map(f => `${f.s} ${f.d}%`).join(", ");
console.log(`Wrote ${funds.length} funds as of ${out.asOf}. Deepest: ${top}`);
