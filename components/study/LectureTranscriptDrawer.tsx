import React, { useEffect, useRef } from 'react';
import {
  formatLectureClock,
  lectureChunkStampMs,
  lectureDrawerCopy,
  type LectureChunk,
  type LectureDrawerModel,
} from '@lantern/shared';
import { AppIcon } from '../ui/AppIcon';
import type { LecturePreCheck } from '../../hooks/useLecturePreCheck';
import { LectureLevelMeter } from './LectureLevelMeter';
import { LecturePreCheckPanel } from './LecturePreCheckPanel';

/**
 * The TRANSCRIPT DRAWER — the third column of the lecture room.
 *
 * It is one 236px column that changes its contents five times during a lecture
 * (pre-check → consent → recording → saving → done) and never changes its
 * width, its header or its place. Everything about which of those it is showing
 * comes from `lectureDrawerReducer` in `@lantern/shared`, so the phone's
 * Transcript tab is the same machine with different paint, and neither client
 * can reach a state the other has not thought about.
 *
 * WHY THE CHUNK LIST IS NOT `LectureSegmentList`. That component lists the
 * five-minute SEGMENTS the recorder uploads — the unit of resilience and of
 * money. This lists what the lecturer SAID, which is a different unit: a card
 * grows in place while speech continues and a new one starts after a two-second
 * pause, so a 50-minute lecture reads as forty paragraphs rather than ten walls
 * of text. The segment's real transcript replaces its captions when it lands
 * (`applyLectureSegmentToChunks`), so the two never both claim the same minute.
 *
 * TOKENS ONLY. The reference's `#F3F2EC` drawer is `bg-lantern-background-
 * secondary`, its `#EDEBE4` chunk card is the notes tint, its green
 * "Listening…" is `text-lantern-success` and the black pill is
 * `bg-lantern-primary-fill`. No hex reaches this file, and dark mode is
 * whatever those tokens are in dark mode.
 */

export interface LectureTranscriptDrawerProps {
  drawer: LectureDrawerModel;
  preCheck: LecturePreCheck;
  /** The consent tick + honest cost copy the pre-check carries above the meter. */
  consent: React.ReactNode;
  canStart: boolean;
  starting?: boolean;
  chunks: LectureChunk[];
  /** The take is over: stamps become END times. */
  sealed: boolean;
  elapsedMs: number;
  /** Live captions for the chunk in progress, for the "Listening…" line. */
  enhancing?: boolean;
  /** Present when this lecture can be enhanced (the done card's button). */
  onEnhance?: () => void;
  enhanceCost?: string;
  onClose: () => void;
  onOpenSettings: () => void;
  onStart: () => void;
  onConsent: (agreed: boolean) => void;
  onStop: () => void;
  onMinimise: () => void;
  onResume: () => void;
  /** The ⚙ popover, rendered by the studio so this file owns no settings state. */
  settings?: React.ReactNode;
}

/** 40px mono stamp column, `text-caption`, secondary ink — measured. */
const StampedCard: React.FC<{ stamp: string; children: React.ReactNode }> = ({
  stamp,
  children,
}) => (
  <li className="flex gap-2">
    <span className="w-10 shrink-0 pt-2 font-mono text-caption tabular-nums text-lantern-text-secondary">
      {stamp}
    </span>
    <span className="min-w-0 flex-1 rounded-xl bg-lantern-feature-notes-tint p-2 text-body text-lantern-text whitespace-pre-wrap">
      {children}
    </span>
  </li>
);

/** The black recording pill: level · mm:ss · red stop. 176×46, measured. */
export const LectureRecordingPill: React.FC<{
  elapsedMs: number;
  levelDb: number | null;
  onStop: () => void;
}> = ({ elapsedMs, levelDb, onStop }) => (
  <div className="flex h-[46px] w-[176px] items-center justify-between gap-2 rounded-full bg-lantern-primary-fill px-3">
    <LectureLevelMeter levelDb={levelDb} size="sm" label="Input level" tone="onInk" />
    <span className="font-mono text-caption tabular-nums text-white">
      {formatLectureClock(elapsedMs)}
    </span>
    <button
      type="button"
      onClick={onStop}
      aria-label={lectureDrawerCopy.stop}
      title={lectureDrawerCopy.stop}
      className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-lantern-error-strong text-white"
    >
      <AppIcon name="stop" size={16} />
    </button>
  </div>
);

