import React, { useState, useMemo } from 'react';
import { XCircleIcon, CalculatorIcon, LightBulbIcon } from '@heroicons/react/24/outline';

interface SimulationControlsProps {
  isOpen: boolean;
  onClose: () => void;
}

const SimulationControls: React.FC<SimulationControlsProps> = ({ isOpen, onClose }) => {
  const [mode, setMode] = useState<'tips' | 'simulator' | 'calculator'>('tips');
  // Simulator
  const [simIncome, setSimIncome] = useState<number | ''>('');
  const [simFood, setSimFood] = useState<number | ''>(30);
  const [simTransport, setSimTransport] = useState<number | ''>(15);
  const [simData, setSimData] = useState<number | ''>(10);
  const [simSavings, setSimSavings] = useState<number | ''>(20);
  // Calculator
  const [calcAmount, setCalcAmount] = useState<number | ''>('');
  const [calcRate, setCalcRate] = useState<number | ''>(15);
  const [calcMonths, setCalcMonths] = useState<number | ''>(12);

  const simIncomeVal = Number(simIncome) || 0;
  const simResult = useMemo(() => {
    const food = simIncomeVal * (Number(simFood) || 0) / 100;
    const transport = simIncomeVal * (Number(simTransport) || 0) / 100;
    const data = simIncomeVal * (Number(simData) || 0) / 100;
    const savings = simIncomeVal * (Number(simSavings) || 0) / 100;
    const allocated = food + transport + data + savings;
    const remaining = simIncomeVal - allocated;
    return { food, transport, data, savings, remaining, pctUsed: simIncomeVal > 0 ? ((allocated / simIncomeVal) * 100) : 0 };
  }, [simIncome, simFood, simTransport, simData, simSavings]);

  const calcResult = useMemo(() => {
    const p = Number(calcAmount) || 0;
    const r = (Number(calcRate) || 0) / 100 / 12; // monthly rate
    const n = Number(calcMonths) || 0;
    if (p <= 0 || n <= 0) return { total: 0, interest: 0 };
    const total = r > 0 ? p * Math.pow(1 + r, n) : p;
    return { total, interest: total - p };
  }, [calcAmount, calcRate, calcMonths]);

  if (!isOpen) return null;

  const QUICK_TIPS = [
    { icon: '🍔', title: 'Food Budget Hack', tip: 'Buy foodstuff weekly and cook in bulk. Saves up to ₦15,000/month vs buying from canteens daily.' },
    { icon: '📱', title: 'Data Saving', tip: 'Use night plans (₦50-200) for heavy downloads. Restrict background data. Campus Wi-Fi for lectures.' },
    { icon: '🚌', title: 'Transport Smart', tip: 'Walk for short distances. Group transport with classmates. Explore monthly passes if available.' },
    { icon: '📚', title: 'Textbook Tips', tip: 'Buy used textbooks or share with coursemates. Use the Marketplace to sell after the semester.' },
    { icon: '🐷', title: 'The ₦100 Challenge', tip: 'Save ₦100 on Day 1, ₦200 on Day 2... By Day 30, you\'ve saved ₦46,500!' },
    { icon: '💡', title: 'Needs vs Wants', tip: 'Before buying anything, wait 24 hours. If you still need it tomorrow, it\'s probably a need.' },
    { icon: '📊', title: 'Track Everything', tip: 'Log every ₦50+ expense. Most people underestimate spending by 30% when they don\'t track.' },
    { icon: '🎉', title: 'Budget for Fun', tip: 'Allocate 10-15% for social activities. Deprivation budgets fail — allow yourself controlled fun.' },
  ];

  return (
    <div className="fixed inset-0 bg-black/60 dark:bg-black/75 flex items-center justify-center p-4 z-[80]" role="dialog" aria-modal="true">
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl w-full max-w-lg overflow-hidden max-h-[85vh] flex flex-col">
        <div className="bg-gradient-to-r from-cyan-500 to-blue-600 px-5 py-4 flex justify-between items-center shrink-0">
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <LightBulbIcon className="w-5 h-5" /> Financial Toolkit
          </h2>
          <button onClick={onClose} className="text-white/70 hover:text-white"><XCircleIcon className="w-6 h-6" /></button>
        </div>

        {/* Sub-tabs */}
        <div className="flex border-b border-slate-200 dark:border-slate-700 px-4 shrink-0">
          {[
            { key: 'tips' as const, label: '💡 Tips', },
            { key: 'simulator' as const, label: '📊 Simulator' },
            { key: 'calculator' as const, label: '🧮 Calculator' },
          ].map(t => (
            <button key={t.key} onClick={() => setMode(t.key)}
              className={`px-4 py-2.5 text-xs font-medium border-b-2 transition-colors ${
                mode === t.key ? 'border-cyan-500 text-cyan-600 dark:text-cyan-400' : 'border-transparent text-slate-400 hover:text-slate-600'
              }`}>
              {t.label}
            </button>
          ))}
        </div>

        <div className="p-5 overflow-y-auto flex-1 space-y-4">
          {/* TIPS */}
          {mode === 'tips' && (
            <div className="space-y-3">
              {QUICK_TIPS.map((tip, i) => (
                <div key={i} className="bg-slate-50 dark:bg-slate-700/50 rounded-xl p-4">
                  <div className="flex items-start gap-3">
                    <span className="text-2xl">{tip.icon}</span>
                    <div>
                      <h4 className="font-medium text-sm text-slate-800 dark:text-slate-100">{tip.title}</h4>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">{tip.tip}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* BUDGET SIMULATOR */}
          {mode === 'simulator' && (
            <div className="space-y-4">
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Enter your monthly income and adjust category percentages to plan your spending.
              </p>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Monthly Income (₦)</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">₦</span>
                  <input type="number" value={simIncome} onChange={(e) => setSimIncome(e.target.value === '' ? '' : parseFloat(e.target.value))}
                    className="w-full p-2.5 pl-8 border border-slate-300 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-cyan-400 focus:border-transparent"
                    placeholder="e.g. 50000" />
                </div>
              </div>

              {[
                { label: '🍔 Food & Feeding', state: simFood, setter: setSimFood },
                { label: '🚌 Transport', state: simTransport, setter: setSimTransport },
                { label: '📱 Data & Airtime', state: simData, setter: setSimData },
                { label: '🐷 Savings', state: simSavings, setter: setSimSavings },
              ].map(({ label, state, setter }) => (
                <div key={label}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-slate-600 dark:text-slate-300">{label}</span>
                    <span className="font-medium text-slate-700 dark:text-slate-200">{state}% = ₦{(simIncomeVal * (Number(state) || 0) / 100).toLocaleString('en-NG')}</span>
                  </div>
                  <input type="range" min="0" max="50" value={Number(state) || 0} onChange={(e) => setter(parseInt(e.target.value))}
                    className="w-full h-2 bg-slate-200 dark:bg-slate-700 rounded-full appearance-none cursor-pointer accent-cyan-500" />
                </div>
              ))}

              <div className="bg-slate-50 dark:bg-slate-700/50 rounded-xl p-4 space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-slate-400">Allocated</span>
                  <span className="font-semibold text-cyan-600 dark:text-cyan-400">{simResult.pctUsed.toFixed(0)}%</span>
                </div>
                <div className="w-full bg-slate-200 dark:bg-slate-600 rounded-full h-2.5">
                  <div className={`h-2.5 rounded-full transition-all ${simResult.remaining >= 0 ? 'bg-cyan-400' : 'bg-red-400'}`} style={{ width: `${Math.min(simResult.pctUsed, 100)}%` }} />
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-slate-400">Remaining for other expenses</span>
                  <span className={`font-semibold ${simResult.remaining >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>₦{simResult.remaining.toLocaleString('en-NG')}</span>
                </div>
              </div>
            </div>
          )}

          {/* SAVINGS CALCULATOR */}
          {mode === 'calculator' && (
            <div className="space-y-4">
              <p className="text-xs text-slate-500 dark:text-slate-400">
                See how your savings can grow with compound interest.
              </p>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Initial Amount (₦)</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">₦</span>
                  <input type="number" value={calcAmount} onChange={(e) => setCalcAmount(e.target.value === '' ? '' : parseFloat(e.target.value))}
                    className="w-full p-2.5 pl-8 border border-slate-300 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-cyan-400 focus:border-transparent"
                    placeholder="10,000" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Annual Interest Rate (%)</label>
                <input type="number" value={calcRate} onChange={(e) => setCalcRate(e.target.value === '' ? '' : parseFloat(e.target.value))} min="0" max="100" step="0.5"
                  className="w-full p-2.5 border border-slate-300 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-cyan-400 focus:border-transparent"
                  placeholder="15" />
                <p className="text-xs text-slate-400 mt-0.5">Nigerian savings accounts: 4-6% | Fixed deposits: 10-18%</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Duration (months)</label>
                <input type="number" value={calcMonths} onChange={(e) => setCalcMonths(e.target.value === '' ? '' : parseInt(e.target.value))} min="1" max="120"
                  className="w-full p-2.5 border border-slate-300 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-cyan-400 focus:border-transparent"
                  placeholder="12" />
              </div>
              {(Number(calcAmount) || 0) > 0 && (
                <div className="bg-gradient-to-r from-cyan-500 to-blue-600 rounded-xl p-4 text-white">
                  <p className="text-white/70 text-xs">After {calcMonths} months</p>
                  <p className="text-2xl font-bold mt-1">₦{Math.round(calcResult.total).toLocaleString('en-NG')}</p>
                  <p className="text-sm text-white/80 mt-1">
                    Interest earned: <span className="font-semibold">₦{Math.round(calcResult.interest).toLocaleString('en-NG')}</span>
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="px-5 py-4 border-t border-slate-200 dark:border-slate-700 shrink-0">
          <button onClick={onClose} className="w-full px-4 py-2.5 text-sm font-medium text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-700 rounded-xl hover:bg-slate-200 dark:hover:bg-slate-600">Close</button>
        </div>
      </div>
    </div>
  );
};

export default SimulationControls;
