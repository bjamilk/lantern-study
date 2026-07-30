/**
 * Guards flashcard review index advances against double-fires from
 * keyboard + click, swipe + button, or stale animation callbacks.
 */

export type ReviewAdvanceDecision =
  | { ok: true }
  | { ok: false; reason: 'missing_card' | 'already_rated' | 'stale_card' };

export class FlashcardReviewAdvanceGuard {
  private readonly ratedCardIds = new Set<string>();
  private advanceGeneration = 0;
  private activeCardId: string | null = null;

  /** Call whenever the visible card changes (including session reset). */
  setActiveCard(cardId: string | null): void {
    this.activeCardId = cardId;
  }

  reset(): void {
    this.ratedCardIds.clear();
    this.advanceGeneration += 1;
    this.activeCardId = null;
  }

  hasRated(cardId: string): boolean {
    return this.ratedCardIds.has(cardId);
  }

  /**
   * Attempt to claim an advance for `cardId`. Returns a generation token that
   * delayed auto-advance timers must check before applying the index change.
   */
  tryClaimAdvance(cardId: string | null | undefined): ReviewAdvanceDecision & { generation?: number } {
    if (!cardId) return { ok: false, reason: 'missing_card' };
    if (this.activeCardId != null && this.activeCardId !== cardId) {
      return { ok: false, reason: 'stale_card' };
    }
    if (this.ratedCardIds.has(cardId)) {
      return { ok: false, reason: 'already_rated' };
    }
    this.ratedCardIds.add(cardId);
    this.advanceGeneration += 1;
    return { ok: true, generation: this.advanceGeneration };
  }

  /** True when a delayed advance scheduled for `generation` is still valid. */
  isAdvanceGenerationCurrent(generation: number): boolean {
    return generation === this.advanceGeneration;
  }

  get generation(): number {
    return this.advanceGeneration;
  }
}

/**
 * Clamp study.autoAdvanceDelay (seconds) to a safe ms delay.
 * 0 = advance immediately after an explicit rating.
 */
export function resolveAutoAdvanceDelayMs(autoAdvanceDelaySeconds: unknown): number {
  const n = typeof autoAdvanceDelaySeconds === 'number'
    ? autoAdvanceDelaySeconds
    : Number(autoAdvanceDelaySeconds);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(Math.min(30, n) * 1000);
}
