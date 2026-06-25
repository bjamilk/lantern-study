import React, { useEffect, useState } from 'react';
import { getAIResetLabel } from '@lantern/shared/utils';
import { subscribeToAIUsage, getLatestAIUsage, AIUsageInfo } from '../services/ai';

/**
 * Compact inline AI usage indicator — "✨ 7 left · Resets in 4h 23m"
 * Color-coded: green (>5), amber (3-5), red (<=2).
 * Use next to AI action buttons.
 */
const AIUsageInline: React.FC<{ className?: string }> = ({ className = '' }) => {
  const [usage, setUsage] = useState<AIUsageInfo>(getLatestAIUsage());
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    return subscribeToAIUsage(setUsage);
  }, []);

  useEffect(() => {
    if (!usage.limit) return;
    const id = window.setInterval(() => setNowMs(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, [usage.limit, usage.resetsAt]);

  if (!usage.limit) return null;

  const remaining = Math.max(0, usage.limit - usage.used);
  let color = 'text-emerald-600 dark:text-emerald-400';
  if (remaining <= 2) color = 'text-red-600 dark:text-red-400';
  else if (remaining <= 5) color = 'text-amber-600 dark:text-amber-400';

  const resetLabel = getAIResetLabel(usage.resetsAt, {
    used: usage.used,
    limit: usage.limit,
    nowMs,
  });
  const title = `${remaining} of ${usage.limit} AI requests remaining · ${resetLabel}`;

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
      </span>
      <span className="text-[10px] text-gray-500 dark:text-gray-400 pl-4">{resetLabel}</span>
    </span>
  );
};

export default AIUsageInline;
