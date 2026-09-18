/**
 * Which tutor style a turn is answered in, decided server-side.
 *
 * Two sources, in order: the style the request names (a UI choice the client
 * legitimately owns, like `mode`), then the style stored on the student's own
 * profile row. The fallback is what makes the picker a PREFERENCE rather than a
 * per-tab toggle — a phone that has not synced its settings yet, or a client
 * from before this shipped, still gets the style the account is on.
 *
 * Both paths are allowlisted. This suite is the proof that the raw string a
 * client (or a stale profile row) supplies cannot reach the prompt builder.
 */
jest.mock('./topicMastery', () => ({
  getTopicMasteryService: () => ({ weakTopics: async () => [] }),
}));
jest.mock('./classSections', () => ({
  getClassSectionsService: () => ({ corpusForCompanion: async () => '' }),
}));
jest.mock('./notePages', () => ({ getPageText: jest.fn() }));

import { buildTrustedCompanionContext } from './companionContext';

/** A layer whose profile row carries `settings`, and nothing else of interest. */
function layerWithSettings(settings: unknown) {
  const table = (name: string) => {
    const result =
      name === 'profiles'
        ? { data: { name: 'Ada', first_name: 'Ada', settings } }
        : { data: [] };
    const chain: any = {
      select: () => chain,
      eq: () => chain,
      limit: async () => result,
      maybeSingle: async () => result,
      order: () => chain,
    };
    return chain;
  };
  return {
    getClient: () => ({ from: table }),
    tests: { fetchTestResults: async () => [] },
  } as any;
}

const build = (settings: unknown, clientContext: Record<string, unknown> = {}) =>
  buildTrustedCompanionContext(layerWithSettings(settings), 'u1', clientContext as never);

describe('the style the request names', () => {
  it('is honoured, for each of the four', async () => {
    for (const id of ['default', 'coach', 'professor', 'peer']) {
      const context = await build({ tutorStyle: 'professor' }, { tutorStyle: id });
      expect(context.tutorStyle).toBe(id);
    }
  });

  it('does not persist anything — it is this turn only', async () => {
    // Nothing in this module writes; the assertion that matters is that the
    // stored preference is read fresh on the NEXT turn rather than replaced.
    await build({ tutorStyle: 'coach' }, { tutorStyle: 'peer' });
    const next = await build({ tutorStyle: 'coach' });
    expect(next.tutorStyle).toBe('coach');
  });

  it('is ignored when it is not one of the four', async () => {
    for (const junk of ['drill-sergeant', '', 'COACH', 7, { id: 'coach' }, null]) {
      const context = await build({ tutorStyle: 'professor' }, { tutorStyle: junk });
      // Falls through to the stored preference rather than to the raw value.
      expect(context.tutorStyle).toBe('professor');
    }
  });
});

describe('the stored preference', () => {
  it('answers a turn that names no style', async () => {
    const context = await build({ tutorStyle: 'peer' });
    expect(context.tutorStyle).toBe('peer');
  });

  it('falls back to default for an account that has never picked one', async () => {
    for (const settings of [null, {}, { tutorStyle: 'not-a-style' }, 'nonsense']) {
      const context = await build(settings);
      expect(context.tutorStyle).toBe('default');
    }
  });
});
