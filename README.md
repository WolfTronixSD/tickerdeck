# GoldRabbit

GoldRabbit (formerly TickerDeck) is a real-time stock watchlist for iPhone. Prices stream from [Finnhub](https://finnhub.io) while the app is open.

**Open it:** https://wolftronixsd.github.io/tickerdeck/

## Set up on iPhone
1. Open the link above in Safari.
2. Paste your free Finnhub API key (from your Finnhub dashboard). It is saved only on your phone.
3. Optional: tap **Data settings** and add a free [Twelve Data](https://twelvedata.com/register) key for full 1D–1Y charts.
4. Tap Share → **Add to Home Screen**.

## What it does
- **Home:** live watchlist, market index tiles, live Bitcoin / Ethereum / Solana prices (24/7, no key), holdings, signals, earnings calendar, market news
- **Sectors:** sector rotation heatmap and risk-on / risk-off reading
- **AI** and **Space:** curated theme stocks grouped by sub-industry
- **Picks:** rules-based rankings for 6-month, 1-year and forever holding periods, with reasons and risks
- **Trends:** Magnificent 7, macro (bonds, gold, oil, dollar, volatility), cybersecurity, defense & aerospace, banks & payments, energy & oil, healthcare & GLP-1, nuclear & power, quantum, crypto, robotics and semiconductors
- **Dividends:** yield, yearly income from your shares, next ex-dividend and pay dates
- **Look ahead:** next week, month and quarter: Fed, jobs, CPI/PCE, GDP, options expiration, holidays, earnings, dividends, typical move ranges
- **Listen & watch:** top 5 financial podcasts, business radio streams and YouTube channels (with live streams), plus latest videos for your tickers
- **Reports:** weekly, monthly and yearly reports to share or expand with Claude
- **Daily briefing:** overnight moves, this week's earnings, dividends and holidays, alerts you're close to
- **StockPlotter:** paste your holdings once (they stay on your device) to plot their value over time; a slider, date picker and day-step buttons look back at any past day, and each stock can be plotted on its own. Pro charts: range high/low, then-vs-now table, horse race, vs S&P 500 / Nasdaq / Nasdaq 100 / Dow, who made you money, heat map, drawdown, monthly returns and risk stats. Record dated buys and sells so past days use the shares you held then; weekly, monthly, 6-month and yearly reports with market events; Ask Claude links with your numbers filled in; ideas to consider; 20, 50, 100 and 200-day moving averages (for the compare index too); golden and death cross markers; holdings as list, bars or bubbles with sorting; fun reports with grades, awards and Save PDF; and an Analyze this chart sheet explaining you vs the chosen index. Mutual funds get their daily closes from `mutual_funds.json` (about 40 popular funds, refreshed each weekday evening)
- **Compare:** two stocks on one chart plus a side-by-side scorecard
- **Stock detail:** tap-to-set price targets on the chart, charts with S&P 500 comparison and a statistical forecast cone, trend signals, RSI, volatility, beta, insider trades, analyst ratings, and an "Ask Claude" button

## Files
- `index.html` – the whole app
- `manifest.json`, `icon-*.png` – Home Screen app icon and name
- `sw.js` – lets the app shell load offline
