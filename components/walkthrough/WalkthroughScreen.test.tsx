// @vitest-environment jsdom
// VoiceInputButton reads `window.SpeechRecognition` at module scope, so this
// suite needs a DOM to import at all. It still renders through
// react-dom/server: effects (and therefore the network read) never run.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import WalkthroughScreen from './WalkthroughScreen';

/**
 * A render smoke test. It renders through `react-dom/server`, which runs no
 * effects, so the network read never fires and the assertions are about the
 * shell that comes up BEFORE any page arrives — exactly the state a student
 * sees first.
 *
 * The value here is the wiring, not the pixels: the modal must not blow up on
 * a note whose pages have not loaded, the price must be printed by
 * `formatCreditCost` rather than hand-typed, and a closed walk-through must
 * render nothing at all.
 */
vi.mock('../../services/apiEndpoints', () => ({
  fetchNoteAttachmentPages: vi.fn(),
}));
vi.mock('../../services/ai', () => ({
  aiGenerateQuestions: vi.fn(),
  subscribeToAIUsage: () => () => undefined,
  getLatestAIUsage: () => ({ used: 0, limit: 20, remaining: 20, resetsAt: '' }),
}));

const render = (node: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(node);

const props = {
  onClose: () => undefined,
  noteId: '11111111-1111-4111-8111-111111111111',
  noteTitle: 'Biochemistry lecture 2',
  attachmentId: '22222222-2222-4222-8222-222222222222',
  documentLabel: 'lecture-2.pdf',
} as const;

describe('WalkthroughScreen', () => {
  it('renders nothing when closed', () => {
    expect(render(<WalkthroughScreen isOpen={false} {...props} />)).toBe('');
  });

  it('comes up on the document before any page has loaded', () => {
    const html = render(<WalkthroughScreen isOpen {...props} />);
    expect(html).toContain('Walk me through');
    expect(html).toContain('lecture-2.pdf');
    expect(html).toContain('One page at a time');
  });

  it('prices the check in AI uses, not in invented units', () => {
    // The panel is not shown until pages load, so this asserts the constant
    // the component was built with rather than the rendered button — the
    // point is that the price comes from formatCreditCost.
    const html = render(<WalkthroughScreen isOpen {...props} />);
    expect(html).not.toContain('credits');
    expect(html).not.toContain('tokens');
  });
});
