// @vitest-environment jsdom
// The player reads `window.speechSynthesis` from an effect, and the modal
// shell touches `document`, so this suite needs a DOM to import at all. It
// still renders through react-dom/server: effects never run, so no network
// read fires and no speech is attempted.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import NarrationPlayer from './NarrationPlayer';

/**
 * A render smoke test. The value is the wiring, not the pixels: the reader
 * must come up on a document whose script has not loaded, it must not print a
 * price in a unit the app does not use, and a closed reader must render
 * nothing at all.
 *
 * The interesting behaviour — segment stepping, resume, the speed clamp and
 * the browser-cannot-speak state — is asserted against the pure model in
 * utils/narrationPlayerModel.test.ts, where it can be tested without a speech
 * engine at all.
 */
vi.mock('../../services/apiEndpoints', () => ({
  fetchNarrationScript: vi.fn(),
  fetchNoteAttachmentPages: vi.fn(),
  requestNarrationScript: vi.fn(),
}));
vi.mock('../../services/ai', () => ({
  subscribeToAIUsage: () => () => undefined,
  getLatestAIUsage: () => ({ used: 0, limit: 20, remaining: 20, resetsAt: '' }),
  fetchAIUsage: vi.fn(),
}));
vi.mock('../../hooks/useAiJobs', () => ({
  useAiJobUserId: () => 'user-1',
}));

const render = (node: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(node);

const props = {
  onClose: () => undefined,
  noteId: '11111111-1111-4111-8111-111111111111',
  noteTitle: 'Biochemistry lecture 2',
  attachmentId: '22222222-2222-4222-8222-222222222222',
  documentLabel: 'lecture-2.pdf',
} as const;

describe('NarrationPlayer', () => {
  it('renders nothing when closed', () => {
    expect(render(<NarrationPlayer isOpen={false} {...props} />)).toBe('');
  });

  it('comes up on the document before any script has loaded', () => {
    const html = render(<NarrationPlayer isOpen {...props} />);
    expect(html).toContain('Read me');
    expect(html).toContain('lecture-2.pdf');
    expect(html).toContain('Looking for a narration');
  });

  it('says the reading happens on the device, not from a download', () => {
    const html = render(<NarrationPlayer isOpen {...props} />);
    expect(html).toContain('Read aloud by your device');
    // No audio is produced anywhere in this feature; promising a file would be
    // a promise the server cannot keep.
    expect(html.toLowerCase()).not.toContain('download the audio');
  });

  it('never prices anything in invented units', () => {
    const html = render(<NarrationPlayer isOpen pageCountHint={24} {...props} />);
    expect(html).not.toContain('credits');
    expect(html).not.toContain('tokens');
  });
});
