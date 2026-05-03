const axios = require('axios');
const { RSI, SMA, ATR } = require('technicalindicators');

const BINANCE_API_URL = 'https://api4.binance.com/api/v3';

// Fetch all tradable USDT MTM pairs
async function getUsdtPairs() {
  try {
    const response = await axios.get(`${BINANCE_API_URL}/exchangeInfo`);
    return response.data.symbols
      .filter(s => s.quoteAsset === 'USDT' && s.status === 'TRADING')
      .map(s => s.symbol);
  } catch (error) {
    console.error('Error fetching exchange info:', error.message);
    throw new Error('Failed to fetch trading pairs');
  }
}

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function fetchKlines(symbol, limit = 250) {
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

async function getBtcTrend() {
  const klines = await fetchKlines('BTCUSDT', 150);
  if (!klines || klines.length < 100) return false;
  const closes = klines.map(k => k.close);
  const ma100 = SMA.calculate({ period: 100, values: closes });
  const currentPrice = closes[closes.length - 1];
  return currentPrice > ma100[ma100.length - 1];
}

// Existing MA100 Breakout logic
async function fetchMa100Data(symbol) {
  const klines = await fetchKlines(symbol, 120);
  if (!klines || klines.length < 101) return null;

  const closes = klines.map(k => k.close);
  const currentPrice = closes[closes.length - 1];
  const yesterdayClose = closes[closes.length - 2];

  const ma100Values = SMA.calculate({ period: 100, values: closes });
  const todayMA100 = ma100Values[ma100Values.length - 1];
  const yesterdayMA100 = ma100Values[ma100Values.length - 2];

  let signal = null;
  if (yesterdayClose < yesterdayMA100 && currentPrice > todayMA100) signal = 'UP';
  else if (yesterdayClose > yesterdayMA100 && currentPrice < todayMA100) signal = 'DOWN';

  if (!signal) return null;

  return {
    symbol,
    signal,
    price: currentPrice,
    ma100: todayMA100,
    differencePercent: ((currentPrice - todayMA100) / todayMA100) * 100,
    volume: klines[klines.length - 1].volume
  };
}

// New Daily Decision logic
async function fetchDailyDecisionData(symbol, btcTrendPositive) {
  const klines = await fetchKlines(symbol, 250);
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
  const ma200 = closes.length >= 200 ? SMA.calculate({ period: 200, values: closes }).pop() : null;
  const volAvg20 = SMA.calculate({ period: 20, values: volumes }).pop();
  const rsi = RSI.calculate({ period: 14, values: closes }).pop();
  const atr = ATR.calculate({ period: 14, high: highs, low: lows, close: closes }).pop();

  if (!ma100 || !rsi || !atr || !volAvg20) return null;

  const volumeRatio = currentVolume / volAvg20;
  const atrPct = (atr / currentPrice) * 100;

  // Structure Analysis
  let structureType = "NONE";
  let structureReason = "";
  
  if (yesterdayClose < prevMA100 && currentPrice > ma100) {
    structureType = "BREAKOUT";
    structureReason = "MA100 Breakout detected";
  } else {
    // Retest logic: price above MA100 for previous 3 candles, pullback near MA100, bounce upward
    if (ma100Values.length >= 4) {
      const close3 = closes[n - 4];
      const close2 = closes[n - 3];
      const close1 = closes[n - 2]; // yesterday
      const ma3 = ma100Values[ma100Values.length - 4];
      const ma2 = ma100Values[ma100Values.length - 3];
      const ma1 = ma100Values[ma100Values.length - 2];

      const heldAbove = close3 > ma3 && close2 > ma2 && close1 > ma1;
      const recentLow = Math.min(lows[n - 1], lows[n - 2], lows[n - 3]);
      const nearMA = recentLow <= ma100 * 1.02 && recentLow >= ma100 * 0.98;
      const bounce = currentPrice > yesterdayClose;

      if (heldAbove && nearMA && bounce) {
        structureType = "RETEST";
        structureReason = "Successful MA100 retest and bounce";
      }
    }
  }

  // Scoring System
  let trendScore = 0;
  let reasons = [];

  // 1. Trend Component
  if (currentPrice > ma100) {
    trendScore += 20;
    reasons.push("Price > MA100 (+20)");
  }
  if (ma50 > ma100) {
    trendScore += 15;
    reasons.push("MA50 > MA100 (+15)");
  }

  // 2. Momentum (RSI 14)
  if (rsi >= 45 && rsi <= 60) {
    trendScore += 15;
    reasons.push("RSI optimal zone 45-60 (+15)");
  } else if (rsi > 60 && rsi <= 70) {
    trendScore += 10;
    reasons.push("RSI strong 60-70 (+10)");
  } else if (rsi > 70) {
    trendScore -= 10;
    reasons.push("RSI overbought > 70 (-10)");
  } else if (rsi < 40) {
    trendScore -= 10;
    reasons.push("RSI weak < 40 (-10)");
  }

  // 3. Volume Strength
  if (volumeRatio > 2.0) {
    trendScore += 15;
    reasons.push("Extremely high volume ratio > 2.0 (+15)");
  } else if (volumeRatio > 1.5) {
    trendScore += 10;
    reasons.push("Strong volume ratio 1.5-2.0 (+10)");
  } else if (volumeRatio >= 1.0) {
    trendScore += 5;
    reasons.push("Above average volume 1.0-1.5 (+5)");
  }

  // 4. Structure
  if (structureType === "RETEST") {
    trendScore += 20;
    reasons.push(`Structure: ${structureReason} (+20)`);
  } else if (structureType === "BREAKOUT") {
    trendScore += 10;
    reasons.push(`Structure: ${structureReason} (+10)`);
  }

  // 5. Volatility (ATR 14)
  if (atrPct >= 1 && atrPct <= 5) {
    trendScore += 10;
    reasons.push("ATR optimal 1%-5% (+10)");
  } else if (atrPct < 1) {
    trendScore -= 10;
    reasons.push("ATR too low < 1% (-10)");
  } else if (atrPct > 5) {
    trendScore -= 10;
    reasons.push("ATR too high > 5% (-10)");
  }

  // 6. Market Filter (BTC)
  if (btcTrendPositive) {
    trendScore += 15;
    reasons.push("BTC trend supports long bias (+15)");
  } else {
    trendScore -= 10;
    reasons.push("BTC below MA100 (-10)");
  }

  // Normalize score bounds (optional, but requested 0-100+)
  if (trendScore < 0) trendScore = 0;

  // Signal Rules
  let signal = "SELL";
  if (trendScore >= 85 && structureType === "RETEST" && volumeRatio > 1.5) {
    signal = "STRONG_BUY";
  } else if (trendScore >= 75 && currentPrice > ma100) {
    signal = "BUY";
  } else if (trendScore >= 55 && trendScore < 75) {
    signal = "WATCH";
  } else if (trendScore >= 40 && trendScore < 55) {
    signal = "RISK";
  } else if (trendScore < 40 || currentPrice < ma100) {
    signal = "SELL";
  }

  const stopLoss = currentPrice - (atr * 2);
  const target1 = currentPrice + (atr * 2);
  const target2 = currentPrice + (atr * 4);
  const riskRewardRatio = ((target1 - currentPrice) / (currentPrice - stopLoss)).toFixed(2);

  return {
    symbol,
    signal,
    trendScore,
    structureType,
    price: currentPrice,
    ma20,
    ma50,
    ma100,
    ma200,
    rsi14: rsi,
    atr14: atr,
    volume: currentVolume,
    volumeAvg20: volAvg20,
    volumeRatio: volumeRatio.toFixed(2),
    volumeStrength: volumeRatio.toFixed(2), // Keep for backward compatibility if needed by frontend
    stopLoss,
    target1,
    target2,
    riskRewardRatio,
    reasons,
    ma100Dist: ((currentPrice - ma100) / ma100) * 100
  };
}

async function scanSignals() {
  const pairs = await getUsdtPairs();
  const results = [];
  const BATCH_SIZE = 40;
  for (let i = 0; i < pairs.length; i += BATCH_SIZE) {
    const batch = pairs.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(batch.map(symbol => fetchMa100Data(symbol)));
    results.push(...batchResults.filter(Boolean));
    await delay(100);
  }
  return results.sort((a, b) => Math.abs(b.differencePercent) - Math.abs(a.differencePercent));
}

async function scanDailyDecisions() {
  const pairs = await getUsdtPairs();
  const btcTrendPositive = await getBtcTrend();
  const results = [];
  const BATCH_SIZE = 30;
  
  console.log(`Scanning ${pairs.length} pairs for Daily Decisions...`);
  
  for (let i = 0; i < pairs.length; i += BATCH_SIZE) {
    const batch = pairs.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(batch.map(symbol => fetchDailyDecisionData(symbol, btcTrendPositive)));
    results.push(...batchResults.filter(Boolean));
    await delay(200);
  }
  
  return results.sort((a, b) => b.trendScore - a.trendScore);
}

module.exports = {
  scanSignals,
  scanDailyDecisions
};
