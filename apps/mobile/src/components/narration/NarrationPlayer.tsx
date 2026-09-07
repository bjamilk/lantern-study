/**
 * The reading itself: a page, the paragraph being spoken, and four controls.
 *
 * This component owns the SPEECH ENGINE and nothing else. The cursor is the
 * shared reducer (`@lantern/shared/notes/narrationPlayer`), the script is
 * fetched by the screen above it, and every decision this file makes is forced
 * by what `expo-speech` actually is. Four of those are worth stating, because
 * each one is a place a plausible implementation goes wrong:
 *
 * 1. THE HIGHLIGHT IS DRIVEN BY `onDone`, NOT `onBoundary`. `expo-speech`
 *    exposes word boundaries, and on iOS they arrive. On Android they depend
 *    entirely on the installed TTS engine: Google's fires them, several OEM and
 *    offline engines never fire them at all, and a couple fire once at the
 *    start. A highlight driven by boundaries would therefore work on the test
 *    phone and freeze on a student's. So exactly ONE utterance is queued at a
 *    time — one segment — and the cursor moves when that utterance reports
 *    done. The highlight is then always exactly right, on every engine, and the
 *    grain is a paragraph rather than a word.
 * 2. PAUSE IS STOP. `Speech.pause`/`resume` are iOS-only; on Android they are
 *    no-ops. Rather than a control that works on half the phones, pause stops
 *    the utterance and play speaks the same paragraph again from its start.
 *    The UI says so ("picks up from the start of this paragraph") instead of
 *    letting a student discover it.
 * 3. A STALE `onDone` MUST NOT ADVANCE ANYTHING. `Speech.stop()` fires the
 *    callbacks of the utterance it cancelled, so a pause, a skip and a screen
 *    exit all arrive as "done". Every utterance is tagged with a token; a
 *    callback whose token is no longer the live one is dropped, and the reducer
 *    ignores `segmentDone` unless it is playing. Two guards, because this bug
 *    is silent and looks exactly like a deck that skips a page at random.
 * 4. THE SCREEN STAYS AWAKE WHILE PLAYING, and speech STOPS when the app is
 *    backgrounded. `expo-speech` is not a background audio session. Rather than
 *    letting a student pocket the phone and come back to silence, the player
 *    prints `NARRATION_FOREGROUND_NOTICE` and cuts cleanly on background. The
 *    notice's wake-lock half is true because of the `activateKeepAwakeAsync`
 *    effect below — if that effect ever goes, the sentence has to go with it.
 * 5. A PHONE MAY HAVE NO VOICE AT ALL, and an engine may refuse a paragraph.
 *    On Android the TTS engine is a separate installable app, so
 *    `Speech.speak` on a phone without one does nothing and calls `onError`.
 *    This file used to map `onError` onto `segmentDone`, which meant such a
 *    phone raced through the whole document in milliseconds and settled on
 *    "Finished" having made no sound — the worst kind of failure, because it
 *    looks like success. Now availability is PROBED before the first play and
 *    said plainly, and `onError` dispatches `speechError`, which stops the
 *    cursor on the failing paragraph rather than walking past it.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Pressable, ScrollView, View, type AppStateStatus } from 'react-native';
import * as Speech from 'expo-speech';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { Body, Caption, IconButton } from '../ui';
import { AppIcon } from '../ui/AppIcon';
import { useTheme } from '../../theme';
import { typeScale } from '../../design/typeScale';
import {
  DEFAULT_NARRATION_RATE,
  NARRATION_FOREGROUND_NOTICE,
  NARRATION_RATES,
  currentPageIndex,
  initialNarrationState,
  narrationPositionLabel,
  narrationReducer,
  nextPageSegment,
  prevPageSegment,
  type NarrationAction,
  type NarrationPlayerState,
} from '@lantern/shared/notes/narrationPlayer';
import type { NarrationScriptSegment } from '../../services/narration';
import { NarrationPageFrame } from './NarrationPageFrame';
import {
  NARRATION_NO_VOICE_COPY,
  narrationSpeechErrorCopy,
  probeSpeechAvailability,
  type SpeechAvailability,
} from './narrationModel';

/** One tag for the whole feature, so a remount cannot leak a second lock. */
const KEEP_AWAKE_TAG = 'lantern-narration';

