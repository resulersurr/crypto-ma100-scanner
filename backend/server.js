require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { scanSignals, scanDailyDecisions } = require('./services/binanceService');

const app = express();
const PORT = process.env.PORT || 5001;

app.use(cors());
app.use(express.json());

// Cache storage
const cache = {
  ma100: { data: null, timestamp: null, isScanning: false },
  daily: { data: null, timestamp: null, isScanning: false, previousData: null, changes: [], lastChangeTimestamp: null }
};

const CACHE_DURATION = 60 * 1000; // 60 seconds

// Function to compare and detect changes
function compareDailyScans(previousData, currentData) {
  if (!previousData || !currentData) return [];

  const changes = [];
  const prevMap = new Map();
  previousData.forEach(coin => prevMap.set(coin.symbol, coin));

  const timestamp = new Date().toISOString();

  currentData.forEach(current => {
    const prev = prevMap.get(current.symbol);
    if (!prev) return;

    let changeType = null;
    let message = '';

    // Check NEW_BUY
    if (prev.signal !== 'BUY' && current.signal === 'BUY') {
      changeType = 'NEW_BUY';
      message = `${current.symbol} became BUY signal`;
    } 
    // Check LOST_BUY
    else if (prev.signal === 'BUY' && current.signal !== 'BUY') {
      changeType = 'LOST_BUY';
      message = `${current.symbol} lost BUY signal (Now ${current.signal})`;
    }
    // Check SIGNAL_CHANGED
    else if (prev.signal !== current.signal) {
      changeType = 'SIGNAL_CHANGED';
      message = `${current.symbol} signal changed from ${prev.signal} to ${current.signal}`;
    }
    // Check SCORE_UP
    else if (current.trendScore - prev.trendScore >= 5) {
      changeType = 'SCORE_UP';
      message = `${current.symbol} trend score increased by ${current.trendScore - prev.trendScore}`;
    }
    // Check SCORE_DOWN
    else if (prev.trendScore - current.trendScore >= 5) {
      changeType = 'SCORE_DOWN';
      message = `${current.symbol} trend score decreased by ${prev.trendScore - current.trendScore}`;
    }
    // Check NEW_STRUCTURE (BREAKOUT or RETEST)
    else if (prev.structureType === 'NONE' && current.structureType !== 'NONE') {
      changeType = 'NEW_BREAKOUT'; // Keeping the constant NEW_BREAKOUT for frontend compatibility
      message = `${current.symbol} detected new ${current.structureType} structure`;
    }

    if (changeType) {
      changes.push({
        symbol: current.symbol,
        changeType,
        previousSignal: prev.signal,
        currentSignal: current.signal,
        previousScore: prev.trendScore,
        currentScore: current.trendScore,
        scoreDiff: current.trendScore - prev.trendScore,
        previousPrice: prev.price,
        currentPrice: current.price,
        priceDiffPercent: (((current.price - prev.price) / prev.price) * 100).toFixed(2),
        message,
        timestamp
      });
    }
  });

  return changes;
}

// Generate summary
function generateSummary(previousData, currentData) {
  const summary = {
    buyCount: 0,
    watchCount: 0,
    riskCount: 0,
    sellCount: 0,
    previousBuyCount: 0,
    buyCountDiff: 0,
    newBuyCount: 0,
    lostBuyCount: 0,
    signalChangeCount: 0
  };

  if (currentData) {
    summary.buyCount = currentData.filter(d => d.signal === 'BUY').length;
    summary.watchCount = currentData.filter(d => d.signal === 'WATCH').length;
    summary.riskCount = currentData.filter(d => d.signal === 'RISK').length;
    summary.sellCount = currentData.filter(d => d.signal === 'SELL').length;
  }

  if (previousData) {
    summary.previousBuyCount = previousData.filter(d => d.signal === 'BUY').length;
    summary.buyCountDiff = summary.buyCount - summary.previousBuyCount;
  }

  return summary;
}

