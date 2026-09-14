/**
 * What the companion's empty thread offers — as one value, so "picker OR
 * chips" is a rule rather than a coincidence of JSX.
 *
 * With Guided on, the intent chips (`Give me a study tip`, `Quiz me on my weak
 * topics`, …) are the wrong offer: they ask a question, while Guided teaches a
 * topic. The web rail REPLACES the chips with the picker; the phone drew both
 * at once from the Home `Ask Lantern` door, and the chip row landed over the
 * picker card's cost line — so the surface that says a lesson costs one turn
 * was sitting under a pill that starts an ordinary chat.
 *
 * The two offers are mutually exclusive BY CONSTRUCTION here: one `offer`
 * field, and the booleans read off it. A future branch cannot turn both on
 * without changing this function, and `companionEmptyStateModel.test.ts`
 * pins that.
 */

export interface CompanionEmptyStateInput {
  /** Is Guided mode on for this thread? */
  guided: boolean;
  /** Does the thread already have turns in it? Then there is no empty state. */
  hasMessages?: boolean;
  /** History still coming back: the sheet shows its spinner, nothing else. */
  isLoadingHistory?: boolean;
}

export interface CompanionEmptyStateModel {
  /** The single offer this empty thread makes. */
  offer: 'guided-picker' | 'intent-chips' | 'none';
  /** The greeting illustration and its two lines. */
  showGreeting: boolean;
  /** The Guided picker card (with its cost line). */
  showGuidedPicker: boolean;
  /** The scoped + generic prompt chips. Never drawn beside the picker. */
  showIntentChips: boolean;
  /** The loading spinner instead of any offer at all. */
  showLoading: boolean;
}

export function companionEmptyState({
  guided,
  hasMessages = false,
  isLoadingHistory = false,
}: CompanionEmptyStateInput): CompanionEmptyStateModel {
  if (isLoadingHistory) {
    return {
      offer: 'none',
      showGreeting: false,
      showGuidedPicker: false,
      showIntentChips: false,
      showLoading: true,
    };
  }
  // A thread with turns in it draws no empty state at all; the caller only
  // reaches this function through the list's empty slot, but stating the rule
  // here keeps the model honest when it is asked directly.
  if (hasMessages) {
    return {
      offer: 'none',
      showGreeting: false,
      showGuidedPicker: false,
      showIntentChips: false,
      showLoading: false,
    };
  }
  const offer: CompanionEmptyStateModel['offer'] = guided ? 'guided-picker' : 'intent-chips';
  return {
    offer,
    showGreeting: true,
    showGuidedPicker: offer === 'guided-picker',
    showIntentChips: offer === 'intent-chips',
    showLoading: false,
  };
}

export default companionEmptyState;
