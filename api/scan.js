const axios = require('axios');
const { SMA, RSI, ATR } = require('technicalindicators');

const BINANCE_API_URL = 'https://api4.binance.com/api/v3';
const HEADERS = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36' };

async function fetchWithRetry(url, params = {}, retries = 1) {
  for (let i = 0; i <= retries; i++) {
    try {
      return await axios.get(url, { params, headers: HEADERS, timeout: 5000 });
    } catch (err) {
      if (i === retries) throw err;
    }
  }
}

async function getTopPairs(limit = 50) {
  try {
    const res = await fetchWithRetry(`${BINANCE_API_URL}/ticker/24hr`);
    return res.data
      .filter(t => t.symbol.endsWith('USDT'))
      .sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
      .slice(0, limit)
      .map(t => t.symbol);
  } catch (err) {
    return ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'ADAUSDT', 'AVAXUSDT', 'DOGEUSDT', 'DOTUSDT', 'LINKUSDT'];
  }
}

async function fetchKlines(symbol) {
  try {
    const res = await fetchWithRetry(`${BINANCE_API_URL}/klines`, { symbol, interval: '1d', limit: 150 });
    return res.data.map(k => ({
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: parseFloat(k[5])
    }));
  } catch (err) {
    return null;
  }
}

async function processSymbol(symbol, btcPrice, btcMA100) {
  const klines = await fetchKlines(symbol);
  if (!klines || klines.length < 101) return null;

  const closes = klines.map(k => k.close);
  const currentPrice = closes[closes.length - 1];
  
  const ma100Values = SMA.calculate({ period: 100, values: closes });
  const ma100 = ma100Values[ma100Values.length - 1];
  const rsi = RSI.calculate({ period: 14, values: closes }).pop();
  const atr = ATR.calculate({ period: 14, high: klines.map(k => k.high), low: klines.map(k => k.low), close: closes }).pop();
  
  let trendScore = 0;
  if (currentPrice > ma100) trendScore += 40;
  if (rsi > 45 && rsi < 65) trendScore += 30;
  if (btcPrice > btcMA100) trendScore += 30;

  let signal = "WATCH";
  if (trendScore >= 70) signal = "BUY";
  if (currentPrice < ma100) signal = "SELL";

  return {
    symbol,
    price: currentPrice,
    ma100,
    rsi14: rsi,
    trendScore,
    signal,
    stopLoss: currentPrice - (atr * 2),
    target1: currentPrice + (atr * 2),
    reasons: [`Price vs MA100: ${currentPrice > ma100 ? 'Above' : 'Below'}`, `RSI: ${rsi.toFixed(1)}`]
  };
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  try {
    const btcKlines = await fetchKlines('BTCUSDT');
    const btcCloses = btcKlines.map(k => k.close);
    const btcMA100 = SMA.calculate({ period: 100, values: btcCloses }).pop();
    const btcPrice = btcCloses[btcCloses.length - 1];

    const symbols = await getTopPairs(50);
    const results = await Promise.all(symbols.map(s => processSymbol(s, btcPrice, btcMA100)));
    const data = results.filter(Boolean).sort((a, b) => b.trendScore - a.trendScore);

    res.status(200).json({
      summary: { total: data.length, buy: data.filter(d => d.signal === 'BUY').length },
      data
    });
  } catch (error) {
    res.status(200).json({ data: [], error: error.message });
  }
};
