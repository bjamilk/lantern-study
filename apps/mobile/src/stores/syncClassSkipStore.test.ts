/**
 * The per-set "Skip for now" flag.
 *
 * Pinned here, each of which would show as the card coming back when it should
 * not, or hiding when it should not:
 *
 *  - the decision reaches the ACCOUNT as well as the disk, so skipping on the
 *    phone skips on the laptop, and a set the account already knows hides the
 *    card on a phone that has never seen it;
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

/**
 * The settings store is mocked wholesale: the real one reaches
 * services/supabase → expo-secure-store, which mobile jest (node, no native
 * modules) cannot load. What matters here is the patch this store hands it.
 */
let accountSettings: Record<string, number>;
let accountOwner: string | null;
let updateSettings: jest.Mock;

jest.mock('./settingsStore', () => ({
  useSettingsStore: {
    getState: () => ({
      settings: { syncClassSkipped: accountSettings },
      ownerUserId: accountOwner,
      updateSettings,
    }),
  },
}));

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
  accountSettings = {};
  accountOwner = USER;
  updateSettings = jest.fn(async () => undefined);
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

  it('sends the decision to the account, not only to the disk', async () => {
    useSyncClassSkipStore.getState().markSkipped(USER, SET);
    await Promise.resolve();
    expect(updateSettings).toHaveBeenCalledWith(
      'syncClassSkipped',
      expect.objectContaining({ [SET]: expect.any(Number) })
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

  // The half that did not exist before: a skip made on the laptop.
  it('hides a card the ACCOUNT says was skipped, on a phone that never saw it', async () => {
    accountSettings = { [SET]: 1_700_000_000_000 };
    await useSyncClassSkipStore.getState().hydrate(USER);
    expect(useSyncClassSkipStore.getState().isSkipped(USER, SET)).toBe(true);
  });

  it('hides it even when the settings load lands after hydrate', async () => {
    await useSyncClassSkipStore.getState().hydrate(USER);
    expect(useSyncClassSkipStore.getState().isSkipped(USER, SET)).toBe(false);

    accountSettings = { [SET]: 1_700_000_000_000 };

    expect(useSyncClassSkipStore.getState().isSkipped(USER, SET)).toBe(true);
  });

  it('ignores an account map belonging to somebody else', async () => {
    accountSettings = { [SET]: 1_700_000_000_000 };
    accountOwner = OTHER;
    await useSyncClassSkipStore.getState().hydrate(USER);
    expect(useSyncClassSkipStore.getState().isSkipped(USER, SET)).toBe(false);
  });

  // Self-heal: without this, the first write that failed — or every skip made
  // before this shipped — would be stuck on one device for good.
  it('pushes a skip the account is missing back up', async () => {
    store['lantern.syncClassSkipped.user-1'] = JSON.stringify({ 'set-only-here': true });
    await useSyncClassSkipStore.getState().hydrate(USER);
    expect(updateSettings).toHaveBeenCalledWith(
      'syncClassSkipped',
      expect.objectContaining({ 'set-only-here': expect.any(Number) })
    );
  });

  it('sends nothing back up when the account already has every skip', async () => {
    accountSettings = { [SET]: 1_700_000_000_000 };
    store['lantern.syncClassSkipped.user-1'] = JSON.stringify({ [SET]: true });
    await useSyncClassSkipStore.getState().hydrate(USER);
    expect(updateSettings).not.toHaveBeenCalled();
  });

  it('does nothing without a user', async () => {
    await useSyncClassSkipStore.getState().hydrate(null);
    expect(getItem).not.toHaveBeenCalled();
  });
});
