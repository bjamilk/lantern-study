import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MessageActions } from './MessageActions';

/** Server rendering keeps this suite off a DOM it does not need. */
const render = (props: Partial<React.ComponentProps<typeof MessageActions>> = {}) =>
  renderToStaticMarkup(
    <MessageActions
      onCopy={() => undefined}
      onToggleSpeak={() => undefined}
      isSpeaking={false}
      canSpeak
      onRegenerate={() => undefined}
      onExplainSimply={() => undefined}
      onRate={() => undefined}
      feedback={null}
      canRate
      {...props}
    />
  );

const NAMES = [
  'Copy answer',
  'Read answer aloud',
  'Ask again',
  'Helpful',
  'Not helpful',
  "I don't understand — explain more simply",
];

describe('per-answer actions', () => {
  it('exposes six buttons, each with an accessible name', () => {
    const html = render();
    expect(html.match(/<button/g) || []).toHaveLength(6);
    for (const name of NAMES) {
      // React escapes the apostrophe, so compare against the escaped form.
      expect(html).toContain(`aria-label="${name.replace(/'/g, '&#x27;')}"`);
    }
  });

  it('keeps all six mounted when the turn is not yet ratable', () => {
    // Disabled rather than absent: a row that unmounts its thumbs mid-stream
    // reflows the thread under the reader, and a vanishing control reads as a
    // bug where a disabled one reads as "not yet".
    const html = render({ canRate: false, canSpeak: false });
    expect(html.match(/<button/g) || []).toHaveLength(6);
    expect(html).toContain('Still saving');
    expect(html).toContain('This browser has no speech voices');
  });

  it('says "stop" while it is the answer being read aloud', () => {
    const html = render({ isSpeaking: true });
    expect(html).toContain('aria-label="Stop reading aloud"');
    expect(html).toContain('aria-pressed="true"');
  });

  it('holds the two credit-spending actions while a send is in flight', () => {
    const html = render({ busy: true });
    const disabled = html.match(/disabled=""/g) || [];
    expect(disabled).toHaveLength(2);
  });

  it('marks the rating that is set', () => {
    expect(render({ feedback: 'down' })).toContain('Remove rating');
  });
});
