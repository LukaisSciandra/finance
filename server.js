const express = require('express');
const fetch = require('node-fetch');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

// Proxy endpoint for Yahoo Finance chart data
app.get('/api/chart/:symbol', async (req, res) => {
  const { symbol } = req.params;
  const { period1, period2, interval } = req.query;

  const url = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`);
  url.searchParams.set('period1', period1 || Math.floor(Date.now() / 1000 - 365 * 24 * 3600));
  url.searchParams.set('period2', period2 || Math.floor(Date.now() / 1000));
  url.searchParams.set('interval', interval || '1d');
  url.searchParams.set('events', 'history');
  url.searchParams.set('includeAdjustedClose', 'true');

  try {
    const response = await fetch(url.toString(), {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });

    if (!response.ok) {
      return res.status(response.status).json({ error: `Yahoo Finance returned ${response.status}` });
    }

    const data = await response.json();

    // Check for valid chart result
    const result = data?.chart?.result?.[0];
    if (!result) {
      const errMsg = data?.chart?.error?.description || 'No data found for symbol';
      return res.status(404).json({ error: errMsg });
    }

    const timestamps = result.timestamp;
    const closes = result.indicators?.adjclose?.[0]?.adjclose || result.indicators?.quote?.[0]?.close;
    const meta = result.meta;

    if (!timestamps || !closes) {
      return res.status(404).json({ error: 'No price data available' });
    }

    // Filter out entries where the close price is null (common for mutual funds)
    const pairs = timestamps.map((ts, i) => [ts, closes[i]]).filter(([, c]) => c != null);
    const filteredTimestamps = pairs.map(([ts]) => ts);
    const filteredCloses = pairs.map(([, c]) => c);

    if (filteredCloses.length === 0) {
      return res.status(404).json({ error: 'No price data available' });
    }

    // Determine asset type from quoteType
    const quoteType = meta?.instrumentType || meta?.quoteType || 'EQUITY';

    res.json({
      symbol: meta?.symbol || symbol,
      name: meta?.longName || meta?.shortName || symbol,
      quoteType,
      currency: meta?.currency || 'USD',
      timestamps: filteredTimestamps,
      closes: filteredCloses,
    });
  } catch (err) {
    console.error(`Error fetching ${symbol}:`, err.message);
    res.status(500).json({ error: 'Failed to fetch data from Yahoo Finance' });
  }
});

// Search endpoint for symbol lookup
app.get('/api/search', async (req, res) => {
  const { q } = req.query;
  if (!q) return res.json({ quotes: [] });

  const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=8&newsCount=0&listsCount=0`;

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      return res.status(response.status).json({ quotes: [] });
    }

    const data = await response.json();
    const quotes = (data?.quotes || []).map((q) => ({
      symbol: q.symbol,
      name: q.longname || q.shortname || q.symbol,
      type: q.quoteType,
      exchange: q.exchDisp || q.exchange,
    }));

    res.json({ quotes });
  } catch (err) {
    console.error('Search error:', err.message);
    res.status(500).json({ quotes: [] });
  }
});

app.listen(PORT, () => {
  console.log(`Multi-Asset Performance Chart running at http://localhost:${PORT}`);
});
