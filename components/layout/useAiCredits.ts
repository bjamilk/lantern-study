import { useEffect, useState } from 'react';
import { getLatestAIUsage, subscribeToAIUsage, type AIUsageInfo } from '../../services/ai';

/**
 * Remaining AI credits, or `null` while the limit is unknown.
 *
 * "AI credits" is the one string for this everywhere. The nav shows the number
 * on the Lantern AI entry itself, which is what replaced the floating credit
 * pill: a count that follows you belongs on the thing it counts, not on a
 * separate object drifting over the content.
 */
export function useAiCredits(): number | null {
  const [usage, setUsage] = useState<AIUsageInfo>(getLatestAIUsage());
  useEffect(() => subscribeToAIUsage(setUsage), []);
  if (!usage.limit) return null;
  return Math.max(0, usage.limit - usage.used);
}
