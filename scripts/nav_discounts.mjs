// Closed-end fund discounts to net asset value (NAV), for the NAV discounts sheet in GoldRabbit.
// Source: CEFConnect daily pricing (Nuveen). Writes nav_discounts.json in the repo root.
// Run by .github/workflows/nav-discounts.yml every weekday evening. Keeps the old file if the fetch looks wrong.
import { writeFileSync, readFileSync, existsSync } from "node:fs";

const PROPS = ["Ticker","Name","CategoryName","Strategy","SponsorName","Price","NAV","Discount","Discount52WkAvg","ZScore1Yr",
  "DistributionRatePrice","DistributionFrequency","MarketCapUSDm","AvgDailyVolume","ExpenseRatio","IsLeveraged","LastUpdated"];
const API = `https://www.cefconnect.com/api/v3/DailyPricing?props=${PROPS.join(",")}/`;

const num = v => (typeof v === "number" && isFinite(v)) ? v : (typeof v === "string" && v.trim() !== "" && isFinite(+v) ? +v : null);
const r2 = v => v == null ? null : Math.round(v * 100) / 100;

async function get() {
  let last;
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(API, { headers: { "Accept": "application/json", "User-Agent": "GoldRabbit/1.0 (+https://wolftronixsd.github.io/tickerdeck/)" } });
      if (!res.ok) throw new Error("HTTP " + res.status);
      return await res.json();
    } catch (e) { last = e; await new Promise(r => setTimeout(r, 4000 * (i + 1))); }
  }
  throw last;
}

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
