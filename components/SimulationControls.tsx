import React, { useState, useMemo } from 'react';
import { XCircleIcon, LightBulbIcon } from '@heroicons/react/24/outline';
import Modal from './ui/Modal';

interface SimulationControlsProps {
  isOpen: boolean;
  onClose: () => void;
}

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

const SimulationControls: React.FC<SimulationControlsProps> = ({ isOpen, onClose }) => {
  const [mode, setMode] = useState<'tips' | 'simulator' | 'calculator'>('tips');
  const [simIncome, setSimIncome] = useState<number | ''>('');
  const [simFood, setSimFood] = useState<number | ''>(30);
  const [simTransport, setSimTransport] = useState<number | ''>(15);
  const [simData, setSimData] = useState<number | ''>(10);
  const [simSavings, setSimSavings] = useState<number | ''>(20);
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
  }, [simIncome, simFood, simTransport, simData, simSavings, simIncomeVal]);

  const calcResult = useMemo(() => {
    const p = Number(calcAmount) || 0;
    const r = (Number(calcRate) || 0) / 100 / 12;
    const n = Number(calcMonths) || 0;
    if (p <= 0 || n <= 0) return { total: 0, interest: 0 };
    const total = r > 0 ? p * Math.pow(1 + r, n) : p;
    return { total, interest: total - p };
  }, [calcAmount, calcRate, calcMonths]);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      ariaLabelledBy="simulation-controls-title"
      maxWidthClass="max-w-lg"
      zIndexClass="z-[80]"
      panelClassName="!p-0 rounded-2xl overflow-hidden max-h-[85vh] flex flex-col"
    >
      <div className="bg-lantern-surface w-full overflow-hidden max-h-[85vh] flex flex-col">
        <div className="bg-gradient-to-r from-cyan-500 to-blue-600 px-5 py-4 flex justify-between items-center shrink-0">
          <h2 id="simulation-controls-title" className="text-lg font-bold text-white flex items-center gap-2">
            <LightBulbIcon className="w-5 h-5" aria-hidden /> Financial Toolkit
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center text-white/70 hover:text-white"
            aria-label="Close financial toolkit"
          >
            <XCircleIcon className="w-6 h-6" aria-hidden />
          </button>
        </div>

        <div className="flex border-b border-lantern-border px-4 shrink-0">
          {[
            { key: 'tips' as const, label: '💡 Tips' },
            { key: 'simulator' as const, label: '📊 Simulator' },
            { key: 'calculator' as const, label: '🧮 Calculator' },
          ].map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setMode(t.key)}
              className={`min-h-[44px] px-4 py-2.5 text-xs font-medium border-b-2 transition-colors ${
                mode === t.key ? 'border-cyan-500 text-cyan-600 dark:text-cyan-400' : 'border-transparent text-lantern-text-tertiary hover:text-lantern-text-secondary'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="p-5 overflow-y-auto flex-1 space-y-4">
          {mode === 'tips' && (
            <div className="space-y-3">
              {QUICK_TIPS.map((tip, i) => (
                <div key={i} className="bg-lantern-background dark:bg-lantern-surface-secondary/50 rounded-xl p-4">
                  <div className="flex items-start gap-3">
                    <span className="text-2xl" aria-hidden>{tip.icon}</span>
                    <div>
                      <h4 className="font-medium text-sm text-lantern-text">{tip.title}</h4>
                      <p className="text-xs text-lantern-text-secondary mt-0.5 leading-relaxed">{tip.tip}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {mode === 'simulator' && (
            <div className="space-y-4">
              <p className="text-xs text-lantern-text-secondary">
                Enter your monthly income and adjust category percentages to plan your spending.
              </p>
              <div>
                <label className="block text-sm font-medium text-lantern-text mb-1">Monthly Income (₦)</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-lantern-text-tertiary">₦</span>
                  <input
                    type="number"
                    value={simIncome}
                    onChange={(e) => setSimIncome(e.target.value === '' ? '' : parseFloat(e.target.value))}
                    className="w-full min-h-[44px] p-2.5 pl-8 border border-lantern-border rounded-xl bg-lantern-surface dark:bg-lantern-surface-secondary text-lantern-text focus:ring-2 focus:ring-cyan-400 focus:border-transparent"
                    placeholder="e.g. 50000"
                  />
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
                    <span className="text-lantern-text-secondary">{label}</span>
                    <span className="font-medium text-lantern-text">{state}% = ₦{(simIncomeVal * (Number(state) || 0) / 100).toLocaleString('en-NG')}</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="50"
                    value={Number(state) || 0}
                    onChange={(e) => setter(parseInt(e.target.value, 10))}
                    className="w-full h-2 bg-lantern-background-secondary rounded-full appearance-none cursor-pointer accent-cyan-500"
                    aria-label={label}
                  />
                </div>
              ))}

              <div className="bg-lantern-background dark:bg-lantern-surface-secondary/50 rounded-xl p-4 space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-lantern-text-tertiary">Allocated</span>
                  <span className="font-semibold text-cyan-600 dark:text-cyan-400">{simResult.pctUsed.toFixed(0)}%</span>
                </div>
                <div className="w-full bg-lantern-border rounded-full h-2.5">
                  <div className={`h-2.5 rounded-full transition-all ${simResult.remaining >= 0 ? 'bg-cyan-400' : 'bg-red-400'}`} style={{ width: `${Math.min(simResult.pctUsed, 100)}%` }} />
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-lantern-text-tertiary">Remaining for other expenses</span>
                  <span className={`font-semibold ${simResult.remaining >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>₦{simResult.remaining.toLocaleString('en-NG')}</span>
                </div>
              </div>
            </div>
          )}

          {mode === 'calculator' && (
            <div className="space-y-4">
              <p className="text-xs text-lantern-text-secondary">
                See how your savings can grow with compound interest.
              </p>
              <div>
                <label className="block text-sm font-medium text-lantern-text mb-1">Initial Amount (₦)</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-lantern-text-tertiary">₦</span>
                  <input
                    type="number"
                    value={calcAmount}
                    onChange={(e) => setCalcAmount(e.target.value === '' ? '' : parseFloat(e.target.value))}
                    className="w-full min-h-[44px] p-2.5 pl-8 border border-lantern-border rounded-xl bg-lantern-surface dark:bg-lantern-surface-secondary text-lantern-text focus:ring-2 focus:ring-cyan-400 focus:border-transparent"
                    placeholder="10,000"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-lantern-text mb-1">Annual Interest Rate (%)</label>
                <input
                  type="number"
                  value={calcRate}
                  onChange={(e) => setCalcRate(e.target.value === '' ? '' : parseFloat(e.target.value))}
                  min="0"
                  max="100"
                  step="0.5"
                  className="w-full min-h-[44px] p-2.5 border border-lantern-border rounded-xl bg-lantern-surface dark:bg-lantern-surface-secondary text-lantern-text focus:ring-2 focus:ring-cyan-400 focus:border-transparent"
                  placeholder="15"
                />
                <p className="text-xs text-lantern-text-tertiary mt-0.5">Nigerian savings accounts: 4-6% | Fixed deposits: 10-18%</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-lantern-text mb-1">Duration (months)</label>
                <input
                  type="number"
                  value={calcMonths}
                  onChange={(e) => setCalcMonths(e.target.value === '' ? '' : parseInt(e.target.value, 10))}
                  min="1"
                  max="120"
                  className="w-full min-h-[44px] p-2.5 border border-lantern-border rounded-xl bg-lantern-surface dark:bg-lantern-surface-secondary text-lantern-text focus:ring-2 focus:ring-cyan-400 focus:border-transparent"
                  placeholder="12"
                />
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

        <div className="px-5 py-4 border-t border-lantern-border shrink-0">
          <button type="button" onClick={onClose} className="w-full min-h-[44px] px-4 py-2.5 text-sm font-medium text-lantern-text bg-lantern-background-secondary dark:bg-lantern-surface-secondary rounded-xl hover:bg-lantern-border">Close</button>
        </div>
      </div>
    </Modal>
  );
};

export default SimulationControls;
