import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';

import { AppIcon } from '../ui/AppIcon';
import { FeatureDisc } from '../ui/FeatureDisc';
import Modal from '../ui/Modal';
import AIUsageInline from '../AIUsageInline';
import {
  fetchNarrationScript,
  fetchNoteAttachmentPages,
  requestNarrationScript,
  type NarrationScriptResult,
} from '../../services/apiEndpoints';
import { runAiJob } from '../../stores/aiJobRunner';
import { useAiJobUserId } from '../../hooks/useAiJobs';
import {
  DEFAULT_NARRATION_RATE,
  NARRATION_SHORT_MAX_PAGES,
  currentPageIndex,
  firstSegmentOfPage,
  formatNarrationDuration,
  formatNarrationPrice,
  formatSpeed,
  getNarrationCreditCost,
  highlightRangeForBoundary,
  initialNarrationState,
  narrationAvailability,
  narrationPositionLabel,
  narrationReducer,
  narrationUnavailableMessage,
  formatCreditCost,
  nextPageSegment,
  nextSpeed,
  pickNarrationVoice,
  prevPageSegment,
  resumeLabel,
  resumeSegmentIndex,
  splitForHighlight,
  type HighlightRange,
  type NarrationAction,
  type NarrationPlayerState,
  type NarrationPosition,
  type NarrationVoice,
} from '../../utils/narrationPlayerModel';
import {
  loadNarrationPosition,
  narrationPositionIsPersistent,
  saveNarrationPosition,
} from './narrationPosition';
import { cancelSpeech, isSpeechSupported, speak, subscribeToVoices } from './speechEngine';

export interface NarrationPlayerProps {
  isOpen: boolean;
  onClose: () => void;
  noteId: string;
  noteTitle: string;
  attachmentId: string;
  /** File name of the document, used in the heading. */
  documentLabel?: string;
  /** Open on the page the student was already looking at. */
  initialPageIndex?: number;
  /**
   * Page count for the price line before the script route has answered. The
   * walk-through knows it; the Learn panel does not, and the door waits.
   */
  pageCountHint?: number;
  theme?: 'light' | 'dark';
}

/** How often to re-ask while the script is being written. */
const POLL_DELAY_MS = 5000;

/**
 * Read it to me.
 *
 * There is no audio file in this feature and there is no TTS vendor. The
 * server writes a SCRIPT — a few sentences per page — and this component hands
 * those sentences to the browser's own `speechSynthesis` one at a time while
 * showing the page picture they describe. That is why replaying is free and
 * why a deck plays with no network once the script and its images are cached:
 * the AI use is spent when the words are written, once, not when they are
 * spoken.
 *
 * Three rules run through the file:
 *
 *   1. A browser that cannot speak gets a sentence saying so and the written
 *      script to read instead — never a play button that does nothing.
 *   2. The price is printed from the shared table BEFORE the request, with the
 *      page ceiling attached, so "3 AI uses" is never a surprise afterwards.
 *   3. The cursor is the shared reducer's, not this component's. Advancing
 *      happens on `segmentDone` — what the engine has actually finished saying
 *      — and never on a timer.
 */
