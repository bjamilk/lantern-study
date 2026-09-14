import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TURN_INTO_TARGETS, formatTurnIntoCost } from '@lantern/shared';
import { TurnIntoMenu } from './TurnIntoMenu';

/** Server rendering keeps this suite off a DOM it does not need. */
const render = (node: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(node);

describe('TurnIntoMenu', () => {
  it('offers every Turn into target with its price', () => {
    const html = render(<TurnIntoMenu onSelect={() => undefined} />);
    expect(TURN_INTO_TARGETS).toHaveLength(8);
    for (const target of TURN_INTO_TARGETS) {
      expect(html).toContain(`aria-label="${target.label} — ${formatTurnIntoCost(target.id)}"`);
    }
    expect(html).toContain('no AI use');
  });

  it('keeps every pill tappable', () => {
    const html = render(<TurnIntoMenu onSelect={() => undefined} />);
    expect(html.match(/min-h-\[44px\]/g) || []).toHaveLength(TURN_INTO_TARGETS.length);
  });

  it('announces a target that was already made', () => {
    const html = render(<TurnIntoMenu existing={{ test: true }} onSelect={() => undefined} />);
    expect(html).toContain('already made');
    expect(html).toContain('lucide-check');
    expect(html.match(/already made/g) || []).toHaveLength(1);
  });
});
