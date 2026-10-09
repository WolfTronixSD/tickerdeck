# GoldRabbit

GoldRabbit (formerly TickerDeck) is a real-time stock watchlist for iPhone. Prices stream from [Finnhub](https://finnhub.io) while the app is open.

**Open it:** https://wolftronixsd.github.io/tickerdeck/

## Set up on iPhone
1. Open the link above in Safari.
2. Paste your free Finnhub API key (from your Finnhub dashboard). It is saved only on your phone.
3. Optional: tap **Data settings** and add a free [Twelve Data](https://twelvedata.com/register) key for full 1D–1Y charts.
4. Tap Share → **Add to Home Screen**.

## What it does
- **Home:** live watchlist, market index tiles, holdings, signals, earnings calendar, market news
- **Sectors:** sector rotation heatmap and risk-on / risk-off reading
- **AI** and **Space:** curated theme stocks grouped by sub-industry
- **Picks:** rules-based rankings for 6-month, 1-year and forever holding periods, with reasons and risks
- **Trends:** defense & aerospace, nuclear & power, quantum, crypto, robotics and semiconductors
- **Dividends:** yield, yearly income from your shares, next ex-dividend and pay dates
- **Daily briefing:** overnight moves, this week's earnings, dividends and holidays, alerts you're close to
- **Compare:** two stocks on one chart plus a side-by-side scorecard
- **Stock detail:** tap-to-set price targets on the chart, charts with S&P 500 comparison and a statistical forecast cone, trend signals, RSI, volatility, beta, insider trades, analyst ratings, and an "Ask Claude" button

## Files
- `index.html` – the whole app
- `manifest.json`, `icon-*.png` – Home Screen app icon and name
- `sw.js` – lets the app shell load offline
