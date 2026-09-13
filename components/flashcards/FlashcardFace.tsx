import React from 'react';

export type FlashcardFaceSide = 'question' | 'answer';

export interface FlashcardFaceProps {
  side: FlashcardFaceSide;
  footer?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  interactive?: boolean;
  onActivate?: () => void;
  ariaLabel?: string;
}

const SIDE_LABEL: Record<FlashcardFaceSide, string> = {
  question: 'Question',
  answer: 'Answer',
};

/**
 * Paper face for Review and Cram. Lime rail is the only chromatic mark;
 * the row itself stays surface + hairline.
 */
export function FlashcardFace({
  side,
  footer,
  children,
  className = '',
  interactive = false,
  onActivate,
  ariaLabel,
}: FlashcardFaceProps) {
  const body = (
    <>
      <span
        className="absolute inset-x-0 top-0 h-[3px] bg-lantern-feature-flashcards-ink"
        aria-hidden="true"
      />
      <div className="flex min-h-[300px] flex-col p-6 md:p-8">
        <p className="text-label font-semibold uppercase tracking-wider text-lantern-feature-flashcards-ink">
          {SIDE_LABEL[side]}
        </p>
        <div className="flex flex-1 min-h-0 flex-col items-center justify-safe-center overflow-y-auto overscroll-y-contain pr-1 pt-6 text-center">
          {children}
        </div>
        {footer ? <div className="mt-6 shrink-0 border-t border-lantern-border pt-4">{footer}</div> : null}
      </div>
    </>
  );

  if (interactive) {
    return (
      <div
        className={`relative overflow-hidden rounded-lantern-xl border border-lantern-border bg-lantern-surface cursor-pointer ${className}`}
        onClick={onActivate}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onActivate?.();
          }
        }}
        role="button"
        tabIndex={0}
        aria-label={ariaLabel}
      >
        {body}
      </div>
    );
  }

  return (
    <article
      className={`relative overflow-hidden rounded-lantern-xl border border-lantern-border bg-lantern-surface ${className}`}
      aria-label={ariaLabel}
    >
      {body}
    </article>
  );
}

export interface FlashcardFlipProps {
  flipped: boolean;
  front: React.ReactNode;
  back: React.ReactNode;
  className?: string;
}

/** 3D flip that stacks both faces; reduced motion shows the active face only. */
export function FlashcardFlip({ flipped, front, back, className = '' }: FlashcardFlipProps) {
  return (
    <div className={`flashcard-flip w-full max-w-2xl ${className}`}>
      <div className={`flashcard-flip-inner${flipped ? ' is-flipped' : ''}`}>
        <div className="flashcard-flip-face" aria-hidden={flipped || undefined}>
          {front}
        </div>
        <div className="flashcard-flip-face flashcard-flip-face-back" aria-hidden={!flipped || undefined}>
          {back}
        </div>
      </div>
    </div>
  );
}

/** Short prompts read as a title; long ones stay body so the card does not shout. */
export function flashcardPromptClass(text: string | null | undefined): string {
  const length = (text ?? '').trim().length;
  return length > 80 ? 'text-body text-lantern-text' : 'text-title text-lantern-text';
}

export const FLASHCARD_GRADE_CHIP = {
  again: 'border border-lantern-border bg-lantern-error/10 text-lantern-error hover:bg-lantern-error/15',
  hard: 'border border-lantern-border bg-lantern-surface text-lantern-text hover:bg-lantern-background-secondary',
  good: 'border border-lantern-border bg-lantern-success/15 text-lantern-success hover:bg-lantern-success/20',
  easy: 'border border-lantern-border bg-lantern-feature-flashcards-tint text-lantern-feature-flashcards-ink hover:brightness-95',
} as const;

export default FlashcardFace;