export const LectureTranscriptDrawer: React.FC<LectureTranscriptDrawerProps> = ({
  drawer,
  preCheck,
  consent,
  canStart,
  starting,
  chunks,
  sealed,
  elapsedMs,
  enhancing,
  onEnhance,
  enhanceCost,
  onClose,
  onOpenSettings,
  onStart,
  onConsent,
  onStop,
  onMinimise,
  onResume,
  settings,
}) => {
  const listRef = useRef<HTMLDivElement | null>(null);

  // Follow the lecture. Only while recording: scrolling a finished transcript
  // out from under the student reading it is the opposite of helpful.
  useEffect(() => {
    if (drawer.step !== 'recording') return;
    const node = listRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [drawer.step, chunks]);

  const recording = drawer.step === 'recording';

  return (
    <div className="flex h-full min-h-0 flex-col rounded-lantern-lg bg-lantern-background-secondary">
      {/* HEADER — × and ⚙ on the left, the title on the right (measured). */}
      <div className="flex shrink-0 items-center gap-1 px-2 py-1">
        <button
          type="button"
          onClick={onClose}
          aria-label={lectureDrawerCopy.close}
          title={lectureDrawerCopy.close}
          className="inline-flex h-11 w-11 items-center justify-center rounded-full text-lantern-text-secondary hover:text-lantern-text"
        >
          <AppIcon name="close" size={18} />
        </button>
        <button
          type="button"
          onClick={onOpenSettings}
          aria-label={lectureDrawerCopy.settings}
          title={lectureDrawerCopy.settings}
          className="inline-flex h-11 w-11 items-center justify-center rounded-full text-lantern-text-secondary hover:text-lantern-text"
        >
          <AppIcon name="settings" size={18} />
        </button>
        <h2 className="ml-auto pr-2 text-title font-semibold text-lantern-text">
          {lectureDrawerCopy.title}
        </h2>
      </div>

      {settings ? <div className="shrink-0 px-2 pb-2">{settings}</div> : null}

      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {drawer.step === 'precheck' ? (
          <LecturePreCheckPanel
            preCheck={preCheck}
            canStart={canStart}
            starting={starting}
            onOpenSettings={onOpenSettings}
            onStart={onStart}
            consent={consent}
          />
        ) : null}

        {drawer.step === 'consent' ? (
          <div
            className="space-y-3 rounded-lantern-lg bg-lantern-surface p-3 text-center"
            role="group"
            aria-label={lectureDrawerCopy.consentTitle}
          >
            <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-lantern-feature-recording-tint">
              <AppIcon
                name="hand-left"
                size={22}
                className="text-lantern-feature-recording-ink"
              />
            </span>
            <h3 className="text-heading text-lantern-text">{lectureDrawerCopy.consentTitle}</h3>
            <p className="text-body text-lantern-text-secondary">
              {lectureDrawerCopy.consentBody}
            </p>
            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={() => onConsent(true)}
                className="min-h-[44px] rounded-full bg-lantern-primary-fill px-3 text-body font-medium text-white"
              >
                {lectureDrawerCopy.consentYes}
              </button>
              <button
                type="button"
                onClick={() => onConsent(false)}
                className="min-h-[44px] rounded-full border border-lantern-border bg-lantern-surface px-3 text-body font-medium text-lantern-text"
              >
                {lectureDrawerCopy.consentNo}
              </button>
            </div>
          </div>
        ) : null}

        {drawer.step === 'recording' || drawer.step === 'saving' || drawer.step === 'done' ? (
          <div className="space-y-3">
            <ol className="space-y-2">
              {chunks.map((chunk) => (
                <StampedCard
                  key={chunk.id}
                  stamp={formatLectureClock(lectureChunkStampMs(chunk, sealed))}
                >
                  {chunk.text}
                </StampedCard>
              ))}
            </ol>

            {recording ? (
              <p className="text-caption font-medium text-lantern-success" aria-live="polite">
                {lectureDrawerCopy.listening}
              </p>
            ) : null}

            {chunks.length === 0 && recording ? (
              <p className="text-caption text-lantern-text-secondary">
                The words appear here as the lecture goes on.
              </p>
            ) : null}

            {drawer.step === 'saving' ? (
              <div className="rounded-lantern-lg bg-lantern-surface p-3" aria-live="polite">
                <p className="text-body font-semibold text-lantern-text">
                  {lectureDrawerCopy.savingTitle}
                </p>
                <p className="mt-1 text-caption text-lantern-text-secondary">
                  {lectureDrawerCopy.savingBody}
                </p>
                <button
                  type="button"
                  disabled
                  className="mt-2 min-h-[44px] rounded-full border border-lantern-border px-3 text-body text-lantern-text-tertiary opacity-60"
                >
                  🎙 {lectureDrawerCopy.resume}
                </button>
              </div>
            ) : null}

            {drawer.step === 'done' ? (
              <>
                <div className="rounded-lantern-lg bg-lantern-surface p-3">
                  <p className="text-body font-semibold text-lantern-text">
                    {lectureDrawerCopy.doneTitle}
                  </p>
                  <button
                    type="button"
                    onClick={onEnhance}
                    disabled={!onEnhance || enhancing}
                    className="mt-2 min-h-[44px] w-full rounded-full bg-lantern-primary-fill px-3 text-body font-medium text-white disabled:opacity-50"
                  >
                    {enhancing
                      ? '⟳ Generating…'
                      : `✨ Enhance notes${enhanceCost ? ` · ${enhanceCost}` : ''}`}
                  </button>
                </div>
                <div className="flex flex-wrap items-center gap-2 rounded-lantern-lg bg-lantern-surface p-3">
                  <span className="text-caption text-lantern-text-secondary">
                    🎙 {preCheck.quality.label}
                  </span>
                  <span className="text-caption text-lantern-text-secondary">
                    📶 {preCheck.internet.label}
                  </span>
                  <button
                    type="button"
                    onClick={onResume}
                    className="ml-auto min-h-[44px] rounded-full border border-lantern-border bg-lantern-surface px-3 text-body font-medium text-lantern-text"
                  >
                    🎙 {lectureDrawerCopy.resume}
                  </button>
                </div>
              </>
            ) : null}
          </div>
        ) : null}
      </div>

      {recording ? (
        <div className="flex shrink-0 flex-col items-center gap-1 px-2 pb-3">
          <LectureRecordingPill elapsedMs={elapsedMs} levelDb={preCheck.levelDb} onStop={onStop} />
          <button
            type="button"
            onClick={onMinimise}
            className="min-h-[44px] text-caption text-lantern-text-secondary hover:text-lantern-text"
          >
            {lectureDrawerCopy.minimise}
          </button>
        </div>
      ) : null}
    </div>
  );
};

/**
 * The minimised widget — the drawer folded into 120×56 at the bottom-right of
 * the editor, so a student who wants the whole screen for their notes still has
 * the clock, the level and the stop button in reach.
 */
export const LectureMinimisedWidget: React.FC<{
  elapsedMs: number;
  levelDb: number | null;
  qualityLabel: string;
  onStop: () => void;
  onExpand: () => void;
}> = ({ elapsedMs, levelDb, qualityLabel, onStop, onExpand }) => (
  <div className="flex w-[120px] flex-col gap-1 rounded-xl bg-lantern-primary-fill p-2 shadow-lantern-md">
    <div className="flex items-center gap-1">
      <span className="text-caption text-white/80">{qualityLabel}</span>
      <LectureLevelMeter levelDb={levelDb} size="sm" label="Input level" tone="onInk" />
    </div>
    <div className="flex items-center gap-1">
      <span className="font-mono text-caption tabular-nums text-white">
        {formatLectureClock(elapsedMs)}
      </span>
      <button
        type="button"
        onClick={onStop}
        aria-label={lectureDrawerCopy.stop}
        title={lectureDrawerCopy.stop}
        className="ml-auto inline-flex h-6 w-6 items-center justify-center rounded-full bg-lantern-error-strong text-white"
      >
        <AppIcon name="stop" size={12} />
      </button>
      <button
        type="button"
        onClick={onExpand}
        aria-label={lectureDrawerCopy.expand}
        title={lectureDrawerCopy.expand}
        className="inline-flex h-6 w-6 items-center justify-center rounded-full text-white"
      >
        <AppIcon name="expand" size={12} />
      </button>
    </div>
  </div>
);

export default LectureTranscriptDrawer;
