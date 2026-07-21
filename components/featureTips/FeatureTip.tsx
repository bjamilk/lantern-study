import React, { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { FEATURE_TIP_CATALOG, type FeatureTipId } from '@lantern/shared/featureTips';
import { getTipCopy, useFeatureTipStore } from '../../stores/featureTipStore';

interface FeatureTipProps {
  tipId: FeatureTipId;
  /** CSS selector or we find [data-tip-id="..."] */
  anchorSelector?: string;
  reduceMotion?: boolean;
}

type Position = { top: number; left: number; placement: 'below' | 'above' };

function measureAnchor(tipId: FeatureTipId, selector?: string): Position | null {
  const el =
    (selector ? document.querySelector(selector) : null) ||
    document.querySelector(`[data-tip-id="${tipId}"]`);
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return null;

  const spaceBelow = window.innerHeight - rect.bottom;
  const placement: 'below' | 'above' = spaceBelow < 160 ? 'above' : 'below';
  const top = placement === 'below' ? rect.bottom + 10 : rect.top - 10;
  const left = Math.min(
    Math.max(16, rect.left + rect.width / 2),
    window.innerWidth - 16
  );
  return { top, left, placement };
}

/**
 * Anchored coach-mark callout. Only one tip renders at a time (controlled by store).
 */
export const FeatureTip: React.FC<FeatureTipProps> = ({
  tipId,
  anchorSelector,
  reduceMotion = false,
}) => {
  const activeTipId = useFeatureTipStore((s) => s.activeTipId);
  const tipsVersion = useFeatureTipStore((s) => s.tips);
  const dismiss = useFeatureTipStore((s) => s.dismiss);
  const skipAll = useFeatureTipStore((s) => s.skipAll);
  const dontShowAgain = useFeatureTipStore((s) => s.dontShowAgain);

  const visible = activeTipId === tipId;
  const copy = useMemo(() => getTipCopy(tipId) || FEATURE_TIP_CATALOG[tipId], [tipId]);

  const [pos, setPos] = useState<Position | null>(null);

  useLayoutEffect(() => {
    if (!visible) {
      setPos(null);
      return;
    }
    const update = () => setPos(measureAnchor(tipId, anchorSelector));
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [visible, tipId, anchorSelector, tipsVersion]);

  if (!visible || !copy || !pos) return null;

  const transform =
    pos.placement === 'below'
      ? 'translate(-50%, 0)'
      : 'translate(-50%, -100%)';

  return (
    <div
      className="fixed z-[90] pointer-events-none"
      style={{ top: pos.top, left: pos.left, transform }}
      role="dialog"
      aria-label={copy.title}
    >
      <div
        className={`pointer-events-auto w-[min(20rem,calc(100vw-2rem))] rounded-xl border border-lantern-primary/40 bg-lantern-surface shadow-xl p-3.5 ${
          reduceMotion ? '' : 'animate-in fade-in zoom-in-95 duration-200'
        }`}
      >
        <div
          className={`absolute left-1/2 -translate-x-1/2 w-2.5 h-2.5 rotate-45 bg-lantern-surface border-lantern-primary/40 ${
            pos.placement === 'below'
              ? '-top-1.5 border-l border-t'
              : '-bottom-1.5 border-r border-b'
          }`}
          aria-hidden
        />
        <p className="text-sm font-semibold text-lantern-text mb-1">{copy.title}</p>
        <p className="text-xs text-lantern-text-secondary leading-relaxed mb-3">{copy.body}</p>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="px-3 py-1.5 text-xs font-medium rounded-md bg-lantern-primary text-white hover:opacity-90"
            onClick={() => dismiss(tipId)}
          >
            {copy.gotItLabel || 'Got it'}
          </button>
          <button
            type="button"
            className="px-2 py-1.5 text-xs font-medium rounded-md text-lantern-text-secondary hover:bg-lantern-background-secondary"
            onClick={() => dontShowAgain()}
          >
            {copy.dontShowAgainLabel || "Don't show again"}
          </button>
          <button
            type="button"
            className="ml-auto px-2 py-1.5 text-xs text-lantern-text-tertiary hover:text-lantern-text-secondary"
            onClick={() => skipAll()}
          >
            Skip all
          </button>
        </div>
      </div>
    </div>
  );
};

/** Registers a tip as ready while mounted (surface visible). */
export function useRegisterFeatureTip(
  tipId: FeatureTipId,
  ready: boolean,
  allowed: boolean = true
) {
  const setTipReady = useFeatureTipStore((s) => s.setTipReady);
  const setTipAllowed = useFeatureTipStore((s) => s.setTipAllowed);

  useEffect(() => {
    setTipReady(tipId, ready);
    setTipAllowed(tipId, allowed);
    return () => {
      setTipReady(tipId, false);
    };
  }, [tipId, ready, allowed, setTipReady, setTipAllowed]);
}

export default FeatureTip;
