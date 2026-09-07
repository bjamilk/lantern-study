import React, { useEffect, useState } from 'react';
import { getAIResetLabel } from '@lantern/shared/utils';
import { formatCreditCost } from '@lantern/shared/utils/aiCredits';
import { subscribeToAIUsage, getLatestAIUsage, fetchAIUsage, AIUsageInfo } from '../services/ai';

/**
 * Compact inline AI usage indicator — "✨ 7 left · Resets in 4h 23m"
 * Color-coded: green (>5), amber (3-5), red (<=2).
 * Use next to AI action buttons. Pass `cost` to show what the action spends
 * ("Costs 3 credits") and to force the short-of-credits state.
 */
const AIUsageInline: React.FC<{ className?: string; cost?: number }> = ({
  className = '',
  cost,
}) => {
  const [usage, setUsage] = useState<AIUsageInfo>(getLatestAIUsage());
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    void fetchAIUsage();
    return subscribeToAIUsage(setUsage);
  }, []);

  useEffect(() => {
    if (!usage.limit) return;
    const id = window.setInterval(() => setNowMs(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, [usage.limit, usage.resetsAt]);

  if (!usage.limit) return null;

  const remaining = Math.max(0, usage.limit - usage.used);
  const shortOfCredits = cost != null && remaining < cost;
  let color = 'text-emerald-600 dark:text-emerald-400';
  if (remaining <= 2 || shortOfCredits) color = 'text-red-600 dark:text-red-400';
  else if (remaining <= 5) color = 'text-amber-600 dark:text-amber-400';

  const resetLabel = getAIResetLabel(usage.resetsAt, {
    used: usage.used,
    limit: usage.limit,
    nowMs,
  });
  // One word for the unit — "AI uses", the same as the badge, the same as
  // formatCreditCost. "Requests" here made it read as a third currency.
  const title = `${remaining} of ${usage.limit} AI uses left today · ${resetLabel}`;

  return (
    <span
      className={`inline-flex flex-col items-start gap-0.5 text-xs ${color} ${className}`}
      title={title}
    >
      <span className="inline-flex items-center gap-1">
        <svg className="w-3 h-3 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
        </svg>
        <span className="font-medium">{remaining} left</span>
        {cost != null && (
          <span className="text-label tracking-normal font-normal">
            · costs {formatCreditCost(cost)}
            {shortOfCredits ? ' — not enough left' : ''}
          </span>
        )}
      </span>
      <span className="text-label tracking-normal text-lantern-text-secondary pl-4">{resetLabel}</span>
    </span>
  );
};

export default AIUsageInline;
