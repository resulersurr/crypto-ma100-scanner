import React, { useState, useEffect, useCallback, useMemo } from 'react';
import axios from 'axios';
import { 
  RefreshCw, TrendingUp, TrendingDown, Clock, Activity, Search, 
  AlertCircle, ShieldAlert, Info, Target, ArrowUpRight, Filter, ChevronRight,
  ArrowRight, Bell, BellRing
} from 'lucide-react';
import cx from 'classnames';
import TradingViewChart from './TradingViewChart';

const BASE_URL = import.meta.env.VITE_API_URL || '/api/scan';
const AUTO_REFRESH_SECONDS = 60;

export default function ScannerDashboard() {
  const [activeTab, setActiveTab] = useState('daily'); // 'daily' or 'ma100'
  const [data, setData] = useState([]);
  const [summary, setSummary] = useState(null);
  const [changes, setChanges] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [lastUpdated, setLastUpdated] = useState(null);
  const [lastChangeTimestamp, setLastChangeTimestamp] = useState(null);
  const [countdown, setCountdown] = useState(AUTO_REFRESH_SECONDS);
  const [search, setSearch] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [selectedCoin, setSelectedCoin] = useState(null);

  // Filters
  const [minScore, setMinScore] = useState(0);
  const [signalFilter, setSignalFilter] = useState('ALL');
  
  // Changes Filter
  const [changeFilter, setChangeFilter] = useState('ALL'); // ALL, NEW_BUY, LOST_BUY, SIGNAL_CHANGED, SCORE_DOWN, SCORE_UP

  const fetchSignals = useCallback(async (force = false) => {
    try {
      if (!data.length || force) setRefreshing(true);
      setError('');
      
      const endpoint = `${BASE_URL}/${activeTab}${force ? '/refresh' : ''}`;
      const res = await axios[force ? 'post' : 'get'](endpoint);
      
      if (activeTab === 'daily') {
        setData(res.data.data || []);
        setSummary(res.data.summary || null);
        setChanges(res.data.changes || []);
        if (res.data.lastChangeTimestamp) {
          setLastChangeTimestamp(new Date(res.data.lastChangeTimestamp));
        }
      } else {
        setData(res.data.data || []);
      }

      if (res.data.timestamp) {
        setLastUpdated(new Date(res.data.timestamp));
      }
      setCountdown(AUTO_REFRESH_SECONDS);
    } catch (err) {
      if (err.response?.status === 409) {
         setError('A scan is currently in progress. Please wait a moment.');
      } else {
         setError(`Failed to fetch ${activeTab} data. Make sure backend is running.`);
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [activeTab, data.length]);

  useEffect(() => {
    fetchSignals();
  }, [fetchSignals]);

  useEffect(() => {
    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          fetchSignals();
          return AUTO_REFRESH_SECONDS;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [fetchSignals]);

  const handleRefresh = () => {
    fetchSignals(true);
  };

  const filteredData = useMemo(() => {
    return data.filter(item => {
      const matchesSearch = item.symbol.toLowerCase().includes(search.toLowerCase());
      if (activeTab === 'ma100') return matchesSearch;
      
      const matchesScore = item.trendScore >= minScore;
      const matchesSignal = signalFilter === 'ALL' || item.signal === signalFilter;
      return matchesSearch && matchesScore && matchesSignal;
    });
  }, [data, search, activeTab, minScore, signalFilter]);

  const filteredChanges = useMemo(() => {
    if (changeFilter === 'ALL') return changes;
    return changes.filter(c => c.changeType === changeFilter);
  }, [changes, changeFilter]);

  const stats = useMemo(() => {
    if (activeTab === 'ma100') {
      return {
        total: data.length,
        up: data.filter(d => d.signal === 'UP').length,
        down: data.filter(d => d.signal === 'DOWN').length,
      };
    }
    return {
      buy: summary?.buyCount || 0,
      buyPrev: summary?.previousBuyCount || 0,
      buyDiff: summary?.buyCountDiff || 0,
      watch: summary?.watchCount || 0,
      risk: summary?.riskCount || 0,
      sell: summary?.sellCount || 0,
      newBuy: summary?.newBuyCount || 0,
      lostBuy: summary?.lostBuyCount || 0,
      signalChanged: summary?.signalChangeCount || 0,
      avgScore: data.length ? (data.reduce((acc, d) => acc + d.trendScore, 0) / data.length).toFixed(1) : 0
    };
  }, [data, activeTab, summary]);

  if (loading && !data.length) {
    return (
      <div className="flex flex-col items-center justify-center py-20 px-4">
        <RefreshCw className="w-12 h-12 text-primary animate-spin mb-4" />
        <h2 className="text-xl font-semibold text-slate-200 mb-2">Scanning Markets...</h2>
        <p className="text-slate-400 text-center max-w-md">
          Fetching 250+ days of candle data and calculating technical indicators. This takes a few moments to stay within rate limits.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 max-w-7xl mx-auto pb-12">
      {/* Risk Warning */}
      <div className="bg-amber-900/20 border border-amber-500/30 rounded-xl p-4 flex items-center gap-3">
        <ShieldAlert className="w-5 h-5 text-amber-500 flex-shrink-0" />
        <p className="text-xs md:text-sm text-amber-200/80">
          <span className="font-bold text-amber-500 uppercase mr-2">Risk Warning:</span>
          This dashboard is for analysis only. It does not provide financial advice and does not execute trades.
        </p>
      </div>

      {/* Tabs & Controls */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div className="flex bg-surface p-1 rounded-lg border border-border shadow-sm">
          <button 
            onClick={() => { setActiveTab('daily'); setData([]); setChanges([]); setSummary(null); setLoading(true); }}
            className={cx("px-4 py-2 rounded-md text-sm font-medium transition-all", 
              activeTab === 'daily' ? "bg-primary text-background shadow-lg" : "text-slate-400 hover:text-slate-200")}
          >
            Daily Trade Scanner
          </button>
          <button 
            onClick={() => { setActiveTab('ma100'); setData([]); setLoading(true); }}
            className={cx("px-4 py-2 rounded-md text-sm font-medium transition-all", 
              activeTab === 'ma100' ? "bg-primary text-background shadow-lg" : "text-slate-400 hover:text-slate-200")}
          >
            MA100 Breakout
          </button>
        </div>

        <div className="flex items-center gap-4 bg-surface px-4 py-2 rounded-xl border border-border shadow-sm">
          <div className="flex flex-col">
             <div className="flex items-center gap-2 text-xs text-slate-400">
               <Clock className="w-3 h-3" /> Next Refresh: <span className="text-primary font-mono">{countdown}s</span>
             </div>
             <div className="w-24 h-1 bg-slate-800 rounded-full mt-1 overflow-hidden">
                <div className="h-full bg-primary transition-all duration-1000 ease-linear" style={{ width: `${(countdown/AUTO_REFRESH_SECONDS)*100}%` }} />
             </div>
          </div>
          <button onClick={handleRefresh} disabled={refreshing} className="p-2 hover:bg-slate-800 rounded-lg text-slate-400 transition-colors">
            <RefreshCw className={cx("w-5 h-5", refreshing && "animate-spin")} />
          </button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
        {activeTab === 'daily' ? (
          <>
            <StatCard label="BUY (Now)" value={stats.buy} color="text-success" subText={stats.buyDiff !== 0 ? `${stats.buyDiff > 0 ? '+' : ''}${stats.buyDiff} from prev` : 'No change'} icon={<TrendingUp />} />
            <StatCard label="WATCH" value={stats.watch} color="text-primary" icon={<Activity />} />
            <StatCard label="RISK" value={stats.risk} color="text-amber-500" icon={<AlertCircle />} />
            <StatCard label="SELL" value={stats.sell} color="text-danger" icon={<TrendingDown />} />
            <StatCard label="New BUY" value={stats.newBuy} color="text-success" icon={<ArrowUpRight />} />
            <StatCard label="Lost BUY" value={stats.lostBuy} color="text-danger" icon={<TrendingDown />} />
          </>
        ) : (
          <>
            <div className="col-span-1 md:col-span-1" />
            <StatCard label="Total Signals" value={stats.total} color="text-slate-100" icon={<Activity />} />
            <StatCard label="UP Signals" value={stats.up} color="text-success" icon={<TrendingUp />} />
            <StatCard label="DOWN Signals" value={stats.down} color="text-danger" icon={<TrendingDown />} />
            <div className="col-span-1 md:col-span-2" />
          </>
        )}
      </div>

      {error && (
        <div className="bg-danger/10 border border-danger/20 rounded-xl p-4 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-danger flex-shrink-0 mt-0.5" />
          <p className="text-sm text-danger/80">{error}</p>
        </div>
      )}

      {/* Live Changes Feed */}
      {activeTab === 'daily' && (
        <div className="bg-surface border border-border rounded-xl shadow-sm flex flex-col overflow-hidden">
          <div className="p-4 border-b border-border bg-slate-800/20 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <div className="flex flex-col">
              <h2 className="font-semibold text-lg text-slate-100 flex items-center gap-2">
                <BellRing className="w-5 h-5 text-primary animate-pulse" />
                Live Signal Changes
              </h2>
              {lastChangeTimestamp && (
                <span className="text-xs text-slate-500 mt-1">Last change detected: {lastChangeTimestamp.toLocaleTimeString()}</span>
              )}
            </div>
            
            <div className="flex flex-wrap items-center gap-2">
              <FilterButton label="All" active={changeFilter === 'ALL'} onClick={() => setChangeFilter('ALL')} />
              <FilterButton label="New BUY" active={changeFilter === 'NEW_BUY'} onClick={() => setChangeFilter('NEW_BUY')} color="text-success" />
              <FilterButton label="Lost BUY" active={changeFilter === 'LOST_BUY'} onClick={() => setChangeFilter('LOST_BUY')} color="text-danger" />
              <FilterButton label="Signal Changed" active={changeFilter === 'SIGNAL_CHANGED'} onClick={() => setChangeFilter('SIGNAL_CHANGED')} color="text-amber-500" />
              <FilterButton label="Score Up" active={changeFilter === 'SCORE_UP'} onClick={() => setChangeFilter('SCORE_UP')} color="text-blue-400" />
              <FilterButton label="Score Down" active={changeFilter === 'SCORE_DOWN'} onClick={() => setChangeFilter('SCORE_DOWN')} color="text-orange-400" />
            </div>
          </div>
          
          <div className="p-4 max-h-64 overflow-y-auto space-y-3 bg-slate-900/30">
            {changes.length === 0 ? (
              <p className="text-center text-slate-500 py-4 text-sm">No recent changes detected.</p>
            ) : filteredChanges.length === 0 ? (
              <p className="text-center text-slate-500 py-4 text-sm">No changes match the selected filter.</p>
            ) : (
              filteredChanges.map((change, idx) => (
                <div key={idx} className={cx("p-3 rounded-lg border bg-slate-800/40 text-sm flex flex-col md:flex-row gap-4 items-start md:items-center justify-between transition-colors", getChangeColorClass(change.changeType))}>
                  <div className="flex items-center gap-3 w-full md:w-auto">
                    <div className="font-bold text-slate-100 min-w-[80px]">{change.symbol}</div>
                    <div className="flex items-center gap-2 text-xs font-mono bg-slate-900/50 px-2 py-1 rounded">
                       <span className={getSignalColor(change.previousSignal)}>{change.previousSignal}</span>
                       <ArrowRight className="w-3 h-3 text-slate-500" />
                       <span className={getSignalColor(change.currentSignal)}>{change.currentSignal}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 text-xs w-full md:w-auto justify-between md:justify-end">
                     <div className="flex items-center gap-1 font-mono">
                       <span className="text-slate-500">Score:</span>
                       <span>{change.previousScore}</span>
                       <ArrowRight className="w-3 h-3 text-slate-600" />
                       <span className={change.scoreDiff > 0 ? "text-success" : change.scoreDiff < 0 ? "text-danger" : "text-slate-300"}>{change.currentScore}</span>
                     </div>
                     <div className="flex items-center gap-1 font-mono">
                       <span className="text-slate-500">Price:</span>
                       <span>{change.previousPrice?.toFixed(4)}</span>
                       <ArrowRight className="w-3 h-3 text-slate-600" />
                       <span className="text-slate-300">{change.currentPrice?.toFixed(4)}</span>
                     </div>
                  </div>
                  <div className="text-xs text-slate-400 italic md:w-1/3 text-right">
                    {change.message}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Content Area */}
      <div className="bg-surface border border-border rounded-xl shadow-sm flex flex-col overflow-hidden">
        {/* Toolbar */}
        <div className="p-4 border-b border-border bg-slate-800/20 space-y-4">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <h2 className="font-semibold text-lg text-slate-100 flex items-center gap-2">
              {activeTab === 'daily' ? <Target className="w-5 h-5 text-primary" /> : <Activity className="w-5 h-5 text-primary" />}
              {activeTab === 'daily' ? "Daily Decision List" : "MA100 Breakout Signals"}
            </h2>
            <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
              <div className="relative flex-1 md:w-64">
                 <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                 <input 
                   type="text" placeholder="Search symbol..." value={search} onChange={(e) => setSearch(e.target.value)}
                   className="w-full bg-slate-900 border border-slate-700 text-sm rounded-lg pl-9 pr-4 py-2 focus:ring-1 focus:ring-primary focus:outline-none"
                 />
              </div>
              {activeTab === 'daily' && (
                <>
                  <select 
                    value={signalFilter} onChange={(e) => setSignalFilter(e.target.value)}
                    className="bg-slate-900 border border-slate-700 text-xs rounded-lg px-3 py-2 text-slate-300 focus:outline-none"
                  >
                    <option value="ALL">All Signals</option>
                    <option value="BUY">BUY</option>
                    <option value="WATCH">WATCH</option>
                    <option value="RISK">RISK</option>
                    <option value="SELL">SELL</option>
                  </select>
                  <div className="flex items-center gap-2 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2">
                    <span className="text-[10px] text-slate-500 uppercase font-bold">Score {">"}</span>
                    <input 
                      type="number" value={minScore} onChange={(e) => setMinScore(Number(e.target.value))}
                      className="w-8 bg-transparent text-xs text-primary focus:outline-none"
                    />
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
        
        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-800/50 text-[10px] uppercase tracking-wider text-slate-400 border-b border-border">
                <th className="py-4 px-6">Symbol</th>
                <th className="py-4 px-6 text-center">Signal</th>
                {activeTab === 'daily' && <th className="py-4 px-6 text-center">Score</th>}
                <th className="py-4 px-6 text-right">Price</th>
                {activeTab === 'daily' ? (
                  <>
                    <th className="py-4 px-6 text-center">RSI</th>
                    <th className="py-4 px-6 text-center">Structure</th>
                    <th className="py-4 px-6 text-right">Vol Ratio</th>
                    <th className="py-4 px-6 text-right">R/R</th>
                    <th className="py-4 px-6 text-right">Action</th>
                  </>
                ) : (
                  <>
                    <th className="py-4 px-6 text-right">SMA100</th>
                    <th className="py-4 px-6 text-right">Diff %</th>
                    <th className="py-4 px-6 text-right">Volume</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {filteredData.length === 0 ? (
                <tr><td colSpan="10" className="py-20 text-center text-slate-500">No matching assets found.</td></tr>
              ) : (
                filteredData.map((item) => (
                  <tr 
                    key={item.symbol} 
                    onClick={() => activeTab === 'daily' && setSelectedCoin(item)}
                    className={cx(
                      "group transition-colors", 
                      activeTab === 'daily' ? "hover:bg-slate-800/40 cursor-pointer" : "hover:bg-slate-800/20",
                      item.trendScore >= 80 && activeTab === 'daily' && "bg-success/5"
                    )}
                  >
                    <td className="py-4 px-6">
                      <div className="font-bold text-slate-100 flex items-center gap-1">
                        {item.symbol.replace('USDT', '')}
                        <span className="text-[10px] text-slate-500 font-normal">USDT</span>
                      </div>
                    </td>
                    <td className="py-4 px-6 text-center">
                      <SignalBadge signal={item.signal} />
                    </td>
                    {activeTab === 'daily' && (
                      <td className="py-4 px-6 text-center">
                        <div className={cx(
                          "inline-block px-2 py-1 rounded text-xs font-bold",
                          item.trendScore >= 85 ? "text-green-400 drop-shadow-[0_0_8px_rgba(74,222,128,0.8)]" : item.trendScore >= 75 ? "text-success" : item.trendScore >= 55 ? "text-primary" : "text-danger"
                        )}>
                          {item.trendScore}
                        </div>
                      </td>
                    )}
                    <td className="py-4 px-6 text-right font-mono text-slate-300">
                      {item.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}
                    </td>
                    {activeTab === 'daily' ? (
                      <>
                        <td className="py-4 px-6 text-center text-sm text-slate-400">
                          {item.rsi14?.toFixed(1)}
                        </td>
                        <td className="py-4 px-6 text-center">
                           <span className={cx("text-[10px] font-bold px-2 py-1 rounded uppercase tracking-wider",
                              item.structureType === 'RETEST' ? "bg-purple-500/20 text-purple-400 border border-purple-500/30" : 
                              item.structureType === 'BREAKOUT' ? "bg-blue-500/20 text-blue-400 border border-blue-500/30" : "text-slate-500"
                           )}>
                              {item.structureType}
                           </span>
                        </td>
                        <td className="py-4 px-6 text-right">
                          <span className={cx("text-sm", Number(item.volumeRatio) > 1.5 ? "text-primary font-bold" : "text-slate-500")}>
                            {item.volumeRatio}x
                          </span>
                        </td>
                        <td className="py-4 px-6 text-right text-sm text-slate-300">
                          {item.riskRewardRatio}
                        </td>
                        <td className="py-4 px-6 text-right">
                           <button className="p-1 hover:bg-slate-700 rounded text-slate-500 group-hover:text-primary transition-colors">
                              <ChevronRight className="w-4 h-4" />
                           </button>
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="py-4 px-6 text-right text-sm text-slate-400">{item.ma100.toLocaleString()}</td>
                        <td className={cx("py-4 px-6 text-right font-medium", item.signal === 'UP' ? "text-success" : "text-danger")}>
                          {item.signal === 'UP' ? '+' : ''}{item.differencePercent.toFixed(2)}%
                        </td>
                        <td className="py-4 px-6 text-right text-xs text-slate-500">
                          {formatVolume(item.volume)}
                        </td>
                      </>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal */}
      {selectedCoin && (
        <CoinDetailModal coin={selectedCoin} onClose={() => setSelectedCoin(null)} />
      )}
    </div>
  );
}

function StatCard({ label, value, color, icon, subText }) {
  return (
    <div className="bg-surface p-4 rounded-xl border border-border shadow-sm">
      <div className="flex justify-between items-start mb-2">
        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest leading-tight">{label}</span>
        <div className={cx("w-5 h-5 opacity-20", color)}>{icon}</div>
      </div>
      <div className={cx("text-2xl font-bold", color)}>{value}</div>
      {subText && <div className="text-[10px] text-slate-500 mt-1">{subText}</div>}
    </div>
  );
}

function SignalBadge({ signal }) {
  const styles = {
    STRONG_BUY: "bg-green-500/20 text-green-400 border-green-500/50 shadow-[0_0_10px_rgba(74,222,128,0.4)]",
    BUY: "bg-success/20 text-success border-success/30",
    UP: "bg-success/20 text-success border-success/30",
    WATCH: "bg-primary/20 text-primary border-primary/30",
    RISK: "bg-amber-500/20 text-amber-500 border-amber-500/30",
    SELL: "bg-danger/20 text-danger border-danger/30",
    DOWN: "bg-danger/20 text-danger border-danger/30"
  };
  return (
    <span className={cx("px-2 py-0.5 rounded text-[10px] font-bold border uppercase tracking-tighter", styles[signal])}>
      {signal.replace('_', ' ')}
    </span>
  );
}

function getSignalColor(signal) {
  switch(signal) {
    case 'STRONG_BUY': return 'text-green-400 font-black drop-shadow-[0_0_5px_rgba(74,222,128,0.8)]';
    case 'BUY': return 'text-success';
    case 'WATCH': return 'text-primary';
    case 'RISK': return 'text-amber-500';
    case 'SELL': return 'text-danger';
    default: return 'text-slate-400';
  }
}

function getChangeColorClass(type) {
  switch (type) {
    case 'NEW_BUY': return 'border-success/30 hover:border-success/50';
    case 'LOST_BUY': return 'border-danger/30 hover:border-danger/50';
    case 'SIGNAL_CHANGED': return 'border-amber-500/30 hover:border-amber-500/50';
    case 'SCORE_UP': return 'border-blue-400/30 hover:border-blue-400/50';
    case 'SCORE_DOWN': return 'border-orange-400/30 hover:border-orange-400/50';
    case 'NEW_BREAKOUT': return 'border-primary/30 hover:border-primary/50';
    default: return 'border-border';
  }
}

function FilterButton({ label, active, onClick, color }) {
  return (
    <button 
      onClick={onClick}
      className={cx(
        "px-2 py-1 rounded text-xs font-medium border transition-colors",
        active ? "bg-slate-700 text-slate-100 border-slate-500" : "bg-transparent text-slate-400 border-transparent hover:bg-slate-800",
        active && color ? color : ""
      )}
    >
      {label}
    </button>
  );
}

function CoinDetailModal({ coin, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm">
      <div className="bg-surface w-full max-w-5xl rounded-2xl border border-border shadow-2xl overflow-hidden flex flex-col max-h-[95vh]">
        <div className="p-6 border-b border-border flex justify-between items-center bg-slate-800/30">
          <div>
            <h3 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
              {coin.symbol}
              <SignalBadge signal={coin.signal} />
            </h3>
            <p className="text-slate-400 text-sm mt-1">Daily Trading Decision Analysis</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-700 rounded-full transition-colors text-slate-400">
             <RefreshCw className="w-6 h-6 rotate-45" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto space-y-6 flex-1">
          {/* Chart Section */}
          <div className="w-full h-[400px]">
            <TradingViewChart symbol={coin.symbol} interval="D" />
          </div>

          {/* Main Grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-slate-900/50 p-4 rounded-xl border border-border">
              <div className="text-[10px] font-bold text-slate-500 uppercase mb-2">Price & Target</div>
              <div className="space-y-3">
                <div className="flex justify-between text-sm">
                  <span className="text-slate-400">Entry</span>
                  <span className="text-slate-100 font-mono">{coin.price.toFixed(4)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-success">Target 1</span>
                  <span className="text-success font-mono font-bold">{coin.target1.toFixed(4)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-success/70">Target 2</span>
                  <span className="text-success/70 font-mono">{coin.target2.toFixed(4)}</span>
                </div>
                <div className="flex justify-between text-sm border-t border-border pt-2">
                  <span className="text-danger">Stop Loss</span>
                  <span className="text-danger font-mono font-bold">{coin.stopLoss.toFixed(4)}</span>
                </div>
              </div>
            </div>

            <div className="bg-slate-900/50 p-4 rounded-xl border border-border">
              <div className="text-[10px] font-bold text-slate-500 uppercase mb-2">Technicals</div>
              <div className="space-y-3">
                <IndicatorRow label="Structure" value={coin.structureType} />
                <IndicatorRow label="RSI (14)" value={coin.rsi14.toFixed(1)} />
                <IndicatorRow label="ATR (14)" value={coin.atr14.toFixed(4)} />
                <IndicatorRow label="MA100 Dist" value={`${coin.ma100Dist.toFixed(1)}%`} />
                <IndicatorRow label="Volume Ratio" value={`${coin.volumeRatio}x`} />
              </div>
            </div>

            <div className="bg-slate-900/50 p-4 rounded-xl border border-border">
              <div className="text-[10px] font-bold text-slate-500 uppercase mb-2">Score & Trend</div>
              <div className="flex flex-col items-center justify-center py-2">
                 <div className="text-4xl font-black text-primary">{coin.trendScore}</div>
                 <div className="text-[10px] text-slate-500 uppercase mt-1">Trend Score</div>
                 <div className="mt-4 flex flex-col gap-1 w-full">
                    <div className="flex justify-between text-[10px]">
                       <span className="text-slate-500 uppercase">R/R Ratio</span>
                       <span className="text-primary font-bold">{coin.riskRewardRatio}</span>
                    </div>
                 </div>
              </div>
            </div>
          </div>

          {/* Reasons */}
          <div>
            <h4 className="text-sm font-bold text-slate-300 mb-3 flex items-center gap-2">
              <Info className="w-4 h-4 text-primary" /> Analysis Reasons
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {coin.reasons.map((reason, idx) => (
                <div key={idx} className="flex items-center gap-2 text-xs text-slate-400 bg-slate-800/30 p-2 rounded-lg border border-border/50">
                  <div className="w-1.5 h-1.5 rounded-full bg-success" />
                  {reason}
                </div>
              ))}
            </div>
          </div>

          {/* Warning */}
          <div className="bg-danger/5 border border-danger/20 p-4 rounded-xl flex items-start gap-3">
             <AlertCircle className="w-5 h-5 text-danger flex-shrink-0" />
             <p className="text-[11px] text-danger/70 leading-relaxed">
               Trading involves substantial risk. The targets and stop loss provided are purely based on ATR volatility calculations and do not guarantee success. Never invest more than you can afford to lose.
             </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function IndicatorRow({ label, value }) {
  return (
    <div className="flex justify-between text-xs">
      <span className="text-slate-500">{label}</span>
      <span className="text-slate-300 font-mono">{value}</span>
    </div>
  );
}

function formatVolume(vol) {
  if (vol >= 1000000) return (vol / 1000000).toFixed(2) + 'M';
  if (vol >= 1000) return (vol / 100).toFixed(2) + 'K';
  return vol.toFixed(2);
}
