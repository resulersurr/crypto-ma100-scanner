const axios = require('axios');
const { SMA } = require('technicalindicators');

const BINANCE_API_URL = 'https://api4.binance.com/api/v3';

async function getTopUsdtPairs(limit = 60) {
  const response = await axios.get(`${BINANCE_API_URL}/ticker/24hr`);
  return response.data
    .filter(t => t.symbol.endsWith('USDT') && parseFloat(t.quoteVolume) > 1000000)
    .sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
    .slice(0, limit)
    .map(t => t.symbol);
}

async function fetchKlines(symbol, limit = 120) {
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
    const pairs = await getTopUsdtPairs(60);
    const resultsRaw = await Promise.all(pairs.map(symbol => fetchMa100Data(symbol)));
    const data = resultsRaw.filter(Boolean).sort((a, b) => Math.abs(b.differencePercent) - Math.abs(a.differencePercent));

    res.status(200).json({ data });
  } catch (error) {
    console.error('Scan Error:', error);
    res.status(500).json({ error: 'Failed to scan MA100 markets', details: error.message });
  }
};
