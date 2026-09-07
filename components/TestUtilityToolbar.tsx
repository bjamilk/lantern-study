import React, { useState } from 'react';
import { XMarkIcon } from '@heroicons/react/24/outline';

export type ToolType = 'highlight' | 'strikeout' | null;

export interface ToolbarState {
  activeTool: ToolType;
  showCalculator: boolean;
  showNote: boolean;
}

interface TestUtilityToolbarProps {
  activeTool: ToolType;
  onToolChange: (tool: ToolType) => void;
  showCalculator: boolean;
  onToggleCalculator: () => void;
  showNote: boolean;
  onToggleNote: () => void;
  note: string;
  onNoteChange: (note: string) => void;
  isBookmarked: boolean;
  onToggleBookmark: () => void;
  highlightCount: number;
  onClearHighlights: () => void;
}

// ─── Calculator ─────────────────────────────────────────────────────────────

const Calculator: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [display, setDisplay] = useState('0');
  const [prevValue, setPrevValue] = useState<number | null>(null);
  const [operator, setOperator] = useState<string | null>(null);
  const [waitingForOperand, setWaitingForOperand] = useState(false);

  const inputDigit = (digit: string) => {
    if (waitingForOperand) {
      setDisplay(digit);
      setWaitingForOperand(false);
    } else {
      setDisplay(display === '0' ? digit : display + digit);
    }
  };

  const inputDecimal = () => {
    if (waitingForOperand) {
      setDisplay('0.');
      setWaitingForOperand(false);
      return;
    }
    if (!display.includes('.')) setDisplay(display + '.');
  };

  const clear = () => {
    setDisplay('0');
    setPrevValue(null);
    setOperator(null);
    setWaitingForOperand(false);
  };

  const toggleSign = () => setDisplay(String(parseFloat(display) * -1));

  const percentage = () => setDisplay(String(parseFloat(display) / 100));

  const compute = (a: number, b: number, op: string): number => {
    switch (op) {
      case '+': return a + b;
      case '−': return a - b;
      case '×': return a * b;
      case '÷': return b !== 0 ? a / b : 0;
      default: return b;
    }
  };

  const handleOperator = (op: string) => {
    const current = parseFloat(display);
    if (prevValue !== null && !waitingForOperand) {
      const result = compute(prevValue, current, operator!);
      const resultStr = parseFloat(result.toPrecision(12)).toString();
      setDisplay(resultStr);
      setPrevValue(parseFloat(resultStr));
    } else {
      setPrevValue(current);
    }
    setOperator(op);
    setWaitingForOperand(true);
  };

  const equals = () => {
    if (prevValue === null || operator === null) return;
    const current = parseFloat(display);
    const result = compute(prevValue, current, operator);
    const resultStr = parseFloat(result.toPrecision(12)).toString();
    setDisplay(resultStr);
    setPrevValue(null);
    setOperator(null);
    setWaitingForOperand(true);
  };

  const isActiveOp = (op: string) => operator === op && waitingForOperand;
  const btn = 'flex items-center justify-center rounded-xl text-base font-medium h-11 w-full transition-all duration-100 active:scale-95 select-none cursor-pointer';

  const displayText =
    display.length > 10
      ? parseFloat(parseFloat(display).toPrecision(8)).toString()
      : display;

  return (
    <div className="bg-lantern-background rounded-2xl p-3 w-full max-w-[260px] shadow-2xl border border-lantern-border">
      <div className="flex justify-between items-center mb-2">
        <span className="text-lantern-text-tertiary text-xs font-semibold uppercase tracking-wider pl-1">
          Calculator
        </span>
        <button
          onClick={onClose}
          className="text-lantern-text-secondary hover:text-lantern-text-tertiary p-1 rounded-lg transition-colors"
        >
          <XMarkIcon className="w-4 h-4" />
        </button>
      </div>

      {/* Display */}
      <div className="bg-lantern-surface rounded-xl px-4 py-3 mb-3 text-right min-h-[68px] flex flex-col justify-end">
        <div className="text-lantern-text-secondary text-xs min-h-[18px]">
          {prevValue !== null ? `${prevValue} ${operator}` : ''}
        </div>
        <div className="text-white text-3xl font-light tracking-tight overflow-hidden">
          {displayText}
        </div>
      </div>

      {/* Buttons */}
      <div className="grid grid-cols-4 gap-1.5">
        {/* Row 1 */}
        <button onClick={clear} className={`${btn} bg-lantern-border hover:bg-lantern-border text-white`}>C</button>
        <button onClick={toggleSign} className={`${btn} bg-lantern-border hover:bg-lantern-border text-white`}>±</button>
        <button onClick={percentage} className={`${btn} bg-lantern-border hover:bg-lantern-border text-white`}>%</button>
        <button
          onClick={() => handleOperator('÷')}
          className={`${btn} ${isActiveOp('÷') ? 'bg-lantern-surface text-orange-500' : 'bg-orange-500 hover:bg-orange-400 text-white'}`}
        >÷</button>

        {/* Row 2 */}
        {['7', '8', '9'].map(d => (
          <button key={d} onClick={() => inputDigit(d)} className={`${btn} bg-lantern-surface-secondary hover:bg-lantern-border text-white`}>{d}</button>
        ))}
        <button
          onClick={() => handleOperator('×')}
          className={`${btn} ${isActiveOp('×') ? 'bg-lantern-surface text-orange-500' : 'bg-orange-500 hover:bg-orange-400 text-white'}`}
        >×</button>

        {/* Row 3 */}
        {['4', '5', '6'].map(d => (
          <button key={d} onClick={() => inputDigit(d)} className={`${btn} bg-lantern-surface-secondary hover:bg-lantern-border text-white`}>{d}</button>
        ))}
        <button
          onClick={() => handleOperator('−')}
          className={`${btn} ${isActiveOp('−') ? 'bg-lantern-surface text-orange-500' : 'bg-orange-500 hover:bg-orange-400 text-white'}`}
        >−</button>

        {/* Row 4 */}
        {['1', '2', '3'].map(d => (
          <button key={d} onClick={() => inputDigit(d)} className={`${btn} bg-lantern-surface-secondary hover:bg-lantern-border text-white`}>{d}</button>
        ))}
        <button
          onClick={() => handleOperator('+')}
          className={`${btn} ${isActiveOp('+') ? 'bg-lantern-surface text-orange-500' : 'bg-orange-500 hover:bg-orange-400 text-white'}`}
        >+</button>

        {/* Row 5 */}
        <button
          onClick={() => inputDigit('0')}
          className={`${btn} col-span-2 bg-lantern-surface-secondary hover:bg-lantern-border text-white justify-start px-5`}
        >0</button>
        <button onClick={inputDecimal} className={`${btn} bg-lantern-surface-secondary hover:bg-lantern-border text-white`}>.</button>
        <button onClick={equals} className={`${btn} bg-orange-500 hover:bg-orange-400 text-white`}>=</button>
      </div>
    </div>
  );
};

