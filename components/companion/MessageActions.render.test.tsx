import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TURN_INTO_TARGETS, messageTurnIntoActionLabel } from '@lantern/shared';
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

  it('adds no turn-into control on a host that cannot file a note', () => {
    // The row is six buttons wide by default: a "Turn into…" pill that saved
    // an answer to nowhere would be worse than no pill.
    expect(render()).not.toContain('Turn into');
  });

  it('offers a turn-into control when the host can file the answer', () => {
    const html = render({ onTurnInto: () => undefined });
    expect(html).toContain('aria-label="Turn this answer into study material"');
    expect(html).toContain('aria-expanded="false"');
    // Closed by default — six pills under every answer would bury the thread.
    expect(html).not.toContain('Turn this answer into<');
  });

  it('opens a menu of all six targets, each with its price', () => {
    const html = render({ onTurnInto: () => undefined, turnIntoOpen: true });
    expect(html).toContain('aria-expanded="true"');
    for (const target of TURN_INTO_TARGETS) {
      expect(html).toContain(`</span>${target.label}<span`);
    }
    // One pill per target, plus the six row buttons and the toggle.
    expect(html.match(/min-h-\[44px\]/g) || []).toHaveLength(TURN_INTO_TARGETS.length);
  });

  it('says the studio targets file a note first, and the two jobs do not', () => {
    const html = render({ onTurnInto: () => undefined, turnIntoOpen: true });
    for (const id of ['lesson', 'recap', 'essay', 'play'] as const) {
      expect(html).toContain(`aria-label="${messageTurnIntoActionLabel(id)} — `);
    }
    expect(html).toContain('aria-label="Flashcards — ');
    expect(html).toContain('aria-label="Practice test — ');
  });

  it('holds the turn-into control while a send is in flight', () => {
    const html = render({ onTurnInto: () => undefined, busy: true });
    expect((html.match(/disabled=""/g) || []).length).toBe(3);
  });
});
