/**
 * `react-native` is mocked wholesale because this package's jest is plain
 * ts-jest on node (see jest.config.js) — there is no RN preset, so importing
 * the real module fails on its untransformed flow syntax. The mock is the
 * shape `shareStudySet` actually uses.
 */
const mockShare = jest.fn();
jest.mock('react-native', () => ({
  Share: {
    share: (...args: unknown[]) => mockShare(...args),
    sharedAction: 'sharedAction',
    dismissedAction: 'dismissedAction',
  },
}));

import { shareStudySet } from './shareStudySet';

const SHARED_ACTION = 'sharedAction';
const DISMISSED_ACTION = 'dismissedAction';

describe('shareStudySet (mobile)', () => {
  beforeEach(() => {
    mockShare.mockReset();
  });

  function spyShare(impl: (content: { message?: string; title?: string }) => Promise<unknown>) {
    mockShare.mockImplementation(impl);
  }

  it('offers the public web link, never a deep link', async () => {
    // A phone has no `window.location`, and `lanternstudy://…` pasted into a
    // chat is unopenable by anyone without the app installed.
    let shared: { message?: string } = {};
    spyShare(async (content) => {
      shared = content;
      return { action: SHARED_ACTION };
    });

    const result = await shareStudySet({ setId: 'set-1', title: 'Anatomy' });

    expect(result.url).toBe('https://lanternstudy.com/study/sets/set-1');
    expect(shared.message).toContain('https://lanternstudy.com/study/sets/set-1');
    expect(result.shared).toBe(true);
  });

  it('never claims the recipient can open the set', async () => {
    let shared: { message?: string } = {};
    spyShare(async (content) => {
      shared = content;
      return { action: SHARED_ACTION };
    });

    await shareStudySet({ setId: 'set-1', title: 'Anatomy', visibility: 'public' });

    // The settings screen used to say "Anyone with the link can open this
    // set." Set sharing is not implemented; the sheet must not repeat it.
    expect(shared.message).toContain('only you can open the link for now');
    expect((shared.message ?? '').toLowerCase()).not.toContain('anyone with the link');
  });

  it('carries the set name as the sheet subject', async () => {
    let shared: { title?: string } = {};
    spyShare(async (content) => {
      shared = content;
      return { action: DISMISSED_ACTION };
    });

    const result = await shareStudySet({ setId: 'set-1', title: 'Anatomy 101' });

    expect(shared.title).toBe('Anatomy 101');
    // Dismissed is not shared — and it is not an error either.
    expect(result.shared).toBe(false);
  });

  it('swallows a sheet that cannot open', async () => {
    spyShare(async () => {
      throw new Error('no activity found');
    });

    await expect(shareStudySet({ setId: 'set-1', title: 'A' })).resolves.toEqual({
      url: 'https://lanternstudy.com/study/sets/set-1',
      shared: false,
    });
  });
});