// ─── Toolbar ─────────────────────────────────────────────────────────────────

const TestUtilityToolbar: React.FC<TestUtilityToolbarProps> = ({
  activeTool,
  onToolChange,
  showCalculator,
  onToggleCalculator,
  showNote,
  onToggleNote,
  note,
  onNoteChange,
  isBookmarked,
  onToggleBookmark,
  highlightCount,
  onClearHighlights,
}) => {
  return (
    <div className="space-y-1.5">
      {/* ── Tool Buttons ── */}
      <div className="flex items-center gap-1 sm:gap-1.5 flex-wrap bg-lantern-surface border border-lantern-border rounded-lg sm:rounded-xl px-2 py-1 sm:px-3 sm:py-1.5 shadow-sm">
        <span className="hidden sm:inline text-label font-bold text-lantern-text-tertiary uppercase tracking-widest mr-1 select-none">
          Tools
        </span>

        {/* Highlight */}
        <button
          onClick={() => onToolChange(activeTool === 'highlight' ? null : 'highlight')}
          title="Highlight key terms — select text in the question"
          className={`flex items-center gap-1 px-2 py-1 sm:px-2.5 sm:py-1.5 rounded-md sm:rounded-lg text-label tracking-normal sm:text-caption font-medium border transition-all ${
            activeTool === 'highlight'
              ? 'bg-yellow-100 dark:bg-yellow-900/40 border-yellow-400 dark:border-yellow-600 text-yellow-700 dark:text-yellow-300 shadow-sm'
              : 'bg-lantern-surface dark:bg-lantern-surface-secondary border-lantern-border text-lantern-text-secondary hover:bg-lantern-background dark:hover:bg-lantern-border'
          }`}
        >
          {/* Highlighter pen icon */}
          <svg className="w-3.5 h-3.5 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
            <line x1="3" y1="21" x2="21" y2="21" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" opacity="0.4"/>
          </svg>
          <span className="hidden sm:inline">Highlight</span>
          {highlightCount > 0 && (
            <span className="bg-yellow-500 text-white text-label tracking-normal rounded-full w-3.5 h-3.5 sm:w-4 sm:h-4 flex items-center justify-center font-bold leading-none">
              {highlightCount}
            </span>
          )}
        </button>

        {/* Strikeout */}
        <button
          onClick={() => onToolChange(activeTool === 'strikeout' ? null : 'strikeout')}
          title="Strike out answer choices you've eliminated"
          className={`flex items-center gap-1 px-2 py-1 sm:px-2.5 sm:py-1.5 rounded-md sm:rounded-lg text-label tracking-normal sm:text-caption font-medium border transition-all ${
            activeTool === 'strikeout'
              ? 'bg-red-100 dark:bg-red-900/40 border-red-400 dark:border-red-600 text-red-700 dark:text-red-300 shadow-sm'
              : 'bg-lantern-surface dark:bg-lantern-surface-secondary border-lantern-border text-lantern-text-secondary hover:bg-lantern-background dark:hover:bg-lantern-border'
          }`}
        >
          {/* Strikeout text icon */}
          <svg className="w-3.5 h-3.5 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="5" y1="6" x2="19" y2="6" strokeOpacity="0.5" />
            <line x1="4" y1="12" x2="20" y2="12" strokeWidth="2.5" />
            <line x1="5" y1="18" x2="19" y2="18" strokeOpacity="0.5" />
          </svg>
          <span className="hidden sm:inline">Strikeout</span>
        </button>

        {/* Calculator */}
        <button
          onClick={onToggleCalculator}
          title="Open calculator"
          className={`flex items-center gap-1 px-2 py-1 sm:px-2.5 sm:py-1.5 rounded-md sm:rounded-lg text-label tracking-normal sm:text-caption font-medium border transition-all ${
            showCalculator
              ? 'bg-emerald-100 dark:bg-emerald-900/40 border-emerald-400 dark:border-emerald-600 text-emerald-700 dark:text-emerald-300 shadow-sm'
              : 'bg-lantern-surface dark:bg-lantern-surface-secondary border-lantern-border text-lantern-text-secondary hover:bg-lantern-background dark:hover:bg-lantern-border'
          }`}
        >
          <svg className="w-3.5 h-3.5 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="4" y="2" width="16" height="20" rx="2" />
            <line x1="8" y1="7" x2="16" y2="7" />
            <line x1="8" y1="12" x2="9.5" y2="12" />
            <line x1="14.5" y1="12" x2="16" y2="12" />
            <line x1="8" y1="16" x2="9.5" y2="16" />
            <line x1="14.5" y1="16" x2="16" y2="16" />
            <line x1="12" y1="11" x2="12" y2="13" />
            <line x1="12" y1="15" x2="12" y2="17" />
          </svg>
          <span className="hidden sm:inline">Calc</span>
        </button>

        {/* Note */}
        <button
          onClick={onToggleNote}
          title="Open scratch note for this question"
          className={`flex items-center gap-1 px-2 py-1 sm:px-2.5 sm:py-1.5 rounded-md sm:rounded-lg text-label tracking-normal sm:text-caption font-medium border transition-all ${
            showNote
              ? 'bg-blue-100 dark:bg-blue-900/40 border-blue-400 dark:border-lantern-primary/30 text-blue-700 dark:text-blue-300 shadow-sm'
              : 'bg-lantern-surface dark:bg-lantern-surface-secondary border-lantern-border text-lantern-text-secondary hover:bg-lantern-background dark:hover:bg-lantern-border'
          }`}
        >
          <svg className="w-3.5 h-3.5 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="9" y1="13" x2="15" y2="13" />
            <line x1="9" y1="17" x2="15" y2="17" />
          </svg>
          <span className="hidden sm:inline">Note</span>
          {note.trim() && (
            <span className="w-1.5 h-1.5 bg-blue-500 rounded-full flex-shrink-0" />
          )}
        </button>

        {/* Bookmark (= mark for review) */}
        <button
          type="button"
          onClick={onToggleBookmark}
          title={isBookmarked ? 'Remove bookmark / review mark' : 'Bookmark this question for review'}
          className={`flex items-center gap-1 px-2 py-1 sm:px-2.5 sm:py-1.5 rounded-md sm:rounded-lg text-label tracking-normal sm:text-caption font-medium border transition-all ${
            isBookmarked
              ? 'bg-yellow-100 dark:bg-yellow-900/40 border-yellow-400 dark:border-yellow-600 text-yellow-700 dark:text-yellow-300 shadow-sm'
              : 'bg-lantern-surface dark:bg-lantern-surface-secondary border-lantern-border text-lantern-text-secondary hover:bg-lantern-background dark:hover:bg-lantern-border'
          }`}
        >
          <svg
            className="w-3.5 h-3.5 flex-shrink-0"
            viewBox="0 0 24 24"
            fill={isBookmarked ? 'currentColor' : 'none'}
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
          </svg>
          <span className="hidden sm:inline">{isBookmarked ? 'Bookmarked' : 'Bookmark'}</span>
        </button>

        {/* Clear highlights shortcut */}
        {highlightCount > 0 && activeTool === 'highlight' && (
          <button
            onClick={onClearHighlights}
            title="Clear all highlights on this question"
            className="ml-auto flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 border border-transparent transition-all"
          >
            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6l-1 14H6L5 6" />
              <path d="M10 11v6M14 11v6" />
              <path d="M9 6V4h6v2" />
            </svg>
            Clear
          </button>
        )}
      </div>

      {/* ── Active tool hint ── */}
      {activeTool === 'highlight' && (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg text-xs text-yellow-700 dark:text-yellow-300">
          <svg className="w-3.5 h-3.5 flex-shrink-0" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z" />
          </svg>
          Select text in the question to highlight it. Click again on a highlight to remove it.
        </div>
      )}
      {activeTool === 'strikeout' && (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-xs text-red-700 dark:text-red-300">
          <svg className="w-3.5 h-3.5 flex-shrink-0" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z" />
          </svg>
          Click any answer choice to cross it out. Click again to restore it.
        </div>
      )}

      {/* ── Note panel ── */}
      {showNote && (
        <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-xl p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-blue-700 dark:text-blue-300 flex items-center gap-1.5">
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="9" y1="13" x2="15" y2="13" />
                <line x1="9" y1="17" x2="15" y2="17" />
              </svg>
              My Note
            </span>
            {note.trim() && (
              <button
                onClick={() => onNoteChange('')}
                className="text-xs text-blue-400 hover:text-lantern-primary dark:hover:text-blue-200 transition-colors"
              >
                Clear
              </button>
            )}
          </div>
          <textarea
            value={note}
            onChange={e => onNoteChange(e.target.value)}
            placeholder="Jot down your thought process for this question..."
            rows={3}
            className="w-full p-2.5 text-sm bg-lantern-surface border border-blue-200 dark:border-blue-700 rounded-lg text-lantern-text placeholder:text-lantern-text-tertiary dark:placeholder:text-lantern-text-tertiary focus:outline-none focus:ring-2 focus:ring-lantern-primary resize-none"
          />
        </div>
      )}

      {/* ── Calculator panel ── */}
      {showCalculator && (
        <div className="flex justify-start">
          <Calculator onClose={onToggleCalculator} />
        </div>
      )}
    </div>
  );
};

export default TestUtilityToolbar;
