/**
 * The mobile Tailwind config once declared four feature colours twice: the
 * `{ ink, tint }` pair, then ~40 lines later a legacy bare string under the
 * same key. In an object literal the later key wins, so for tests, flashcards,
 * groups and budget the `-ink` / `-tint` classes were never generated and the
 * readiness card painted its chip and button with classes that did not exist
 * (invisible in dark mode on build 169). This pins every feature to an object.
 */
// eslint-disable-next-line @typescript-eslint/no-var-requires
const config = require('../../tailwind.config.js');

const FEATURES = ['notes', 'flashcards', 'tests', 'recording', 'ai', 'groups', 'campus', 'budget'];

describe('tailwind feature colours', () => {
  const feature = config.theme.extend.colors.lantern.feature as Record<string, unknown>;

  it.each(FEATURES)('%s resolves to an object carrying ink and tint', (key) => {
    const entry = feature[key];
    expect(typeof entry).toBe('object');
    const obj = entry as Record<string, string>;
    expect(obj.ink).toContain(`--color-lantern-feature-${key}-ink`);
    expect(obj.tint).toContain(`--color-lantern-feature-${key}-tint`);
  });

  it.each(['flashcards', 'tests', 'groups', 'budget'])(
    '%s keeps its bare legacy class through DEFAULT',
    (key) => {
      const obj = feature[key] as Record<string, string>;
      expect(obj.DEFAULT).toContain(`--color-lantern-feature-${key})`);
    }
  );
});
