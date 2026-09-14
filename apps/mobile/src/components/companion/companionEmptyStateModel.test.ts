/**
 * The picker REPLACES the chips — it does not stack with them.
 *
 * On device (SF5b, dark mode, Home `Ask Lantern` door) a `Give me a study tip`
 * pill drew on top of the Guided picker card, over the line that says a lesson
 * costs one turn. Both offers being reachable at once is the defect, so what is
 * pinned here is exclusivity, not pixels.
 */
import { companionEmptyState } from './companionEmptyStateModel';

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
