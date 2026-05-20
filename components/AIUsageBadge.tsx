import React, { useEffect, useState } from 'react';
import { useAuthStore } from '../stores/authStore';
import { fetchAIUsage, subscribeToAIUsage, getLatestAIUsage, AIUsageInfo } from '../services/ai';

/**
 * AI Usage Badge — shows remaining AI requests as a progress bar.
 * Color-coded: green (>50%), amber (20–50%), red (<20%).
 * Placed in the Sidebar and anywhere else the user needs visibility.
 */
const AIUsageBadge: React.FC<{ className?: string; compact?: boolean }> = ({ className = '', compact = false }) => {
  const currentUser = useAuthStore(s => s.currentUser);
  const [usage, setUsage] = useState<AIUsageInfo>(getLatestAIUsage());

  // Fetch usage on mount / user change
  useEffect(() => {
    if (currentUser?.id) {
      fetchAIUsage(currentUser.id);
    }
  }, [currentUser?.id]);

  // Subscribe to real-time usage updates (from response headers after each AI call)
  useEffect(() => {
    return subscribeToAIUsage(setUsage);
  }, []);

  if (!usage.limit) return null;

  const remaining = Math.max(0, usage.limit - usage.used);
  const pct = (remaining / usage.limit) * 100;

  // Color theming
  let barColor = 'bg-emerald-500';
  let textColor = 'text-emerald-700 dark:text-emerald-400';
  let bgColor = 'bg-emerald-50 dark:bg-emerald-900/20';
  let borderColor = 'border-emerald-200 dark:border-emerald-800';

  if (pct <= 20) {
    barColor = 'bg-red-500';
    textColor = 'text-red-700 dark:text-red-400';
    bgColor = 'bg-red-50 dark:bg-red-900/20';
    borderColor = 'border-red-200 dark:border-red-800';
  } else if (pct <= 50) {
    barColor = 'bg-amber-500';
    textColor = 'text-amber-700 dark:text-amber-400';
    bgColor = 'bg-amber-50 dark:bg-amber-900/20';
    borderColor = 'border-amber-200 dark:border-amber-800';
  }

  // Format reset countdown
  let resetLabel = '';
  if (usage.resetsAt) {
    const resetDate = new Date(usage.resetsAt);
    const now = new Date();
    const diffMs = resetDate.getTime() - now.getTime();
    if (diffMs > 0) {
      const diffHrs = Math.floor(diffMs / (1000 * 60 * 60));
      const diffMins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
      resetLabel = diffHrs > 0 ? `Resets in ${diffHrs}h ${diffMins}m` : `Resets in ${diffMins}m`;
    }
  }

  if (compact) {
    return (
      <div className={`flex items-center gap-2 ${className}`} title={`AI Requests: ${remaining}/${usage.limit} remaining${resetLabel ? ` · ${resetLabel}` : ''}`}>
        <svg className={`w-3.5 h-3.5 ${textColor} flex-shrink-0`} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456z" />
        </svg>
        <div className="flex-1 min-w-0">
          <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-1.5">
            <div className={`${barColor} h-1.5 rounded-full transition-all duration-500`} style={{ width: `${pct}%` }} />
          </div>
        </div>
        <span className={`text-[10px] font-bold ${textColor} whitespace-nowrap`}>{remaining}</span>
      </div>
    );
  }

  return (
    <div className={`${bgColor} ${borderColor} border rounded-lg px-3 py-2 ${className}`}>
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-1.5">
          <svg className={`w-3.5 h-3.5 ${textColor}`} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456z" />
          </svg>
          <span className={`text-xs font-semibold ${textColor}`}>AI Requests</span>
        </div>
        <span className={`text-xs font-bold ${textColor}`}>{remaining}/{usage.limit}</span>
      </div>
      <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-1.5">
        <div className={`${barColor} h-1.5 rounded-full transition-all duration-500`} style={{ width: `${pct}%` }} />
      </div>
      {resetLabel && <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-1">{resetLabel}</p>}
      {remaining === 0 && <p className="text-[10px] text-red-600 dark:text-red-400 mt-1 font-medium">Daily limit reached</p>}
    </div>
  );
};

export default AIUsageBadge;
