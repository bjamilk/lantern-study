/**
 * The per-set "Skip for now" flag.
 *
 * Three things pinned, each of which would show as the card coming back when
 * it should not, or hiding when it should not:
 *
 *  - it is keyed by USER as well as by set, so signing in as somebody else on
 *    a shared phone cannot hide their card;
 *  - hydration ORs rather than replaces, because a skip made while the disk
 *    read was in flight must survive it — the read resolves LAST and a naive
 *    `set({...stored})` would drop the newer decision;
 *  - a corrupt or unreadable cache shows the card once more rather than
 *    throwing, which is the harmless direction to fail in.
 */
const store: Record<string, string> = {};
let getItem: jest.Mock;
let setItem: jest.Mock;

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: (...args: unknown[]) => getItem(...args),
    setItem: (...args: unknown[]) => setItem(...args),
  },
}));

import { useSyncClassSkipStore } from './syncClassSkipStore';

const USER = 'user-1';
const OTHER = 'user-2';
const SET = 'set-a';

beforeEach(() => {
  for (const key of Object.keys(store)) delete store[key];
  getItem = jest.fn(async (key: string) => store[key] ?? null);
  setItem = jest.fn(async (key: string, value: string) => {
    store[key] = value;
  });
  useSyncClassSkipStore.setState({ skipped: {}, hydrated: {} });
});

describe('markSkipped / isSkipped', () => {
  it('hides the card for that set and writes it through', async () => {
    const s = useSyncClassSkipStore.getState();
    expect(s.isSkipped(USER, SET)).toBe(false);
    s.markSkipped(USER, SET);
    expect(useSyncClassSkipStore.getState().isSkipped(USER, SET)).toBe(true);
    await Promise.resolve();
    expect(setItem).toHaveBeenCalledWith(
      'lantern.syncClassSkipped.user-1',
      JSON.stringify({ [SET]: true })
    );
  });

  it('does not leak between users or between sets', () => {
    useSyncClassSkipStore.getState().markSkipped(USER, SET);
    const s = useSyncClassSkipStore.getState();
    expect(s.isSkipped(OTHER, SET)).toBe(false);
    expect(s.isSkipped(USER, 'set-b')).toBe(false);
  });

  it('ignores a missing user or set rather than writing a junk key', () => {
    const s = useSyncClassSkipStore.getState();
    s.markSkipped(null, SET);
    s.markSkipped(USER, null);
    expect(setItem).not.toHaveBeenCalled();
    expect(s.isSkipped(null, SET)).toBe(false);
  });

  it('writes once for a set already skipped', async () => {
    useSyncClassSkipStore.getState().markSkipped(USER, SET);
    await Promise.resolve();
    useSyncClassSkipStore.getState().markSkipped(USER, SET);
    expect(setItem).toHaveBeenCalledTimes(1);
  });
});

describe('hydrate', () => {
  it('reads the flags off disk once per user', async () => {
    store['lantern.syncClassSkipped.user-1'] = JSON.stringify({ [SET]: true });
    await useSyncClassSkipStore.getState().hydrate(USER);
    expect(useSyncClassSkipStore.getState().isSkipped(USER, SET)).toBe(true);
    await useSyncClassSkipStore.getState().hydrate(USER);
    expect(getItem).toHaveBeenCalledTimes(1);
  });

  it('keeps a skip made while the read was in flight', async () => {
    store['lantern.syncClassSkipped.user-1'] = JSON.stringify({ 'set-old': true });
    const pending = useSyncClassSkipStore.getState().hydrate(USER);
    // The student taps Skip before the disk answers.
    useSyncClassSkipStore.getState().markSkipped(USER, SET);
    await pending;
    const s = useSyncClassSkipStore.getState();
    // BOTH, not just the one the disk knew about.
    expect(s.isSkipped(USER, SET)).toBe(true);
    expect(s.isSkipped(USER, 'set-old')).toBe(true);
  });

  it('survives a corrupt cache by showing the card once more', async () => {
    store['lantern.syncClassSkipped.user-1'] = 'not json{';
    await expect(useSyncClassSkipStore.getState().hydrate(USER)).resolves.toBeUndefined();
    expect(useSyncClassSkipStore.getState().isSkipped(USER, SET)).toBe(false);
  });

  it('ignores a stored shape that is not a map of flags', async () => {
    store['lantern.syncClassSkipped.user-1'] = JSON.stringify([SET]);
    await useSyncClassSkipStore.getState().hydrate(USER);
    expect(useSyncClassSkipStore.getState().isSkipped(USER, SET)).toBe(false);
  });

  it('does nothing without a user', async () => {
    await useSyncClassSkipStore.getState().hydrate(null);
    expect(getItem).not.toHaveBeenCalled();
  });
});