export interface NarrationPlayerProps {
  segments: NarrationScriptSegment[];
  /** Pages the SCRIPT covers — not what the document has. */
  pageCount: number;
  /**
   * Page pictures by page index, when the screen has them. Optional and
   * expected to be missing: the URLs are short-lived and signed, so an offline
   * replay has the words and no pictures, which the frame says out loud.
   */
  pageImages?: Record<number, string | undefined>;
  /** Page text by page index — the offline fallback, and the a11y content. */
  pageTexts?: Record<number, string | undefined>;
  /** Where to start. A walk-through hands its current page in. */
  initialPageIndex?: number;
  /** Told the page whenever the reading moves, so a host can follow along. */
  onPageChange?: (pageIndex: number) => void;
}

export function NarrationPlayer({
  segments,
  pageCount,
  pageImages,
  pageTexts,
  initialPageIndex,
  onPageChange,
}: NarrationPlayerProps) {
  const { colors } = useTheme();
  const [state, setState] = useState<NarrationPlayerState>(() => {
    const base = initialNarrationState(DEFAULT_NARRATION_RATE);
    if (typeof initialPageIndex !== 'number') return base;
    const at = segments.findIndex((segment) => segment.pageIndex === initialPageIndex);
    return at > 0 ? { ...base, index: at } : base;
  });

  /**
   * Can this phone speak at all? Probed once, before anything is offered.
   *
   * `Speech.speak` has no return value and no success callback, so the ONLY
   * way to know a voiceless phone from a working one before pressing play is
   * to ask for the voice list. An empty list, a rejection and a probe that
   * never answers all mean no engine, and `probeSpeechAvailability` folds the
   * three into one answer.
   */
  const [availability, setAvailability] = useState<SpeechAvailability>('unknown');

  useEffect(() => {
    let alive = true;
    // Bounded: on an Android phone with no engine the native probe never
    // settles at all (it waits for an engine init that never reports), and an
    // unbounded wait here is a play button disabled forever with no reason.
    void probeSpeechAvailability(() => Speech.getAvailableVoicesAsync()).then((answer) => {
      if (alive) setAvailability(answer);
    });
    return () => {
      alive = false;
    };
  }, []);

  const total = segments.length;
  const dispatch = useCallback(
    (action: NarrationAction) => setState((prev) => narrationReducer(prev, action, total)),
    [total]
  );

  // The live utterance's token. Every callback carries the token it was
  // spoken with; a callback from a cancelled utterance is dropped (see 3).
  const tokenRef = useRef(0);
  const stateRef = useRef(state);
  stateRef.current = state;

  const playing = state.status === 'playing';

  // Awake only WHILE reading, which is why this is the imperative API rather
  // than `useKeepAwake` — that hook holds the lock for the component's whole
  // life, so a paused player left on screen would burn a student's battery
  // saying nothing. Both calls are fire-and-forget: a device that refuses the
  // lock (some Android OEM power modes do) must not break playback.
  useEffect(() => {
    if (!playing) return;
    void activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => undefined);
    return () => {
      try {
        deactivateKeepAwake(KEEP_AWAKE_TAG);
      } catch {
        /* the screen going to sleep on its own is not worth an error */
      }
    };
  }, [playing]);

  const segment = total ? segments[Math.min(state.index, total - 1)] : undefined;
  const pageIndex = currentPageIndex(segments, state.index);

  useEffect(() => {
    onPageChange?.(pageIndex);
  }, [pageIndex, onPageChange]);

  /* ---------------------------------------------------------- the engine -- */

  const stopSpeaking = useCallback(() => {
    // Bumping the token FIRST is what makes the cancel silent: the callbacks
    // `Speech.stop()` is about to fire are already stale by the time they land.
    tokenRef.current += 1;
    void Speech.stop();
  }, []);

  useEffect(() => {
    // `canSpeak` is in the guard as well as in the UI: a play dispatched from
    // anywhere — a restored state, a host screen, a future control — must not
    // reach an engine that is not there, because a silent `speak` whose
    // `onError` we then treat as progress is exactly the bug this lane fixes.
    if (!playing || !segment || availability !== 'available') {
      stopSpeaking();
      return;
    }
    tokenRef.current += 1;
    const token = tokenRef.current;
    Speech.speak(segment.text, {
      rate: state.rate,
      onDone: () => {
        if (tokenRef.current !== token) return;
        dispatch({ type: 'segmentDone' });
      },
      onStopped: () => {
        // A deliberate stop. The cursor is owned by whoever called it.
      },
      onError: () => {
        if (tokenRef.current !== token) return;
        // STOP here, do not advance. Treating a refusal as a completion is how
        // a phone with a broken or missing voice sprints to "Finished" without
        // a sound. The reducer parks on this paragraph with a reason, play
        // retries the same one, and a second failure on it changes nothing —
        // so two errors in a row cannot spin the deck.
        dispatch({
          type: 'speechError',
          reason: 'This phone could not read that paragraph out loud.',
        });
      },
    });
    return () => {
      tokenRef.current += 1;
      void Speech.stop();
    };
    // `state.index` is what re-speaks: the effect re-runs per segment, which is
    // the one-utterance-at-a-time rule from (1) expressed as a dependency list.
  }, [playing, state.index, state.rate, segment, availability, dispatch, stopSpeaking]);

  // Backgrounding cuts the voice (4). Nothing resumes on return: the student
  // pressed nothing, so the deck waits where it stopped.
  useEffect(() => {
    const onChange = (next: AppStateStatus) => {
      if (next !== 'active' && stateRef.current.status === 'playing') {
        dispatch({ type: 'pause' });
      }
    };
    const subscription = AppState.addEventListener('change', onChange);
    return () => subscription.remove();
  }, [dispatch]);

  useEffect(() => () => stopSpeaking(), [stopSpeaking]);

  /* ------------------------------------------------------------- the UI -- */

  const position = useMemo(
    () => narrationPositionLabel(segments, state.index, pageCount),
    [segments, state.index, pageCount]
  );

  if (!total) {
    return (
      <View className="p-6 rounded-lantern-xl border border-lantern-border bg-lantern-surface items-center">
        <AppIcon name="volume-mute" size={22} color={colors.textSecondary} />
        <Caption tone="secondary" className="mt-2 text-center">
          There is nothing to read in this document.
        </Caption>
      </View>
    );
  }

  const atStart = state.index === 0;
  const atEnd = state.status === 'ended';
  const noVoice = availability === 'none';
  const probing = availability === 'unknown';
  const errored = state.status === 'error';
  const errorCopy = errored ? narrationSpeechErrorCopy(state.errorReason) : null;

  return (
    <View>
      <NarrationPageFrame
        pageIndex={pageIndex}
        imageUrl={pageImages?.[pageIndex]}
        text={pageTexts?.[pageIndex]}
      />

      {/* The paragraph being spoken, highlighted. The grain is a paragraph
          rather than a word because that is the grain the engine reports
          honestly on every phone (1). */}
      <ScrollView
        style={{ maxHeight: 160 }}
        className="mt-3 p-4 rounded-lantern-xl border border-lantern-primary bg-lantern-surface"
        accessibilityLabel={
          noVoice
            ? `This paragraph. ${segment?.text || ''}`
            : `Now reading. ${segment?.text || ''}`
        }
      >
        <Body style={{ ...typeScale.body, color: colors.text }}>{segment?.text || ''}</Body>
      </ScrollView>

      <View className="flex-row items-center justify-between mt-3">
        <Caption tone="secondary">{position}</Caption>
        <Caption tone="secondary">
          {noVoice
            ? 'Not read aloud'
            : errored
              ? 'Stopped'
              : atEnd
                ? 'Finished'
                : playing
                  ? 'Reading'
                  : 'Paused'}
        </Caption>
      </View>

      {/* A phone with no TTS engine. Said before the controls, and INSTEAD of a
          play button — an inert play button is the thing that made this failure
          look like success. The page and its words are still on screen above,
          so the document is still readable; only the voice is missing. */}
      {noVoice && (
        <View className="mt-3 p-4 rounded-lantern-xl border border-lantern-border bg-lantern-surface">
          <View className="flex-row items-center gap-2">
            <AppIcon name="volume-mute" size={18} color={colors.textSecondary} />
            <Caption tone="secondary" style={{ fontWeight: '600' }}>
              {NARRATION_NO_VOICE_COPY.title}
            </Caption>
          </View>
          <Caption tone="secondary" className="mt-1">
            {NARRATION_NO_VOICE_COPY.detail}
          </Caption>
        </View>
      )}

      {/* One paragraph the engine refused. The deck is stopped ON it — play is
          a retry of the same words, and the page buttons step past it. */}
      {errorCopy && (
        <View className="mt-3 p-4 rounded-lantern-xl border border-lantern-border bg-lantern-surface">
          <Caption tone="secondary" style={{ fontWeight: '600' }}>
            {errorCopy.title}
          </Caption>
          <Caption tone="secondary" className="mt-1">
            {`${errorCopy.detail} Press play to try it again, or skip to the next page.`}
          </Caption>
        </View>
      )}

      <View className="flex-row items-center justify-center gap-2 mt-2">
        <IconButton
          icon="chevron-back"
          accessibilityLabel="Previous page"
          disabled={atStart && !atEnd}
          onPress={() => dispatch({ type: 'seek', index: prevPageSegment(segments, state.index) })}
        />
        {/* No play button at all when there is no voice: a control that cannot
            do its job is worse than no control. While the probe is still out
            it is present but disabled, which is a fraction of a second. */}
        {!noVoice && (
          <IconButton
            icon={playing ? 'pause-circle' : 'play-circle'}
            size={44}
            padding={4}
            color={colors.primary}
            disabled={probing}
            accessibilityLabel={
              playing
                ? 'Pause reading'
                : errored
                  ? 'Try this paragraph again'
                  : atEnd
                    ? 'Read again'
                    : 'Play reading'
            }
            onPress={() => dispatch({ type: 'toggle' })}
          />
        )}
        <IconButton
          icon="chevron-forward"
          accessibilityLabel="Next page"
          disabled={atEnd}
          onPress={() => dispatch({ type: 'seek', index: nextPageSegment(segments, state.index) })}
        />
      </View>

      {/* Speed. Four steps rather than a slider, and changing it re-speaks the
          CURRENT paragraph — no engine can retune an utterance in flight.
          Hidden with no voice: a speed control over silence is furniture. */}
      {!noVoice && (
      <View className="flex-row items-center justify-center gap-1.5 mt-3">
        <Caption tone="secondary" className="mr-1">
          Speed
        </Caption>
        {NARRATION_RATES.map((rate) => (
          <SpeedChip
            key={rate}
            rate={rate}
            selected={state.rate === rate}
            onPress={() => dispatch({ type: 'setRate', rate })}
          />
        ))}
      </View>
      )}

      {/* Both notices describe playing, so neither is printed on a phone that
          cannot play. The wake-lock half of the foreground notice is true here:
          the effect above holds `expo-keep-awake` for exactly as long as the
          player is reading. */}
      {!noVoice && (
        <>
          <Caption tone="secondary" className="mt-3 text-center">
            {NARRATION_FOREGROUND_NOTICE}
          </Caption>
          <Caption tone="secondary" className="mt-1 text-center">
            Play picks up from the start of this paragraph — phones cannot resume a
            sentence mid-way.
          </Caption>
        </>
      )}
    </View>
  );
}

function SpeedChip({
  rate,
  selected,
  onPress,
}: {
  rate: number;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={`Speed ${rate} times`}
      hitSlop={8}
      className={`px-2.5 py-1 rounded-full border ${
        selected ? 'bg-lantern-primary border-lantern-primary' : 'border-lantern-border'
      }`}
    >
      {/* White on the primary fill is the Button primitive's own rule
          (`text-white`, gated by the contrast check on primaryFill); the
          unselected chip is ordinary secondary ink. No hex anywhere. */}
      <Caption
        importantForAccessibility="no"
        tone="secondary"
        className={selected ? 'text-white' : undefined}
        style={{ fontWeight: '600' }}
      >
        {`${rate}x`}
      </Caption>
    </Pressable>
  );
}

export default NarrationPlayer;
