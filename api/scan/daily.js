const axios = require('axios');
const { RSI, SMA, ATR } = require('technicalindicators');

const BINANCE_API_URL = 'https://api4.binance.com/api/v3';

// Vercel Serverless Functions can maintain global state between warm executions
let cache = {
  data: null,
  previousData: null,
  changes: [],
  timestamp: null
};

async function getTopUsdtPairs(limit = 60) {
  const response = await axios.get(`${BINANCE_API_URL}/ticker/24hr`);
  return response.data
    .filter(t => t.symbol.endsWith('USDT') && parseFloat(t.quoteVolume) > 1000000)
    .sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
    .slice(0, limit)
    .map(t => t.symbol);
}

async function fetchKlines(symbol) {
  try {
    const res = await axios.get(`${BINANCE_API_URL}/klines`, {
      params: { symbol, interval: '1d', limit: 200 }
    });
    return res.data.map(k => ({
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: parseFloat(k[5])
    }));
  } catch (err) {
    return null;
  }
}

async function getBtcTrend() {
  const klines = await fetchKlines('BTCUSDT');
  if (!klines || klines.length < 100) return false;
  const closes = klines.map(k => k.close);
  const ma100 = SMA.calculate({ period: 100, values: closes });
  const currentPrice = closes[closes.length - 1];
  return currentPrice > ma100[ma100.length - 1];
}

async function processCoin(symbol, btcTrendPositive) {
  const klines = await fetchKlines(symbol);
  if (!klines || klines.length < 101) return null;

  const closes = klines.map(k => k.close);
  const highs = klines.map(k => k.high);
  const lows = klines.map(k => k.low);
  const volumes = klines.map(k => k.volume);

  const n = closes.length;
  const currentPrice = closes[n - 1];
  const yesterdayClose = closes[n - 2];
  const currentVolume = volumes[n - 1];

  const ma20 = SMA.calculate({ period: 20, values: closes }).pop();
  const ma50 = SMA.calculate({ period: 50, values: closes }).pop();
  const ma100Values = SMA.calculate({ period: 100, values: closes });
  const ma100 = ma100Values[ma100Values.length - 1];
  const prevMA100 = ma100Values[ma100Values.length - 2];
  const volAvg20 = SMA.calculate({ period: 20, values: volumes }).pop();
  const rsi = RSI.calculate({ period: 14, values: closes }).pop();
  const atr = ATR.calculate({ period: 14, high: highs, low: lows, close: closes }).pop();

  if (!ma100 || !rsi || !atr || !volAvg20) return null;

  const volumeRatio = currentVolume / volAvg20;
  const atrPct = (atr / currentPrice) * 100;

  let structureType = "NONE";
  let structureReason = "";
  
  if (yesterdayClose < prevMA100 && currentPrice > ma100) {
    structureType = "BREAKOUT";
    structureReason = "MA100 Breakout detected";
  } else if (ma100Values.length >= 4) {
    const heldAbove = closes[n-4] > ma100Values[ma100Values.length-4] && closes[n-3] > ma100Values[ma100Values.length-3] && closes[n-2] > ma100Values[ma100Values.length-2];
    const recentLow = Math.min(lows[n-1], lows[n-2], lows[n-3]);
    const nearMA = recentLow <= ma100 * 1.02 && recentLow >= ma100 * 0.98;
    const bounce = currentPrice > yesterdayClose;
    if (heldAbove && nearMA && bounce) {
      structureType = "RETEST";
      structureReason = "Successful MA100 retest and bounce";
    }
  }

  let trendScore = 0;
  let reasons = [];

  if (currentPrice > ma100) { trendScore += 20; reasons.push("Price > MA100 (+20)"); }
  if (ma50 > ma100) { trendScore += 15; reasons.push("MA50 > MA100 (+15)"); }
  
  if (rsi >= 45 && rsi <= 60) { trendScore += 15; reasons.push("RSI optimal 45-60 (+15)"); }
  else if (rsi > 60 && rsi <= 70) { trendScore += 10; reasons.push("RSI strong 60-70 (+10)"); }
  else if (rsi > 70) { trendScore -= 10; reasons.push("RSI overbought > 70 (-10)"); }
  else if (rsi < 40) { trendScore -= 10; reasons.push("RSI weak < 40 (-10)"); }

  if (volumeRatio > 2.0) { trendScore += 15; reasons.push("Extremely high volume > 2.0 (+15)"); }
  else if (volumeRatio > 1.5) { trendScore += 10; reasons.push("Strong volume 1.5-2.0 (+10)"); }
  else if (volumeRatio >= 1.0) { trendScore += 5; reasons.push("Above avg volume 1.0-1.5 (+5)"); }

  if (structureType === "RETEST") { trendScore += 20; reasons.push(`Structure: ${structureReason} (+20)`); }
  else if (structureType === "BREAKOUT") { trendScore += 10; reasons.push(`Structure: ${structureReason} (+10)`); }

  if (atrPct >= 1 && atrPct <= 5) { trendScore += 10; reasons.push("ATR optimal 1%-5% (+10)"); }
  else if (atrPct < 1) { trendScore -= 10; reasons.push("ATR too low < 1% (-10)"); }
  else if (atrPct > 5) { trendScore -= 10; reasons.push("ATR too high > 5% (-10)"); }

  if (btcTrendPositive) { trendScore += 15; reasons.push("BTC trend positive (+15)"); }
  else { trendScore -= 10; reasons.push("BTC below MA100 (-10)"); }

  if (trendScore < 0) trendScore = 0;

  let signal = "SELL";
  if (trendScore >= 85 && structureType === "RETEST" && volumeRatio > 1.5) signal = "STRONG_BUY";
  else if (trendScore >= 75 && currentPrice > ma100) signal = "BUY";
  else if (trendScore >= 55 && trendScore < 75) signal = "WATCH";
  else if (trendScore >= 40 && trendScore < 55) signal = "RISK";
  else if (trendScore < 40 || currentPrice < ma100) signal = "SELL";

  const stopLoss = currentPrice - (atr * 2);
  const target1 = currentPrice + (atr * 2);
  const target2 = currentPrice + (atr * 4);
  const riskRewardRatio = ((target1 - currentPrice) / (currentPrice - stopLoss)).toFixed(2);

  return {
    symbol, signal, trendScore, structureType,
    price: currentPrice, ma20, ma50, ma100,
    rsi14: rsi, atr14: atr, volumeRatio: volumeRatio.toFixed(2),
    stopLoss, target1, target2, riskRewardRatio,
    reasons, ma100Dist: ((currentPrice - ma100) / ma100) * 100
  };
}

