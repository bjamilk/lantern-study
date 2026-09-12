/**
 * Build 193: every lecture opened from the Library or a set room landed on the
 * consent screen, and the tab row — My Notes / Enhanced / Transcript / Audio —
 * lived in the branch that screen replaced, so a lecture with enhanced notes
 * had no reachable door on Android. This pins the decision that branch makes.
 */
import { composeLectureNoteBody } from '@lantern/shared/learning/lectureStudio';
import { upsertSmartNotesSection } from '@lantern/shared/utils/smartNotes';
import { lectureStudioView } from './lectureStudioView';

const saved = upsertSmartNotesSection(
  composeLectureNoteBody('[0:00] mine', 'Enzymes lower activation energy.'),
  '- Enzymes cut the activation barrier.'
);

describe('lecture studio: consent door vs the tabs', () => {
  it('shows the tabs for a saved lecture even before the box is ticked', () => {
    const view = lectureStudioView({ source: { body: saved }, consented: false, status: 'idle' });
    expect(view.showTabs).toBe(true);
    expect(view.showConsent).toBe(false);
    // Recording stays one tap away: the consent line rides above the tabs.
    expect(view.showConsentBar).toBe(true);
  });

  it('shows the consent door only for a lecture with nothing on it', () => {
    expect(lectureStudioView({ source: {}, consented: false, status: 'idle' })).toEqual({
      showConsent: true,
      showTabs: false,
      showConsentBar: false,
    });
  });

  it('drops the bar once consented and while a take is running', () => {
    expect(
      lectureStudioView({ source: { body: saved }, consented: true, status: 'idle' })
    ).toEqual({ showConsent: false, showTabs: true, showConsentBar: false });
    expect(lectureStudioView({ source: {}, consented: false, status: 'recording' })).toEqual({
      showConsent: false,
      showTabs: true,
      showConsentBar: false,
    });
  });
});
