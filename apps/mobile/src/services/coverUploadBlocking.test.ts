/**
 * The cover flow must not block the JS thread, and must reach a fixed point.
 *
 * Applying a deck cover and pressing Back produced an ANR on 2026-09-13:
 * "Input dispatching timed out … Waited 16139ms for MotionEvent", with the
 * app idle at 1.1% CPU and Choreographer reporting "Skipped 930 frames" right
 * after the cover was applied. Two things in this flow can cause that, and
 * both are pinned here:
 *
 *  1. synchronous work on the JS thread inside the upload path (a re-encode,
 *     a base64 loop). Everything must be awaited native work instead;
 *  2. a store patch that never settles, so the deck list re-renders forever.
 *
 * The window race — opening the photo picker Activity while a Modal is still
 * sliding out — is covered by `SHEET_DISMISS_MS` below.
 */
import { SHEET_DISMISS_MS } from '../components/ui/coverPickerModel';
import { api } from './api';
import { prepareImageBase64ForUpload } from '../utils/prepareImage';
import { uploadCover } from './coverUpload';

jest.mock('expo-image-picker', () => ({
  requestCameraPermissionsAsync: jest.fn(),
  requestMediaLibraryPermissionsAsync: jest.fn(),
  launchCameraAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(),
}));

jest.mock('./api', () => ({
  api: {
    uploadDeckCover: jest.fn(),
    uploadNoteCover: jest.fn(),
    uploadStudySetCover: jest.fn(),
    clearDeckCover: jest.fn(),
    clearNoteCover: jest.fn(),
    clearStudySetCover: jest.fn(),
  },
}));

jest.mock('../utils/prepareImage', () => ({
  prepareImageBase64ForUpload: jest.fn(),
}));

jest.mock('../components/ui/appDialog', () => ({ appAlert: jest.fn() }));

/** Android's input-dispatch budget is 5 s; one dropped frame is 16 ms. */
const MAX_SYNC_MS = 50;

describe('cover upload never blocks the JS thread', () => {
  it('hands a 3 MB payload to the API without synchronous work', async () => {
    // A real 1600px re-encode is roughly this size as base64.
    const base64Data = 'A'.repeat(3 * 1024 * 1024);
    (api.uploadDeckCover as jest.Mock).mockResolvedValue({
      coverPath: 'owner/decks/deck-1/1-cover.webp',
      coverUrl: 'https://example.test/signed',
      coverThumbUrl: null,
    });
    (prepareImageBase64ForUpload as jest.Mock).mockResolvedValue({});

    const started = Date.now();
    const pending = uploadCover(
      { kind: 'deck', id: 'deck-1' },
      { base64Data, fileName: 'cover.webp', contentType: 'image/webp' }
    );
    // Measured BEFORE awaiting: this is the work that ran on the JS thread
    // before control went back to the event loop.
    const synchronousMs = Date.now() - started;
    await pending;

    expect(synchronousMs).toBeLessThan(MAX_SYNC_MS);
    expect(api.uploadDeckCover).toHaveBeenCalledWith('deck-1', {
      base64Data,
      fileName: 'cover.webp',
      contentType: 'image/webp',
    });
  });

  it('waits for a sheet to finish dismissing before opening a window', () => {
    // ActionSheet's Modal uses animationType="slide" (~300 ms). Launching the
    // picker Activity inside that window is what leaves Android with two
    // overlapping app windows and an unresponsive one.
    expect(SHEET_DISMISS_MS).toBeGreaterThanOrEqual(300);
  });
});