function compareScans(prev, curr) {
  const changes = [];
  curr.forEach(current => {
    const previous = prev.find(p => p.symbol === current.symbol);
    if (!previous) return;
    
    if (previous.signal !== 'BUY' && previous.signal !== 'STRONG_BUY' && (current.signal === 'BUY' || current.signal === 'STRONG_BUY')) {
      changes.push({ symbol: current.symbol, changeType: 'NEW_BUY', message: `${current.symbol} generated a NEW BUY signal (Score: ${current.trendScore})` });
    } else if ((previous.signal === 'BUY' || previous.signal === 'STRONG_BUY') && current.signal !== 'BUY' && current.signal !== 'STRONG_BUY') {
      changes.push({ symbol: current.symbol, changeType: 'LOST_BUY', message: `${current.symbol} lost its BUY signal` });
    } else if (previous.signal !== current.signal) {
      changes.push({ symbol: current.symbol, changeType: 'SIGNAL_CHANGED', message: `${current.symbol} signal changed from ${previous.signal} to ${current.signal}` });
    }
  });
  return changes;
}

module.exports = async function handler(req, res) {
  // CORS setup
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  try {
    const pairs = await getTopUsdtPairs(60); // Limit to top 60 to ensure we finish in < 10s
    const btcTrendPositive = await getBtcTrend();
    
    // Concurrent execution for speed
    const resultsRaw = await Promise.all(pairs.map(p => processCoin(p, btcTrendPositive)));
    const data = resultsRaw.filter(Boolean).sort((a, b) => b.trendScore - a.trendScore);

    if (cache.data) {
      cache.previousData = cache.data;
      const newChanges = compareScans(cache.previousData, data);
      cache.changes = [...newChanges, ...cache.changes].slice(0, 50);
    }

    cache.data = data;
    cache.timestamp = Date.now();

    const summary = {
      total: data.length,
      buy: data.filter(d => d.signal === 'BUY').length,
      strongBuy: data.filter(d => d.signal === 'STRONG_BUY').length,
      watch: data.filter(d => d.signal === 'WATCH').length,
      risk: data.filter(d => d.signal === 'RISK').length,
      sell: data.filter(d => d.signal === 'SELL').length
    };

    res.status(200).json({
      summary,
      changes: cache.changes,
      data
    });
  } catch (error) {
    console.error('Scan Error:', error);
    res.status(500).json({ error: 'Failed to scan markets', details: error.message });
  }
}
