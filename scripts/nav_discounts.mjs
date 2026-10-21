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
// share of funds that came back with fund size and volume (a 0 volume means the field was blank)
const has = v => v != null && v !== "" && v !== 0 && v !== "0";
const rich = a => Array.isArray(a) && a.length ? a.filter(f => f && has(f.MarketCapUSDm) && has(f.AvgDailyVolume)).length / a.length : 0;
// The endpoints don't always fill the same fields (one day volume is blank, another the z-score),
// so ask all of them and, fund by fund, take the first real value for each field.
async function get() {
  const got = [], errs = [];
  for (const API of APIS) {
    try { const a = await getOne(API); if (Array.isArray(a) && a.length >= 100) got.push(a); else errs.push(`${API}: ${Array.isArray(a) ? a.length + " funds" : "not a list"}`); }
    catch (e) { errs.push(e.message); }
  }
  if (!got.length) throw new Error(errs.join(" || "));
  // newest prices first, then the answer with the most fields filled
  const newest = a => a.reduce((m, f) => (f && f.LastUpdated && String(f.LastUpdated) > m ? String(f.LastUpdated) : m), "").slice(0, 10);
  got.sort((a, b) => newest(b).localeCompare(newest(a)) || rich(b) - rich(a));
  const byT = new Map();
  for (const a of got) for (const f of a) {
    const t = f && String(f.Ticker || "").trim().toUpperCase(); if (!t) continue;
    const o = byT.get(t); if (!o) { if (a === got[0]) byT.set(t, { ...f }); continue; } // the newest answer decides which funds are listed
    for (const k in f) if (!has(o[k]) && has(f[k])) o[k] = f[k];
  }
  const best = [...byT.values()];
  console.log(`Using ${best.length} funds from ${got.length} answers, ${Math.round(rich(best) * 100)}% with size and volume`);
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
    mc: r2(num(f.MarketCapUSDm)), v: has(f.AvgDailyVolume) ? num(f.AvgDailyVolume) : null,
    er: r2(num(f.ExpenseRatio)), lev: f.IsLeveraged === true,
    at: f.LastUpdated ? String(f.LastUpdated).slice(0, 10) : null,
  };
}).filter(f => /^[A-Z][A-Z0-9.]{0,6}$/.test(f.s) && f.p > 0 && f.nav > 0 && f.d != null)
  .sort((a, b) => a.d - b.d);

if (funds.length < 100) throw new Error(`Only ${funds.length} usable funds; keeping the previous file`);

const path = new URL("../nav_discounts.json", import.meta.url);
const prev = existsSync(path) ? readFileSync(path, "utf8") : "";
// Average daily volume moves slowly, so when the source leaves it blank, keep the last known figure.
// Funds with no volume at all show as unknown (null), never as 0 shares a day.
{ let old = {}; try { for (const f of JSON.parse(prev).funds || []) if (f.v > 0) old[f.s] = f.v; } catch {}
  let kept = 0; for (const f of funds) if (f.v == null && old[f.s]) { f.v = old[f.s]; kept++; }
  if (kept) console.log(`Volume missing for ${kept} funds; kept the last known figure`); }

const dates = funds.map(f => f.at).filter(Boolean).sort();
const out = { asOf: dates[dates.length - 1] || null, made: new Date().toISOString(), source: "CEFConnect", count: funds.length, funds };
const next = JSON.stringify(out);
// only rewrite when the fund data changed (ignore the "made" stamp), so quiet days make no commit
const strip = s => { try { const j = JSON.parse(s); delete j.made; return JSON.stringify(j); } catch { return ""; } };
if (strip(prev) === strip(next)) { console.log("No change"); process.exit(0); }
writeFileSync(path, next);
const top = funds.slice(0, 5).map(f => `${f.s} ${f.d}%`).join(", ");
console.log(`Wrote ${funds.length} funds as of ${out.asOf}. Deepest: ${top}`);
