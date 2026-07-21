import React, { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { FEATURE_TIP_CATALOG, type FeatureTipId } from '@lantern/shared/featureTips';
import { useModalFocusTrap } from '../../hooks/useModalFocusTrap';
import { getTipCopy, useFeatureTipStore } from '../../stores/featureTipStore';

interface FeatureTipProps {
  tipId: FeatureTipId;
  /** CSS selector or we find [data-tip-id="..."] */
  anchorSelector?: string;
  reduceMotion?: boolean;
}

type Position = {
  top: number;
  left: number;
  placement: 'below' | 'above';
  arrowOffsetX: number;
};

const VIEW_MARGIN = 12;
/** Keep tips clear of mobile bottom nav (+ optional cookie strip). */
const BOTTOM_CHROME_RESERVE = 72;
const TIP_GAP = 10;
const ESTIMATED_TIP_HEIGHT = 200;

function getAnchorRect(tipId: FeatureTipId, selector?: string): DOMRect | null {
  const el =
    (selector ? document.querySelector(selector) : null) ||
    document.querySelector(`[data-tip-id="${tipId}"]`);
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return null;
  return rect;
}

/**
 * Place the tip fully inside the viewport. `left`/`top` are the top-left of the tip panel
 * (no CSS translate), so text never clips at the screen edge.
 */
function placeTip(
  tipId: FeatureTipId,
  tipWidth: number,
  tipHeight: number,
  selector?: string
): Position | null {
  const rect = getAnchorRect(tipId, selector);
  if (!rect) return null;

  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const bottomReserve = vw < 768 ? BOTTOM_CHROME_RESERVE : VIEW_MARGIN;
  const width = Math.min(tipWidth || 320, vw - VIEW_MARGIN * 2);
  const height = Math.min(
    tipHeight || ESTIMATED_TIP_HEIGHT,
    vh - VIEW_MARGIN - bottomReserve
  );

  const spaceBelow = vh - bottomReserve - rect.bottom - TIP_GAP;
  const spaceAbove = rect.top - TIP_GAP;
  const placement: 'below' | 'above' =
    spaceBelow >= height || spaceBelow >= spaceAbove ? 'below' : 'above';

  let top =
    placement === 'below'
      ? rect.bottom + TIP_GAP
      : rect.top - TIP_GAP - height;
  top = Math.max(VIEW_MARGIN, Math.min(top, vh - height - bottomReserve));

  const anchorCenterX = rect.left + rect.width / 2;
  let left = anchorCenterX - width / 2;
  left = Math.max(VIEW_MARGIN, Math.min(left, vw - width - VIEW_MARGIN));

  // Keep the caret pointed toward the anchor even after horizontal clamping.
  const arrowOffsetX = Math.max(16, Math.min(width - 16, anchorCenterX - left));

  return { top, left, placement, arrowOffsetX };
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
  const [cookieBlocking, setCookieBlocking] = useState(false);
  // Coach-mark overlays the UI with interactive controls — trap focus while visible.
  const tipTrapRef = useModalFocusTrap(visible && !cookieBlocking, () => dismiss(tipId));

  useEffect(() => {
    if (!visible) {
      setCookieBlocking(false);
      return;
    }
    const check = () => {
      setCookieBlocking(Boolean(document.querySelector('[aria-label="Cookie notice"]')));
    };
    check();
    const id = window.setInterval(check, 400);
    return () => window.clearInterval(id);
  }, [visible]);

  useLayoutEffect(() => {
    if (!visible || cookieBlocking) {
      setPos(null);
      return;
    }

    const update = () => {
      const panel = tipTrapRef.current;
      const measuredW = panel?.offsetWidth || Math.min(320, window.innerWidth - VIEW_MARGIN * 2);
      const measuredH = panel?.offsetHeight || ESTIMATED_TIP_HEIGHT;
      const next = placeTip(tipId, measuredW, measuredH, anchorSelector);
      setPos((prev) => {
        if (
          prev &&
          next &&
          prev.top === next.top &&
          prev.left === next.left &&
          prev.placement === next.placement &&
          prev.arrowOffsetX === next.arrowOffsetX
        ) {
          return prev;
        }
        return next;
      });
    };

    update();
    // Re-measure after paint so real tip height is used for clamping.
    const raf = window.requestAnimationFrame(update);
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [visible, cookieBlocking, tipId, anchorSelector, tipsVersion, tipTrapRef]);

  if (!visible || !copy || cookieBlocking) return null;

  return (
    <div
      ref={tipTrapRef}
      className="fixed z-[90] pointer-events-none"
      style={
        pos
          ? { top: pos.top, left: pos.left }
          : { top: VIEW_MARGIN, left: VIEW_MARGIN, visibility: 'hidden' }
      }
      role="dialog"
      aria-modal="true"
      aria-label={copy.title}
    >
      <div
        className={`pointer-events-auto w-[min(20rem,calc(100vw-1.5rem))] max-h-[min(22rem,calc(100vh-5.5rem))] overflow-y-auto overscroll-contain rounded-xl border border-lantern-primary/40 bg-lantern-surface shadow-xl p-3.5 ${
          reduceMotion ? '' : 'animate-in fade-in zoom-in-95 duration-200'
        }`}
      >
        {pos && (
          <div
            className={`absolute w-2.5 h-2.5 bg-lantern-surface border-lantern-primary/40 ${
              pos.placement === 'below'
                ? '-top-1.5 border-l border-t'
                : '-bottom-1.5 border-r border-b'
            }`}
            style={{ left: pos.arrowOffsetX, transform: 'translateX(-50%) rotate(45deg)' }}
            aria-hidden
          />
        )}
        <p className="text-sm font-semibold text-lantern-text mb-1">{copy.title}</p>
        <p className="text-xs text-lantern-text-secondary leading-relaxed mb-3 break-words">{copy.body}</p>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="min-h-10 px-3 py-2 text-xs font-medium rounded-md bg-lantern-primary text-white hover:opacity-90"
            onClick={() => dismiss(tipId)}
          >
            {copy.gotItLabel || 'Got it'}
          </button>
          <button
            type="button"
            className="min-h-10 px-2 py-2 text-xs font-medium rounded-md text-lantern-text-secondary hover:bg-lantern-background-secondary"
            onClick={() => dontShowAgain()}
          >
            {copy.dontShowAgainLabel || "Don't show again"}
          </button>
          <button
            type="button"
            className="ml-auto min-h-10 px-2 py-2 text-xs text-lantern-text-tertiary hover:text-lantern-text-secondary"
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
