import React from 'react';
import ScannerDashboard from './components/ScannerDashboard';

function App() {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="bg-surface border-b border-border py-4 px-6 sticky top-0 z-10 shadow-sm">
        <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
          <span className="text-primary">Crypto</span> MA100 Scanner
        </h1>
      </header>
      <main className="flex-1 p-6 overflow-x-hidden">
        <ScannerDashboard />
      </main>
    </div>
  );
}

export default App;
