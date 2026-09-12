import React from 'react';
import { messageTurnIntoActionLabel, type TurnIntoTargetId } from '@lantern/shared';
import { AppIcon } from '../ui/AppIcon';
import { TurnIntoMenu } from '../study/TurnIntoMenu';

export interface MessageActionsProps {
  /** Copy the answer to the clipboard. */
  onCopy: () => void;
  /** Toggle browser speech for this answer. */
  onToggleSpeak: () => void;
  /** True while THIS answer is the one being read aloud. */
  isSpeaking: boolean;
  /** False on a browser with no `speechSynthesis` at all. */
  canSpeak: boolean;
  /** Ask the same question again — appends a fresh turn. */
  onRegenerate: () => void;
  /** Re-ask "Explain that more simply" on the same thread. */
  onExplainSimply: () => void;
  onRate: (rating: 'up' | 'down') => void;
  feedback: 'up' | 'down' | null;
  /**
   * Feedback needs a persisted message id to attach to. False while the server
   * is still saving the turn.
   */
  canRate: boolean;
  /** A send is in flight: the two that spend a credit are held. */
  busy?: boolean;
  /**
   * Turn THIS answer into study material — flashcards, a practice test, or one
   * of the four studios.
   *
   * Optional, and the control is only drawn when a host supplies it, because
   * turning a message into anything means FILING it as a note first, and only
   * a host that knows the scope (which set, which course) can file it in the
   * right place. A pill that saved every answer to "unfiled" would be worse
   * than no pill.
   */
  onTurnInto?: (target: TurnIntoTargetId) => void;
  /**
   * True while this answer's six-target menu is the open one. Controlled by
   * the thread rather than held here, so opening a second answer's menu closes
   * the first instead of leaving two identical rows on screen.
   */
  turnIntoOpen?: boolean;
  onToggleTurnInto?: () => void;
  /** Targets already made from this answer, ticked so nobody pays twice. */
  turnIntoExisting?: Partial<Record<TurnIntoTargetId, boolean>>;
}

const ICON_BUTTON =
  'inline-flex h-8 w-8 items-center justify-center rounded-lg transition-colors text-lantern-text-tertiary hover:bg-lantern-background-secondary hover:text-lantern-text disabled:opacity-40 disabled:hover:bg-transparent dark:hover:bg-lantern-surface-secondary';

/**
 * The row under a finished answer: copy, read aloud, ask again, "I don't
 * understand", and the two thumbs.
 *
 * Every control is a real button with an accessible NAME rather than a bare
 * glyph — a screen reader on the old row heard "button, button" for the thumbs
 * and nothing at all for the rest, because the rest did not exist on web.
 *
 * The six stay mounted and go disabled rather than disappearing. A row that
 * unmounts its thumbs the moment a stream starts, and remounts them when the
 * id lands, reflows the whole thread under the reader's cursor; and a control
 * that vanishes reads as a bug, while a disabled one with a title reads as an
 * answer ("not yet").
 */
export function MessageActions({
  onCopy,
  onToggleSpeak,
  isSpeaking,
  canSpeak,
  onRegenerate,
  onExplainSimply,
  onRate,
  feedback,
  canRate,
  busy,
  onTurnInto,
  turnIntoOpen,
  onToggleTurnInto,
  turnIntoExisting,
}: MessageActionsProps) {
  return (
    <div className="w-full">
    <div
      className="mt-1 flex flex-wrap items-center gap-0.5"
      role="group"
      aria-label="Answer actions"
    >
      <button type="button" onClick={onCopy} aria-label="Copy answer" title="Copy answer" className={ICON_BUTTON}>
        <AppIcon name="copy" size={14} />
      </button>
      <button
        type="button"
        onClick={onToggleSpeak}
        disabled={!canSpeak}
        aria-label={isSpeaking ? 'Stop reading aloud' : 'Read answer aloud'}
        aria-pressed={isSpeaking}
        title={canSpeak ? (isSpeaking ? 'Stop reading aloud' : 'Read answer aloud') : 'This browser has no speech voices'}
        className={`${ICON_BUTTON} ${isSpeaking ? 'text-lantern-feature-ai-ink' : ''}`}
      >
        <AppIcon name={isSpeaking ? 'stop' : 'volume-medium'} size={14} />
      </button>
      <button
        type="button"
        onClick={onRegenerate}
        disabled={busy}
        aria-label="Ask again"
        title="Ask the same question again"
        className={ICON_BUTTON}
      >
        <AppIcon name="refresh" size={14} />
      </button>
      <button
        type="button"
        onClick={onRate.bind(null, 'up')}
        disabled={!canRate}
        aria-label="Helpful"
        aria-pressed={feedback === 'up'}
        title={canRate ? (feedback === 'up' ? 'Remove rating' : 'Helpful') : 'Still saving — rate this in a moment'}
        className={`${ICON_BUTTON} ${feedback === 'up' ? 'text-lantern-success' : ''}`}
      >
        <AppIcon name="thumbs-up" size={14} />
      </button>
      <button
        type="button"
        onClick={onRate.bind(null, 'down')}
        disabled={!canRate}
        aria-label="Not helpful"
        aria-pressed={feedback === 'down'}
        title={canRate ? (feedback === 'down' ? 'Remove rating' : 'Not helpful') : 'Still saving — rate this in a moment'}
        className={`${ICON_BUTTON} ${feedback === 'down' ? 'text-lantern-error' : ''}`}
      >
        <AppIcon name="thumbs-down" size={14} />
      </button>
      {/* The one worded control: "I don't understand" has to say what it does,
          because no glyph means "explain that again, simpler". */}
      <button
        type="button"
        onClick={onExplainSimply}
        disabled={busy}
        aria-label="I don't understand — explain more simply"
        title="Explain that more simply"
        className="ml-0.5 inline-flex min-h-[32px] items-center rounded-full bg-lantern-feature-ai-tint px-2.5 text-body font-medium text-lantern-feature-ai-ink transition-opacity disabled:opacity-40"
      >
        I don&apos;t understand
      </button>
      {/* Turn-into acts on the ANSWER, which is the whole point: the thing a
          student wants cards from is usually the explanation they just read,
          not the note that happened to be attached to the conversation. */}
      {onTurnInto && (
        <button
          type="button"
          onClick={onToggleTurnInto}
          disabled={busy}
          aria-expanded={Boolean(turnIntoOpen)}
          aria-label="Turn this answer into study material"
          title="Turn this answer into flashcards, a test, or a studio"
          className="ml-0.5 inline-flex min-h-[32px] items-center gap-1 rounded-full bg-lantern-feature-flashcards-tint px-2.5 text-body font-medium text-lantern-feature-flashcards-ink transition-opacity disabled:opacity-40"
        >
          <AppIcon name="sparkles" size={13} />
          Turn into…
        </button>
      )}
    </div>
    {onTurnInto && turnIntoOpen && (
      <div className="mt-2 rounded-xl border border-lantern-border bg-lantern-surface p-2.5 dark:bg-lantern-surface-secondary">
        <TurnIntoMenu
          disabled={busy}
          existing={turnIntoExisting}
          heading="Turn this answer into"
          describeTarget={messageTurnIntoActionLabel}
          onSelect={onTurnInto}
        />
        {/* Said once, plainly, rather than repeated on all six pills: the four
            studios open ON a note, so the answer gets saved either way. */}
        <p className="mt-1.5 text-caption text-lantern-text-tertiary">
          This answer is saved as a note first, so you can find it again.
        </p>
      </div>
    )}
    </div>
  );
}

export default MessageActions;
