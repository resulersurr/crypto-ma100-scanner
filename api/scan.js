const axios = require('axios');
const { RSI, SMA, ATR } = require('technicalindicators');

const BINANCE_API_URL = 'https://api4.binance.com/api/v3';

// Simple in-memory cache for Vercel warm starts
let cache = {
  daily: { data: null, previousData: null, changes: [], timestamp: null },
  ma100: { data: null, timestamp: null }
};

async function getTopUsdtPairs(limit = 60) {
  try {
    const response = await axios.get(`${BINANCE_API_URL}/ticker/24hr`);
    return response.data
      .filter(t => t.symbol.endsWith('USDT') && parseFloat(t.quoteVolume) > 1000000)
      .sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
      .slice(0, limit)
      .map(t => t.symbol);
  } catch (err) {
    return ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'ADAUSDT', 'AVAXUSDT', 'DOGEUSDT', 'DOTUSDT', 'LINKUSDT'];
  }
}

async function fetchKlines(symbol, limit = 200) {
  try {
    const res = await axios.get(`${BINANCE_API_URL}/klines`, {
      params: { symbol, interval: '1d', limit }
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

async function processDaily(symbol, btcTrendPositive) {
  const klines = await fetchKlines(symbol, 200);
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
  if (yesterdayClose < prevMA100 && currentPrice > ma100) {
    structureType = "BREAKOUT";
  } else if (ma100Values.length >= 4) {
    const heldAbove = closes[n-4] > ma100Values[ma100Values.length-4] && closes[n-3] > ma100Values[ma100Values.length-3] && closes[n-2] > ma100Values[ma100Values.length-2];
    const recentLow = Math.min(lows[n-1], lows[n-2], lows[n-3]);
    const nearMA = recentLow <= ma100 * 1.02 && recentLow >= ma100 * 0.98;
    const bounce = currentPrice > yesterdayClose;
    if (heldAbove && nearMA && bounce) structureType = "RETEST";
  }

  let trendScore = 0;
  let reasons = [];

  if (currentPrice > ma100) { trendScore += 20; reasons.push("Price > MA100 (+20)"); }
  if (ma50 > ma100) { trendScore += 15; reasons.push("MA50 > MA100 (+15)"); }
  if (rsi >= 45 && rsi <= 60) { trendScore += 15; reasons.push("RSI optimal (+15)"); }
  else if (rsi > 60 && rsi <= 70) { trendScore += 10; reasons.push("RSI strong (+10)"); }
  
  if (volumeRatio > 1.5) { trendScore += 10; reasons.push("High volume (+10)"); }
  if (structureType !== "NONE") { trendScore += structureType === "RETEST" ? 20 : 10; reasons.push(`Structure: ${structureType}`); }
  if (atrPct >= 1 && atrPct <= 5) { trendScore += 10; reasons.push("ATR optimal (+10)"); }
  if (btcTrendPositive) { trendScore += 15; reasons.push("BTC trend pos (+15)"); }

  let signal = "SELL";
  if (trendScore >= 85 && structureType === "RETEST" && volumeRatio > 1.5) signal = "STRONG_BUY";
  else if (trendScore >= 75 && currentPrice > ma100) signal = "BUY";
  else if (trendScore >= 55) signal = "WATCH";
  else if (trendScore >= 40) signal = "RISK";

  const stopLoss = currentPrice - (atr * 2);
  const target1 = currentPrice + (atr * 2);
  const target2 = currentPrice + (atr * 4);

  return {
    symbol, signal, trendScore, structureType, price: currentPrice, ma20, ma50, ma100, rsi14: rsi, atr14: atr, 
    volumeRatio: volumeRatio.toFixed(2), stopLoss, target1, target2, reasons, 
    ma100Dist: ((currentPrice - ma100) / ma100) * 100,
    riskRewardRatio: ((target1 - currentPrice) / (currentPrice - stopLoss)).toFixed(2)
  };
}

async function processMa100(symbol) {
  const klines = await fetchKlines(symbol, 120);
  if (!klines || klines.length < 101) return null;
  const closes = klines.map(k => k.close);
  const ma100 = SMA.calculate({ period: 100, values: closes });
  const curr = closes[closes.length-1];
  const prev = closes[closes.length-2];
  const currMA = ma100[ma100.length-1];
  const prevMA = ma100[ma100.length-2];
  
  let signal = null;
  if (prev < prevMA && curr > currMA) signal = 'UP';
  else if (prev > prevMA && curr < currMA) signal = 'DOWN';
  
  if (!signal) return null;
  return { symbol, signal, price: curr, ma100: currMA, differencePercent: ((curr - currMA) / currMA) * 100 };
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const type = req.query.type || 'daily';

  try {
    const pairs = await getTopUsdtPairs(60);
    
    if (type === 'ma100') {
      const results = await Promise.all(pairs.map(p => processMa100(p)));
      return res.status(200).json({ data: results.filter(Boolean) });
    }

    // Daily logic
    const btcKlines = await fetchKlines('BTCUSDT', 150);
    const btcMA100 = SMA.calculate({ period: 100, values: btcKlines.map(k => k.close) });
    const btcTrend = btcKlines[btcKlines.length-1].close > btcMA100[btcMA100.length-1];
    
    const results = await Promise.all(pairs.map(p => processDaily(p, btcTrend)));
    const data = results.filter(Boolean).sort((a, b) => b.trendScore - a.trendScore);
    
    res.status(200).json({
      summary: {
        total: data.length,
        buy: data.filter(d => d.signal === 'BUY').length,
        strongBuy: data.filter(d => d.signal === 'STRONG_BUY').length,
        watch: data.filter(d => d.signal === 'WATCH').length,
        risk: data.filter(d => d.signal === 'RISK').length,
        sell: data.filter(d => d.signal === 'SELL').length
      },
      data
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
