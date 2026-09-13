import React, { useEffect, useRef, useState } from 'react';
import { Button } from '../ui';
import { AppIcon } from '../ui/AppIcon';
import { FEATURE_PANEL_INK_TEXT, FEATURE_TINT_BG } from '../ui/featureClasses';
import {
  formatStudyTimer,
  isStudyTimerExpired,
  isStudyTimerRunning,
  selectStudySetTimer,
  studyTimerAccessibilityLabel,
  studyTimerRemaining,
  STUDY_TIMER_DEFAULT_SECONDS,
  STUDY_TIMER_PRESET_MINUTES,
  useStudySetTimerStore,
} from '../../stores/studySetTimerStore';

interface StudySetTimerProps {
  /** Which set's clock this is. Timers are per-set, exactly as on the phone. */
  setId?: string;
}

/**
 * The idle pill's label: `25m`, not `25:00`.
 *
 * A clock face on a timer that is not running reads as a timer that IS running
 * and stuck at the top — which is precisely the misread the old button produced
 * at the other end (`00:00 Time's up` sitting in the header of a set nobody had
 * timed today). Minutes-only says "this is a length you could pick"; the digits
 * only appear once seconds are actually moving.
 */
export function idleTimerLabel(seconds: number): string {
  const minutes = Math.max(1, Math.round(Math.max(0, seconds) / 60));
  return `${minutes}m`;
}

/**
 * The study timer, as the StudyFetch reference draws it: a butter-yellow pill
 * in the room header that opens a small popover.
 *
 * WHAT WAS WRONG WITH THE OLD ONE. It was a single secondary button rendering
 * `formatStudyTimer(remaining)` plus, when expired, the words `Time's up`. Two
 * consequences, both recorded in the SF2 evidence pass. A set whose last run had
 * ended — hours or days ago — showed `00:00 Time's up` forever, because nothing
 * ever cleared an expired run, so the loudest thing in the header was a nag
 * about a session the student had already finished. And there was no way to
 * study for any length but twenty-five minutes: the only control was a toggle.
 *
 * Now: an EXPIRED run is acknowledged once and then cleared the moment the
 * student opens the popover or starts anything, so `Time's up` is a state a run
 * actually reaches rather than a permanent label. The store still derives every
 * value from `Date.now()` against a stored start instant, so a reload, a shut
 * tab and a dropped tick all still cost nothing.
 *
 * `View stats` from the reference is deliberately NOT here: Lantern has no
 * study-stats screen to open, and a button that goes nowhere is the exact
 * failure mode these audits keep finding.
 */
export const StudySetTimer: React.FC<StudySetTimerProps> = ({ setId = '' }) => {
  const timer = useStudySetTimerStore(selectStudySetTimer(setId));
  const toggle = useStudySetTimerStore((s) => s.toggle);
  const start = useStudySetTimerStore((s) => s.start);
  const reset = useStudySetTimerStore((s) => s.reset);
  const [now, setNow] = useState(() => Date.now());
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const running = isStudyTimerRunning(timer);
  const remaining = studyTimerRemaining(timer, now);
  const expired = isStudyTimerExpired(timer, now);

  useEffect(() => {
    if (!running || remaining <= 0) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [running, remaining <= 0]);

  // A reload lands mid-second; re-read the clock once on mount so the first
  // paint is not up to a second stale.
  useEffect(() => {
    setNow(Date.now());
  }, []);

  // Click-away and Escape, so the popover behaves like every other one in the
  // product rather than trapping the header until something else is clicked.
  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const label = expired ? "Time's up" : running ? formatStudyTimer(remaining) : idleTimerLabel(remaining);

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        onClick={() => {
          // Opening the popover is the acknowledgement: the finished run is
          // cleared here, so the header goes back to an idle length instead of
          // wearing `Time's up` until the next session happens to start.
          if (expired) reset(setId);
          setOpen((value) => !value);
        }}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={studyTimerAccessibilityLabel(timer, now)}
        className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-full border border-lantern-border px-3.5 text-caption font-semibold transition-colors hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lantern-ink/40 ${FEATURE_TINT_BG.recording} ${FEATURE_PANEL_INK_TEXT.recording}`}
      >
        <AppIcon name="time" size={16} />
        <span className="tabular-nums">{label}</span>
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="Study timer"
          className="absolute right-0 z-30 mt-2 w-60 rounded-2xl border border-lantern-border bg-lantern-surface p-4"
        >
          <p className="text-display text-lantern-text tabular-nums text-center">
            {formatStudyTimer(running ? remaining : timer.baseSeconds || STUDY_TIMER_DEFAULT_SECONDS)}
          </p>
          <div className="mt-3 flex gap-2">
            {STUDY_TIMER_PRESET_MINUTES.map((minutes) => {
              const active = !running && Math.round(timer.baseSeconds / 60) === minutes;
              return (
                <button
                  key={minutes}
                  type="button"
                  onClick={() => start(setId, minutes * 60)}
                  aria-pressed={active}
                  className={`flex-1 min-h-[40px] rounded-full border text-caption ${
                    active
                      ? 'border-lantern-text text-lantern-text'
                      : 'border-lantern-border text-lantern-text-secondary hover:border-lantern-text-tertiary'
                  }`}
                >
                  {minutes} min
                </button>
              );
            })}
          </div>
          <Button
            className="mt-3 w-full"
            onClick={() => {
              toggle(setId);
              setNow(Date.now());
            }}
          >
            {running ? 'Pause timer' : 'Start timer'}
          </Button>
          {running || timer.baseSeconds !== STUDY_TIMER_DEFAULT_SECONDS ? (
            <button
              type="button"
              onClick={() => reset(setId)}
              className="mt-2 w-full min-h-[40px] text-caption text-lantern-text-secondary hover:underline"
            >
              Reset to 25 minutes
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};

export default StudySetTimer;
