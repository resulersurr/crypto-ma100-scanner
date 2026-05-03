import React, { useEffect, useRef, useState } from 'react';

export default function TradingViewChart({ symbol, interval = 'D' }) {
  const containerRef = useRef(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Format symbol: convert "BTCUSDT" to "BINANCE:BTCUSDT"
    const formattedSymbol = symbol.includes(':') ? symbol : `BINANCE:${symbol}`;

    // Clean up previous script if any
    if (containerRef.current) {
      containerRef.current.innerHTML = '';
    }
    setIsLoading(true);

    const script = document.createElement('script');
    script.src = 'https://s3.tradingview.com/tv.js';
    script.async = true;
    script.onload = () => {
      setIsLoading(false);
      if (typeof window.TradingView !== 'undefined') {
        new window.TradingView.widget({
          autosize: true,
          symbol: formattedSymbol,
          interval: interval,
          timezone: "Etc/UTC",
          theme: "dark",
          style: "1",
          locale: "en",
          enable_publishing: false,
          backgroundColor: "#0f172a", // matches our tailwind background
          gridColor: "#1e293b",
          hide_top_toolbar: false,
          hide_legend: false,
          save_image: false,
          container_id: "tradingview_chart_" + symbol,
          toolbar_bg: "#1e293b",
          studies: [
            "MASimple@tv-basicstudies",
            "RSI@tv-basicstudies"
          ],
        });
      }
    };

    document.head.appendChild(script);

    return () => {
      // Cleanup script tag on unmount
      if (script.parentNode) {
        script.parentNode.removeChild(script);
      }
    };
  }, [symbol, interval]);

  return (
    <div className="relative w-full h-full min-h-[400px] bg-slate-900 rounded-xl overflow-hidden border border-slate-700">
      {isLoading && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-900/80 z-10">
          <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin mb-4"></div>
          <p className="text-sm text-slate-400">Loading TradingView Chart...</p>
        </div>
      )}
      <div 
        id={`tradingview_chart_${symbol}`} 
        className="w-full h-full min-h-[400px]" 
        ref={containerRef}
      />
    </div>
  );
}
