import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { GUIDED_COST_NOTE, buildGuidedGoals } from '@lantern/shared/api';
import { GuidedPicker } from './GuidedPicker';

/** Server rendering keeps this suite off a DOM it does not need. */
const render = (props: Partial<React.ComponentProps<typeof GuidedPicker>> = {}) =>
  renderToStaticMarkup(
    <GuidedPicker
      goals={buildGuidedGoals({ nextTopic: 'Osmosis', topics: ['Active transport'] })}
      onPick={() => undefined}
      onSomethingElse={() => undefined}
      {...props}
    />
  );

describe('the guided picker', () => {
  it('names every row for a screen reader, not just for the eye', () => {
    const html = render();

    // The visible label reads "Continue learning: Osmosis"; the accessible one
    // drops the colon so it is spoken as a sentence rather than a fragment.
    expect(html).toContain('aria-label="Continue learning Osmosis"');
    expect(html).toContain('aria-label="Start learning Active transport"');
    expect(html).toContain(
      'aria-label="Something else — type what you want to be guided through"'
    );
  });

  it('groups the rows under the question they answer', () => {
    const html = render();

    expect(html).toContain('What would you like me to guide you through?');
    expect(html).toContain('aria-labelledby="companion-guided-picker-title"');
    expect(html).toContain('role="group"');
  });

  it('states the per-turn cost, so a "session" is not read as a separate charge', () => {
    expect(render()).toContain(GUIDED_COST_NOTE);
  });

  it('leads with the set\'s next topic when the host states one', () => {
    // Exactly the shape a room hands the panel: the plan's next topic and the
    // unit it sits in (CourseWorkspace / CourseRoomScreen).
    const html = render({
      goals: buildGuidedGoals({
        nextTopic: { title: 'Narrow vs. General AI', unit: '01 AI Foundations' },
        topics: ['Symbolic AI', 'Deep Learning'],
      }),
    });

    expect(html).toContain('Continue learning: Narrow vs. General AI');
    expect(html.indexOf('Continue learning')).toBeLessThan(html.indexOf('Start learning'));
    // The unit is context for the lesson, never a second line on the row.
    expect(html).not.toContain('01 AI Foundations');
  });

  it('offers starts only when the host has no next topic — never an invented continue', () => {
    const html = render({
      goals: buildGuidedGoals({ nextTopic: null, topics: ['Symbolic AI', 'Deep Learning'] }),
    });

    expect(html).not.toContain('Continue learning');
    expect(html).toContain('Start learning: Symbolic AI');
    expect(html).toContain('Something else…');
  });

  it('still offers a way in when there is no material to list', () => {
    const html = render({ goals: [] });

    expect(html).toContain('Something else…');
    expect(html).not.toContain('Continue learning');
  });

  it('disables every row while a turn is in flight', () => {
    const html = render({ disabled: true });

    // Three rows: two goals and the free-text way out.
    expect(html.match(/disabled=""/g)).toHaveLength(3);
  });
});