// Helper to handle scanning with caching
async function handleScan(type, scanFn, res, force = false) {
  const now = Date.now();
  const state = cache[type];

  // For MA100
  if (type === 'ma100') {
    if (!force && state.data && state.timestamp && (now - state.timestamp < CACHE_DURATION)) {
      return res.json({ data: state.data, timestamp: state.timestamp, cached: true });
    }
    if (state.isScanning && state.data) {
      return res.json({ data: state.data, timestamp: state.timestamp, cached: true, message: 'Scan in progress' });
    }
    if (state.isScanning) {
      return res.status(409).json({ error: 'Scan already in progress' });
    }
    try {
      state.isScanning = true;
      const results = await scanFn();
      state.data = results;
      state.timestamp = Date.now();
      state.isScanning = false;
      return res.json({ data: state.data, timestamp: state.timestamp, cached: false });
    } catch (error) {
      state.isScanning = false;
      return res.status(500).json({ error: `Failed to scan ${type}` });
    }
  }

  // For Daily - specific logic
  if (type === 'daily') {
    const returnDailyResponse = (cached = false, message = null) => {
      const summary = generateSummary(state.previousData, state.data);
      const newBuyCount = state.changes.filter(c => c.changeType === 'NEW_BUY').length;
      const lostBuyCount = state.changes.filter(c => c.changeType === 'LOST_BUY').length;
      const signalChangeCount = state.changes.filter(c => c.changeType === 'SIGNAL_CHANGED').length;
      
      summary.newBuyCount = newBuyCount;
      summary.lostBuyCount = lostBuyCount;
      summary.signalChangeCount = signalChangeCount;

      const response = {
        summary,
        changes: state.changes,
        data: state.data,
        timestamp: state.timestamp,
        lastChangeTimestamp: state.lastChangeTimestamp,
        cached
      };
      if (message) response.message = message;
      return res.json(response);
    };

    if (!force && state.data && state.timestamp && (now - state.timestamp < CACHE_DURATION)) {
      return returnDailyResponse(true);
    }
    if (state.isScanning && state.data) {
      return returnDailyResponse(true, 'Scan in progress, serving stale cache');
    }
    if (state.isScanning) {
      return res.status(409).json({ error: 'Scan already in progress' });
    }

    try {
      state.isScanning = true;
      const currentResults = await scanFn();
      
      if (state.data) {
        state.previousData = state.data;
        const newChanges = compareDailyScans(state.previousData, currentResults);
        if (newChanges.length > 0) {
          // Prepend new changes, keeping a max limit of 100 recent changes
          state.changes = [...newChanges, ...state.changes].slice(0, 100);
          state.lastChangeTimestamp = new Date().toISOString();
        }
      }

      state.data = currentResults;
      state.timestamp = Date.now();
      state.isScanning = false;

      return returnDailyResponse(false);
    } catch (error) {
      state.isScanning = false;
      console.error(`API Error (${type}):`, error);
      return res.status(500).json({ error: `Failed to scan ${type}`, details: error.message, stack: error.stack });
    }
  }
}

// 1. MA100 Scanner Endpoints
app.get('/api/scan/ma100', (req, res) => handleScan('ma100', scanSignals, res));
app.post('/api/scan/ma100/refresh', (req, res) => handleScan('ma100', scanSignals, res, true));

// Legacy compatibility
app.get('/api/signals', (req, res) => handleScan('ma100', scanSignals, res));
app.post('/api/signals/refresh', (req, res) => handleScan('ma100', scanSignals, res, true));

// 2. Daily Trading Decision Endpoints
app.get('/api/scan/daily', (req, res) => handleScan('daily', scanDailyDecisions, res));
app.post('/api/scan/daily/refresh', (req, res) => handleScan('daily', scanDailyDecisions, res, true));

// 3. Daily Changes Endpoint
app.get('/api/scan/changes', (req, res) => {
  res.json({
    changes: cache.daily.changes,
    lastChangeTimestamp: cache.daily.lastChangeTimestamp
  });
});

if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => {
    console.log(`Scanner Backend running on port ${PORT}`);
  });
}

module.exports = app;
