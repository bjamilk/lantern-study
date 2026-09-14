/**
 * The picker REPLACES the chips — it does not stack with them.
 *
 * On device (SF5b, dark mode, Home `Ask Lantern` door) a `Give me a study tip`
 * pill drew on top of the Guided picker card, over the line that says a lesson
 * costs one turn. Both offers being reachable at once is the defect, so what is
 * pinned here is exclusivity, not pixels.
 */
import {
  companionComposerPicker,
  companionEmptyState,
} from './companionEmptyStateModel';

describe('companion empty state offers one thing at a time', () => {
  it('offers the intent chips in normal chat', () => {
    const model = companionEmptyState({ guided: false });
    expect(model.offer).toBe('intent-chips');
    expect(model.showIntentChips).toBe(true);
    expect(model.showGuidedPicker).toBe(false);
    expect(model.showGreeting).toBe(true);
  });

  it('replaces the chips with the picker when Guided is on', () => {
    const model = companionEmptyState({ guided: true });
    expect(model.offer).toBe('guided-picker');
    expect(model.showGuidedPicker).toBe(true);
    expect(model.showIntentChips).toBe(false);
  });

  it('never draws the picker and the chips together, in any combination', () => {
    for (const guided of [true, false]) {
      for (const hasMessages of [true, false]) {
        for (const isLoadingHistory of [true, false]) {
          const model = companionEmptyState({ guided, hasMessages, isLoadingHistory });
          expect(model.showGuidedPicker && model.showIntentChips).toBe(false);
        }
      }
    }
  });

  it('shows the spinner alone while history is still coming back', () => {
    const model = companionEmptyState({ guided: true, isLoadingHistory: true });
    expect(model.showLoading).toBe(true);
    expect(model.offer).toBe('none');
    expect(model.showGuidedPicker).toBe(false);
    expect(model.showGreeting).toBe(false);
  });

  it('offers nothing once the thread has turns in it', () => {
    const model = companionEmptyState({ guided: true, hasMessages: true });
    expect(model.offer).toBe('none');
    expect(model.showGuidedPicker).toBe(false);
    expect(model.showIntentChips).toBe(false);
  });
});

/**
 * And the other half of "exactly one picker on screen": once the thread HAS
 * turns, the empty state is gone and the card above the composer takes over.
 * Before this, turning Guided on mid-conversation offered nothing at all.
 */
describe('the guided picker above the composer', () => {
  it('takes over exactly where the empty state stops offering', () => {
    const withHistory = { guided: true, hasMessages: true };
    expect(companionEmptyState(withHistory).showGuidedPicker).toBe(false);
    expect(companionComposerPicker(withHistory)).toBe(true);
  });

  it('never draws two pickers at once in an empty guided thread', () => {
    const empty = { guided: true, hasMessages: false };
    expect(companionEmptyState(empty).showGuidedPicker).toBe(true);
    expect(companionComposerPicker(empty)).toBe(false);
  });

  it('is gone with Guided off, once dismissed, and while history loads', () => {
    expect(companionComposerPicker({ guided: false, hasMessages: true })).toBe(false);
    expect(companionComposerPicker({ guided: true, hasMessages: true, dismissed: true })).toBe(
      false
    );
    expect(
      companionComposerPicker({ guided: true, hasMessages: true, isLoadingHistory: true })
    ).toBe(false);
  });
});
