const axios = require('axios');
const { SMA, RSI, ATR } = require('technicalindicators');

const BINANCE_API_URL = 'https://api4.binance.com/api/v3';
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
};

// ─── Helpers ────────────────────────────────────────────────────────────────

async function fetchWithRetry(url, params = {}, retries = 1) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await axios.get(url, { params, headers: HEADERS, timeout: 6000 });
    } catch (err) {
      if (attempt === retries) throw err;
    }
  }
}

async function getAllUsdtPairs() {
  try {
    const res = await fetchWithRetry(`${BINANCE_API_URL}/ticker/24hr`);
    return res.data
      .filter(t => t.symbol.endsWith('USDT') && parseFloat(t.quoteVolume) > 100_000)
      .sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
      .map(t => t.symbol);
  } catch {
    return ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'ADAUSDT', 'AVAXUSDT', 'DOGEUSDT'];
  }
}

// Run async tasks with max N concurrent workers
async function pool(items, concurrency, fn) {
  const results = [];
  let index = 0;
  async function worker() {
    while (index < items.length) {
      const i = index++;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return results;
}

async function fetchKlines(symbol, limit = 150) {
  try {
    const res = await fetchWithRetry(`${BINANCE_API_URL}/klines`, { symbol, interval: '1d', limit });
    return res.data.map(k => ({
      open:   parseFloat(k[1]),
      high:   parseFloat(k[2]),
      low:    parseFloat(k[3]),
      close:  parseFloat(k[4]),
      volume: parseFloat(k[5])
    }));
  } catch {
    return null;
  }
}

// ─── BTC Market Filter ───────────────────────────────────────────────────────

async function getBtcContext() {
  const klines = await fetchKlines('BTCUSDT', 150);
  if (!klines || klines.length < 101) return { btcPrice: 0, btcMA100: 0, btcAboveMA100: false };
  const closes = klines.map(k => k.close);
  const ma100 = SMA.calculate({ period: 100, values: closes });
  const btcPrice = closes[closes.length - 1];
  const btcMA100 = ma100[ma100.length - 1];
  return { btcPrice, btcMA100, btcAboveMA100: btcPrice > btcMA100 };
}

// ─── Advanced Scoring ────────────────────────────────────────────────────────

function score(klines, btcAboveMA100) {
  const closes  = klines.map(k => k.close);
  const highs   = klines.map(k => k.high);
  const lows    = klines.map(k => k.low);
  const volumes = klines.map(k => k.volume);
  const n = closes.length;

  const currentPrice   = closes[n - 1];
  const yesterdayClose = closes[n - 2];
  const currentVolume  = volumes[n - 1];

  // Moving Averages
  const ma20arr  = SMA.calculate({ period: 20,  values: closes });
  const ma50arr  = SMA.calculate({ period: 50,  values: closes });
  const ma100arr = SMA.calculate({ period: 100, values: closes });
  const ma20  = ma20arr[ma20arr.length - 1];
  const ma50  = ma50arr[ma50arr.length - 1];
  const ma100 = ma100arr[ma100arr.length - 1];
  const prevMA100 = ma100arr[ma100arr.length - 2];

  // Volume
  const volAvg20arr = SMA.calculate({ period: 20, values: volumes });
  const volAvg20    = volAvg20arr[volAvg20arr.length - 1];
  const volumeRatio = currentVolume / volAvg20;

  // Momentum
  const rsiArr = RSI.calculate({ period: 14, values: closes });
  const rsi    = rsiArr[rsiArr.length - 1];

  // Volatility
  const atrArr = ATR.calculate({ period: 14, high: highs, low: lows, close: closes });
  const atr    = atrArr[atrArr.length - 1];
  const atrPct = (atr / currentPrice) * 100;

  if (!ma100 || !rsi || !atr || !volAvg20) return null;

  // ── 1. TREND (+35 max) ────────────────────────────────────────────────────
  let trendScore = 0;
  const reasons  = [];

  if (currentPrice > ma100) { trendScore += 20; reasons.push('Price above MA100 (+20)'); }
  if (ma50 > ma100)          { trendScore += 15; reasons.push('MA50 above MA100 (+15)'); }

  // ── 2. MOMENTUM RSI (+15 / -10) ───────────────────────────────────────────
  if (rsi >= 45 && rsi <= 60)      { trendScore += 15; reasons.push(`RSI optimal ${rsi.toFixed(1)} (+15)`); }
  else if (rsi > 60 && rsi <= 70)  { trendScore += 10; reasons.push(`RSI strong ${rsi.toFixed(1)} (+10)`); }
  else if (rsi > 70)               { trendScore -= 10; reasons.push(`RSI overbought ${rsi.toFixed(1)} (-10)`); }
  else if (rsi < 40)               { trendScore -= 10; reasons.push(`RSI weak ${rsi.toFixed(1)} (-10)`); }

  // ── 3. VOLUME (+15 max) ───────────────────────────────────────────────────
  if (volumeRatio > 2.0)       { trendScore += 15; reasons.push(`Vol ratio ${volumeRatio.toFixed(2)}x (+15)`); }
  else if (volumeRatio > 1.5)  { trendScore += 10; reasons.push(`Vol ratio ${volumeRatio.toFixed(2)}x (+10)`); }
  else if (volumeRatio >= 1.0) { trendScore += 5;  reasons.push(`Vol ratio ${volumeRatio.toFixed(2)}x (+5)`); }

  // ── 4. STRUCTURE (+20 / +10) ──────────────────────────────────────────────
  let structureType = 'NONE';

  // BREAKOUT: yesterday below MA100, today above MA100
  if (yesterdayClose < prevMA100 && currentPrice > ma100) {
    structureType = 'BREAKOUT';
    trendScore += 10;
    reasons.push('MA100 Breakout detected (+10)');
  }
  // RETEST: held above MA100 for 3+ candles, recent low near MA100, bouncing
  else if (ma100arr.length >= 5) {
    const held = [n-5, n-4, n-3].every(i =>
      closes[i] > ma100arr[ma100arr.length - (n - i)]
    );
    const recentLow = Math.min(lows[n-1], lows[n-2], lows[n-3]);
    const nearMA    = recentLow >= ma100 * 0.98 && recentLow <= ma100 * 1.03;
    const bouncing  = currentPrice > yesterdayClose && currentPrice > ma100;

    if (held && nearMA && bouncing) {
      structureType = 'RETEST';
      trendScore   += 20;
      reasons.push('Successful MA100 retest + bounce (+20)');
    }
  }

  // ── 5. VOLATILITY ATR (+10 / -10) ────────────────────────────────────────
  if (atrPct >= 1 && atrPct <= 5) { trendScore += 10; reasons.push(`ATR optimal ${atrPct.toFixed(1)}% (+10)`); }
  else if (atrPct < 1)            { trendScore -= 10; reasons.push(`ATR too low ${atrPct.toFixed(1)}% (-10)`); }
  else if (atrPct > 5)            { trendScore -= 10; reasons.push(`ATR too high ${atrPct.toFixed(1)}% (-10)`); }

  // ── 6. BTC MARKET FILTER (+15 / -10) ─────────────────────────────────────
  if (btcAboveMA100) { trendScore += 15; reasons.push('BTC above MA100 – market bullish (+15)'); }
  else               { trendScore -= 10; reasons.push('BTC below MA100 – market caution (-10)'); }

  // Clamp to 0–100
  trendScore = Math.min(100, Math.max(0, trendScore));

  // ── SIGNAL RULES ──────────────────────────────────────────────────────────
  let signal;
  if (trendScore >= 85 && structureType === 'RETEST' && volumeRatio > 1.5) {
    signal = 'STRONG_BUY';
    reasons.push('STRONG BUY: Retest + high volume + score ≥ 85');
  } else if (trendScore >= 75 && currentPrice > ma100) {
    signal = 'BUY';
  } else if (trendScore >= 55) {
    signal = 'WATCH';
  } else if (trendScore >= 40) {
    signal = 'RISK';
  } else {
    signal = 'SELL';
  }

  // Override: always SELL if price below MA100
  if (currentPrice < ma100) signal = 'SELL';

  // Risk levels
  const stopLoss       = currentPrice - atr * 2;
  const target1        = currentPrice + atr * 2;
  const target2        = currentPrice + atr * 4;
  const riskReward     = ((target1 - currentPrice) / (currentPrice - stopLoss)).toFixed(2);

  return {
    symbol: '', // filled by caller
    signal,
    trendScore,
    structureType,
    price:          currentPrice,
    ma20,
    ma50,
    ma100,
    rsi14:          parseFloat(rsi.toFixed(2)),
    atr14:          parseFloat(atr.toFixed(4)),
    volumeRatio:    parseFloat(volumeRatio.toFixed(2)),
    stopLoss,
    target1,
    target2,
    riskRewardRatio: riskReward,
    ma100Dist:       parseFloat(((currentPrice - ma100) / ma100 * 100).toFixed(2)),
    reasons
  };
}

// ─── MA100 Breakout (for "MA100 Breakout" tab) ───────────────────────────────

async function processMa100(symbol) {
  const klines = await fetchKlines(symbol, 120);
  if (!klines || klines.length < 101) return null;
  const closes = klines.map(k => k.close);
  const ma100  = SMA.calculate({ period: 100, values: closes });
  const curr   = closes[closes.length - 1];
  const prev   = closes[closes.length - 2];
  const currMA = ma100[ma100.length - 1];
  const prevMA = ma100[ma100.length - 2];

  let signal = null;
  if (prev < prevMA && curr > currMA) signal = 'UP';
  else if (prev > prevMA && curr < currMA) signal = 'DOWN';
  if (!signal) return null;

  return {
    symbol,
    signal,
    price:             curr,
    ma100:             currMA,
    differencePercent: ((curr - currMA) / currMA) * 100,
    volume:            klines[klines.length - 1].volume
  };
}

// ─── Main Handler ─────────────────────────────────────────────────────────────

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const type = req.query.type || 'daily';

  try {
    const pairs = await getAllUsdtPairs();

    // ── MA100 Breakout Tab ───────────────────────────────────────────────────
    if (type === 'ma100') {
      const results = await pool(pairs, 20, p => processMa100(p));
      return res.status(200).json({ data: results.filter(Boolean) });
    }

    // ── Daily Decision Tab ───────────────────────────────────────────────────
    const { btcAboveMA100 } = await getBtcContext();

    const resultsRaw = await pool(pairs, 20, async symbol => {
      const klines = await fetchKlines(symbol, 150);
      if (!klines || klines.length < 101) return null;
      const result = score(klines, btcAboveMA100);
      if (!result) return null;
      result.symbol = symbol;
      return result;
    });

    const data = resultsRaw.filter(Boolean).sort((a, b) => b.trendScore - a.trendScore);

    const summary = {
      total:    data.length,
      strongBuy: data.filter(d => d.signal === 'STRONG_BUY').length,
      buy:      data.filter(d => d.signal === 'BUY').length,
      watch:    data.filter(d => d.signal === 'WATCH').length,
      risk:     data.filter(d => d.signal === 'RISK').length,
      sell:     data.filter(d => d.signal === 'SELL').length,
      avgScore: data.length
        ? parseFloat((data.reduce((s, d) => s + d.trendScore, 0) / data.length).toFixed(1))
        : 0
    };

    return res.status(200).json({ summary, data });

  } catch (err) {
    console.error('Handler error:', err);
    return res.status(200).json({ data: [], error: err.message });
  }
};