const NarrationPlayer: React.FC<NarrationPlayerProps> = ({
  isOpen,
  onClose,
  noteId,
  noteTitle,
  attachmentId,
  documentLabel,
  initialPageIndex = 0,
  pageCountHint,
  theme = 'light',
}) => {
  const isDark = theme === 'dark';
  const aiJobUserId = useAiJobUserId();

  const [result, setResult] = useState<NarrationScriptResult | null>(null);
  /**
   * True from the first paint, not from the first effect.
   *
   * The lookup always happens when the reader opens, so starting at false
   * gives the student one frame of an empty dialog, which reads as broken.
   */
  const [loading, setLoading] = useState(() => Boolean(isOpen && noteId && attachmentId));
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [speechError, setSpeechError] = useState<string | null>(null);

  const [voices, setVoices] = useState<NarrationVoice[]>([]);
  /**
   * The document's own page count, asked for only when the caller did not
   * know it and there is no script yet. The price band depends on it (2 up to
   * 20 pages, 3 above), and the Learn panel opens this reader without a count
   * — so without this the inline usage line under the button would quote the
   * cheap band for a 30-page deck the server charges 3 for.
   */
  const [documentPageCount, setDocumentPageCount] = useState<number | null>(null);
  const [position, setPosition] = useState<NarrationPosition>(() => ({
    segmentIndex: 0,
    rate: DEFAULT_NARRATION_RATE,
  }));
  const [highlight, setHighlight] = useState<HighlightRange | null>(null);

  // `isSpeechSupported` reads `window`, so it is resolved in an effect rather
  // than at module scope — this component is server-rendered in tests.
  const [speechSupported, setSpeechSupported] = useState(false);
  useEffect(() => setSpeechSupported(isSpeechSupported()), []);

  const script = result?.script ?? null;
  const segments = useMemo(() => script?.segments ?? [], [script]);

  /**
   * The cursor, from the shared reducer.
   *
   * `total` is passed on every dispatch rather than held in state so that a
   * script arriving (or being regenerated shorter) cannot leave the cursor
   * pointing past the end.
   */
  const [player, rawDispatch] = useReducer(
    (state: NarrationPlayerState, action: NarrationAction) =>
      narrationReducer(state, action, segments.length),
    undefined,
    () => initialNarrationState(DEFAULT_NARRATION_RATE)
  );

  const persistent = useMemo(() => narrationPositionIsPersistent(), []);
  const availability = narrationAvailability({
    speechSupported,
    segments,
    scriptStatus: script?.status ?? null,
    errorMessage: script?.errorMessage,
  });
  /**
   * Why there is nothing to play, in the student's words.
   *
   * `available: false` is the hand-applied-migration case and carries the
   * server's own reason; `available: true` with no script is the ordinary
   * "nobody has paid to have this read yet".
   */
  const unavailable = result
    ? narrationUnavailableMessage(
        result.available ? (script ? 'ok' : 'not_generated') : result.reason,
        segments.length
      )
    : null;

  /**
   * What the request will cost.
   *
   * From the document's page count, not the script's: the script does not
   * exist yet at the moment this price is shown, which is the only moment the
   * price matters. The server prices the same way, from the same function.
   */
  const pageCount = script?.pageCount ?? pageCountHint ?? documentPageCount ?? 0;
  const creditCost = getNarrationCreditCost(pageCount);

  // Price the door from the real page count when nobody handed one in. Text
  // only (no images): this is a count, not a viewer. A failure leaves the
  // two-band sentence, which is still true.
  useEffect(() => {
    if (!isOpen || !noteId || !attachmentId) return;
    if (script || typeof pageCountHint === 'number' || documentPageCount !== null) return;
    if (!result || !result.available) return;
    const controller = new AbortController();
    void fetchNoteAttachmentPages(noteId, attachmentId, { signal: controller.signal })
      .then((pages) => {
        if (!controller.signal.aborted) setDocumentPageCount(pages.pageCount);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [isOpen, noteId, attachmentId, script, pageCountHint, documentPageCount, result]);

  const segment = segments[player.index];
  const pageIndex = segments.length > 0 ? currentPageIndex(segments, player.index) : 0;
  const pageImage = script?.pages?.find((page) => page.pageIndex === pageIndex)?.imageUrl;

  const voice = useMemo(
    () => pickNarrationVoice(voices, position.voiceURI),
    [voices, position.voiceURI]
  );

  // ── Voices ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isOpen || !speechSupported) return;
    return subscribeToVoices(setVoices);
  }, [isOpen, speechSupported]);

  // ── Load the script (free, always) ─────────────────────────────────────
  useEffect(() => {
    if (!isOpen || !noteId || !attachmentId) {
      // Nothing to look for — never leave the panel claiming to be looking.
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const load = async () => {
      setError(null);
      try {
        const next = await fetchNarrationScript(noteId, attachmentId, {
          signal: controller.signal,
        });
        if (cancelled) return;
        setResult(next);
        // A run in flight resolves on its own. Every other state is settled,
        // and re-asking would be a loop.
        const status = next.script?.status;
        if (status === 'queued' || status === 'generating') {
          timer = setTimeout(() => void load(), POLL_DELAY_MS);
        }
      } catch (err) {
        if (cancelled || controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : 'Could not load this narration.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    setLoading(true);
    void load();
    return () => {
      cancelled = true;
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [isOpen, noteId, attachmentId]);

  // ── Resume ─────────────────────────────────────────────────────────────
  /**
   * The resume runs ONCE per opened script, not whenever the position moves.
   *
   * Playing writes the position on every segment, so an effect that read it
   * back would fight the reducer for the cursor — worst of all at the last
   * segment, where the model deliberately resumes from the top and would have
   * thrown the student back to page one mid-sentence.
   */
  const resumedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isOpen) {
      resumedRef.current = null;
      return;
    }
    // Speed and voice apply before there is any script to speak.
    const stored = loadNarrationPosition(attachmentId);
    setPosition(stored);
    rawDispatch({ type: 'setRate', rate: stored.rate });
  }, [isOpen, attachmentId]);

  useEffect(() => {
    if (!isOpen || segments.length === 0) return;
    const key = `${attachmentId}:${script?.version ?? 0}:${segments.length}`;
    if (resumedRef.current === key) return;
    resumedRef.current = key;
    // Read storage again rather than waiting for the effect above to land in
    // state: within one commit that value is not visible yet.
    const stored = loadNarrationPosition(attachmentId);
    const fromCaller =
      initialPageIndex > 0 ? firstSegmentOfPage(segments, initialPageIndex) : null;
    rawDispatch({ type: 'seek', index: fromCaller ?? resumeSegmentIndex(segments, stored) });
  }, [isOpen, attachmentId, segments, script?.version, initialPageIndex]);

  const rememberPosition = useCallback(
    (next: Partial<NarrationPosition>) => {
      setPosition((prev) => {
        const merged = { ...prev, ...next };
        saveNarrationPosition(attachmentId, merged);
        return merged;
      });
    },
    [attachmentId]
  );

  // Remember wherever the cursor lands, whatever moved it.
  useEffect(() => {
    if (segments.length === 0) return;
    rememberPosition({ segmentIndex: player.index });
  }, [player.index, rememberPosition, segments.length]);

  // ── Speaking ───────────────────────────────────────────────────────────
  /**
   * Speak whatever segment the reducer is pointing at, whenever it is playing.
   *
   * The engine is driven from ONE effect keyed on (status, index, rate, voice)
   * rather than from the button handlers. That is what keeps the audio and the
   * cursor from disagreeing: there is no path where a press starts speech the
   * reducer does not know about, or moves the reducer without re-speaking.
   */
  useEffect(() => {
    if (player.status !== 'playing') {
      cancelSpeech();
      setHighlight(null);
      return;
    }
    const current = segments[player.index];
    if (!current) return;
    setHighlight(null);
    setSpeechError(null);
    const cancel = speak({
      text: current.text,
      rate: player.rate,
      voiceURI: voice?.voiceURI,
      lang: voice?.lang,
      onBoundary: (charIndex, charLength) => {
        setHighlight(highlightRangeForBoundary(current.text, charIndex, charLength));
      },
      // The only auto-advance in the player: what the engine has actually
      // finished saying. At the last segment the reducer ends rather than
      // looping.
      onEnd: () => rawDispatch({ type: 'segmentDone' }),
      onError: (reason) => {
        rawDispatch({ type: 'pause' });
        setSpeechError(
          `Your browser stopped reading (${reason}). Press play to carry on, or pick another voice.`
        );
      },
    });
    return cancel;
  }, [player.status, player.index, player.rate, segments, voice]);

  // Speech is a window-level singleton: leaving without cancelling means the
  // browser keeps reading a document that is no longer on screen.
  useEffect(() => {
    if (!isOpen) cancelSpeech();
    return () => cancelSpeech();
  }, [isOpen]);

  const changeSpeed = useCallback(() => {
    const rate = nextSpeed(player.rate);
    rememberPosition({ rate });
    // No engine can retune an utterance in flight, so the speaking effect
    // re-speaks the CURRENT segment at the new rate. Repeating one paragraph
    // is a smaller cost than skipping one.
    rawDispatch({ type: 'setRate', rate });
  }, [player.rate, rememberPosition]);

  const changeVoice = useCallback(
    (voiceURI: string) => {
      rememberPosition({ voiceURI: voiceURI || undefined });
    },
    [rememberPosition]
  );

  // ── Write the script (the one metered call) ────────────────────────────
  const generate = useCallback(async () => {
    if (generating) return;
    setGenerating(true);
    setError(null);
    const title = documentLabel || noteTitle || 'this document';
    try {
      const run = async (hooks?: {
        onServerJob?: (jobId: string) => void;
        onProgress?: (progress: { stage?: string; percent?: number }) => void;
      }) => {
        const next = await requestNarrationScript(noteId, attachmentId, hooks);
        setResult(next);
        return next;
      };
      if (!aiJobUserId) {
        await run();
      } else {
        await runAiJob(
          {
            userId: aiJobUserId,
            kind: 'narration',
            title,
            stages: ['Reading the pages', 'Writing the narration', 'Saving the script'],
            creditCost,
            target: { path: `/notes/${noteId}`, label: 'Open note' },
          },
          async (report, hooks) => {
            report(1);
            const next = await run({
              onServerJob: hooks.onServerJob,
              onProgress: hooks.onServerProgress,
            });
            report(2);
            return next;
          }
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read this document just now.');
    } finally {
      setGenerating(false);
    }
  }, [aiJobUserId, attachmentId, creditCost, documentLabel, generating, noteId, noteTitle]);

  if (!isOpen) return null;

  const panelTone = isDark ? 'bg-lantern-background' : 'bg-lantern-surface';
  const subtleText = isDark ? 'text-lantern-text-tertiary' : 'text-lantern-text-secondary';
  const parts = splitForHighlight(segment?.text ?? '', highlight);
  const pickUp = resumeLabel(segments, position);
  // A failed run is refunded, so the door reopens on it: the student was told
  // "try again" and needs the button that means it.
  const scriptFailed = script?.status === 'failed';
  const showDoor = Boolean(result && (!script || scriptFailed));
  const canGenerate = Boolean(result?.available && showDoor);
  const atFirstPage = segments.length > 0 && prevPageSegment(segments, player.index) === player.index;
  const atLastPage = segments.length > 0 && nextPageSegment(segments, player.index) === player.index;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      ariaLabelledBy="narration-title"
      maxWidthClass="max-w-3xl"
      panelClassName="p-0"
    >
      <div className="flex flex-col">
        <header className="flex items-start gap-3 border-b border-lantern-border p-4">
          <FeatureDisc
            feature="notes"
            size={32}
            icon={<AppIcon name="volume-medium" size={18} />}
            className="mt-0.5"
          />
          <div className="min-w-0 flex-1">
            <h2 id="narration-title" className="truncate text-heading font-semibold text-lantern-text">
              Read me {documentLabel || noteTitle}
            </h2>
            <p className={`text-caption ${subtleText}`}>
              {segments.length > 0
                ? `${narrationPositionLabel(segments, player.index, script?.pageCount)} · read by your device`
                : 'Read aloud by your device — no download, no data'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close the reader"
            className="rounded-lg p-2 text-lantern-text-secondary hover:bg-lantern-background-secondary hover:text-lantern-text"
          >
            <AppIcon name="close" size={18} />
          </button>
        </header>

        {segments.length > 0 && (
          <div className="h-1 w-full bg-lantern-border" aria-hidden="true">
            <div
              className="h-1 bg-lantern-feature-notes-ink transition-all"
              style={{ width: `${Math.round(((player.index + 1) / segments.length) * 100)}%` }}
            />
          </div>
        )}

        <div className="space-y-3 p-4">
          {loading && !result && <p className={`text-body ${subtleText}`}>Looking for a narration…</p>}

          {error && (
            <p className="text-body text-lantern-error" role="alert">
              {error}
            </p>
          )}

          {/* ── The door: nothing written yet ───────────────────────────── */}
          {showDoor && result && (
            <div className={`rounded-lg border border-lantern-border p-4 ${panelTone}`}>
              <p className="text-body text-lantern-text">
                {(scriptFailed && script?.errorMessage) ||
                  result.message ||
                  unavailable ||
                  'No one has had this read out yet.'}
              </p>
              {canGenerate && (
                <>
                  <p className={`mt-1 text-caption ${subtleText}`}>
                    Your device does the reading, so there is nothing to download and playing it
                    again later is free. Writing the script is the part that costs.
                  </p>
                  <button
                    type="button"
                    onClick={() => void generate()}
                    disabled={generating}
                    className="mt-3 flex items-center gap-2 rounded-lg bg-lantern-primary-fill px-3 py-2 text-body font-medium text-white disabled:opacity-50"
                  >
                    <AppIcon
                      name={generating ? 'refresh' : 'volume-medium'}
                      size={16}
                      className={generating ? 'animate-spin' : undefined}
                    />
                    {generating ? 'Writing the narration…' : 'Read it to me'}
                  </button>
                  <p className={`mt-2 text-caption ${subtleText}`}>
                    {pageCount > 0
                      ? formatNarrationPrice(pageCount)
                      : `${formatCreditCost(getNarrationCreditCost(1))} for up to ${NARRATION_SHORT_MAX_PAGES} pages, ${formatCreditCost(
                          getNarrationCreditCost(NARRATION_SHORT_MAX_PAGES + 1)
                        )} above that`}
                  </p>
                  <div className="mt-2">
                    <AIUsageInline cost={creditCost} />
                  </div>
                </>
              )}
            </div>
          )}

          {/* ── Not playable: no speech here, still being written, failed ── */}
          {script && !scriptFailed && !availability.canPlay && availability.message && (
            <div className={`rounded-lg border border-lantern-border p-4 ${panelTone}`} role="note">
              <p className="text-body text-lantern-text">{availability.message}</p>
              {availability.status === 'writing' && (
                <p className={`mt-1 text-caption ${subtleText}`}>Checking again in a few seconds…</p>
              )}
            </div>
          )}

          {/* ── The deck ─────────────────────────────────────────────────── */}
          {script && segments.length > 0 && (
            <>
              <div className={`rounded-lg border border-lantern-border ${panelTone}`}>
                <div className="max-h-[42vh] overflow-y-auto p-3">
                  {pageImage ? (
                    <img
                      src={pageImage}
                      alt={`Page ${pageIndex + 1} of ${documentLabel || noteTitle}`}
                      className="mx-auto w-full max-w-xl rounded-lg border border-lantern-border"
                    />
                  ) : (
                    // Topic explainers and text-only PDFs have no picture. The
                    // narration below IS the page, not a placeholder for one.
                    <p className={`text-body ${subtleText}`}>
                      No picture was stored for page {pageIndex + 1} — the narration is below.
                    </p>
                  )}
                </div>

                {/* The sentence being read, with the word the engine is on.
                    `aria-live` is off deliberately: a screen reader announcing
                    a line the speech engine is already saying is two voices
                    over each other. */}
                <div className="border-t border-lantern-border p-3">
                  <p className="text-body text-lantern-text">
                    {parts.before}
                    {parts.word && (
                      <mark className="rounded bg-lantern-feature-notes-tint px-0.5 text-lantern-text">
                        {parts.word}
                      </mark>
                    )}
                    {parts.after}
                  </p>
                </div>
              </div>

              {speechError && (
                <p className="text-body text-lantern-error" role="alert">
                  {speechError}
                </p>
              )}

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    rawDispatch({ type: 'seek', index: prevPageSegment(segments, player.index) })
                  }
                  disabled={!availability.canPlay || atFirstPage}
                  aria-label="Previous page"
                  className="rounded-lg border border-lantern-border p-2 text-lantern-text-secondary hover:text-lantern-text disabled:opacity-40"
                >
                  <AppIcon name="chevrons-back" size={16} />
                </button>
                <button
                  type="button"
                  onClick={() => rawDispatch({ type: 'toggle' })}
                  disabled={!availability.canPlay}
                  aria-label={player.status === 'playing' ? 'Pause' : 'Play'}
                  className="flex items-center gap-2 rounded-lg bg-lantern-primary-fill px-4 py-2 text-body font-medium text-white disabled:opacity-50"
                >
                  <AppIcon name={player.status === 'playing' ? 'pause' : 'play'} size={16} />
                  {player.status === 'playing' ? 'Pause' : (pickUp ?? 'Play')}
                </button>
                <button
                  type="button"
                  onClick={() =>
                    rawDispatch({ type: 'seek', index: nextPageSegment(segments, player.index) })
                  }
                  disabled={!availability.canPlay || atLastPage}
                  aria-label="Next page"
                  className="rounded-lg border border-lantern-border p-2 text-lantern-text-secondary hover:text-lantern-text disabled:opacity-40"
                >
                  <AppIcon name="chevrons-forward" size={16} />
                </button>
                <button
                  type="button"
                  onClick={changeSpeed}
                  disabled={!availability.canPlay}
                  aria-label={`Reading speed ${formatSpeed(player.rate)}`}
                  className="rounded-lg border border-lantern-border px-3 py-2 text-body font-medium text-lantern-text-secondary hover:text-lantern-text disabled:opacity-40"
                >
                  {formatSpeed(player.rate)}
                </button>
                {voices.length > 1 && (
                  <label className={`flex items-center gap-2 text-caption ${subtleText}`}>
                    <span className="sr-only">Voice</span>
                    <select
                      value={voice?.voiceURI ?? ''}
                      onChange={(event) => changeVoice(event.target.value)}
                      aria-label="Voice"
                      className="max-w-[12rem] rounded-lg border border-lantern-border bg-lantern-surface px-2 py-1.5 text-caption text-lantern-text"
                    >
                      {voices.map((option) => (
                        <option key={option.voiceURI} value={option.voiceURI}>
                          {option.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </div>

              <p className={`text-caption ${subtleText}`}>
                About {formatNarrationDuration(script.estimatedSeconds)} · playing again is free ·{' '}
                {persistent
                  ? 'your place is saved on this device'
                  : 'this browser cannot save your place'}
              </p>
              {/* The shared foreground notice promises a wake lock this player
                  does not take, so web states the limit it actually has. */}
              <p className={`text-caption ${subtleText}`}>
                Reading stops if you close this tab or leave the page.
              </p>
              {result?.truncated && (
                <p className={`text-caption ${subtleText}`}>
                  This document is longer than the reading covers — the first {script.pageCount}{' '}
                  pages were read.
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </Modal>
  );
};

export default NarrationPlayer;
