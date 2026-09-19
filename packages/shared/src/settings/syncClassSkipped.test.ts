/**
 * The account-wide "Skip for now" map for the Sync-with-your-class card.
 *
 * This key exists because the flag used to live in two places that never met:
 * web's `useUIStore.syncClassSkipped` (localStorage) and the phone's
 * `syncClassSkipStore` (AsyncStorage). Skipping on one device left the card up
 * on the other.
 *
 * What is pinned here is everything that could go wrong QUIETLY once clients
 * write set ids straight into the profile blob: junk keys and junk values must
 * be dropped rather than stored, a privileged key name must not survive under
 * this key, the map must not grow without bound (it is read on every sign-in),
 * and a merge must never un-skip a card — a client that is behind, an offline
 * patch replayed late, or a stale tab all have to be harmless.
 */
import {
  DEFAULT_USER_SETTINGS,
  SYNC_CLASS_SKIPPED_CAP,
  applySettingsPatch,
  mergeSyncClassSkipped,
  normalizeSyncClassSkipped,
  normalizeUserSettings,
  subtractSettingsPatch,
  mergeSettingsPatches,
} from './index';

describe('normalizeSyncClassSkipped', () => {
  it('keeps set ids mapped to a timestamp', () => {
    expect(normalizeSyncClassSkipped({ 'set-a': 1700, 'set-b': 1800 })).toEqual({
      'set-a': 1700,
      'set-b': 1800,
    });
  });

  it('drops values that are not a usable timestamp', () => {
    expect(
      normalizeSyncClassSkipped({
        ok: 1700,
        yes: true,
        word: 'true',
        zero: 0,
        negative: -5,
        infinite: Number.POSITIVE_INFINITY,
        nested: { at: 1700 },
        list: [1700],
        nothing: null,
      })
    ).toEqual({ ok: 1700 });
  });

  it('drops keys that are not id-shaped', () => {
    expect(
      normalizeSyncClassSkipped({
        'set-a': 1700,
        '': 1700,
        'has space': 1700,
        'has/slash': 1700,
        ['x'.repeat(65)]: 1700,
      })
    ).toEqual({ 'set-a': 1700 });
  });

  it('answers an empty map for anything that is not an object', () => {
    for (const raw of [null, undefined, 'set-a', 7, ['set-a']]) {
      expect(normalizeSyncClassSkipped(raw)).toEqual({});
    }
  });

  it('caps the map, dropping the OLDEST decisions', () => {
    const raw: Record<string, number> = {};
    for (let i = 0; i < SYNC_CLASS_SKIPPED_CAP + 10; i += 1) {
      raw[`set-${i}`] = 1000 + i;
    }

    const kept = normalizeSyncClassSkipped(raw);

    expect(Object.keys(kept)).toHaveLength(SYNC_CLASS_SKIPPED_CAP);
    // The ten oldest went; the newest — including the one just made — stayed.
    expect(kept['set-0']).toBeUndefined();
    expect(kept['set-9']).toBeUndefined();
    expect(kept['set-10']).toBe(1010);
    expect(kept[`set-${SYNC_CLASS_SKIPPED_CAP + 9}`]).toBe(1000 + SYNC_CLASS_SKIPPED_CAP + 9);
  });
});

describe('mergeSyncClassSkipped', () => {
  it('unions both sides and keeps the later timestamp', () => {
    expect(
      mergeSyncClassSkipped({ 'set-a': 100, 'set-b': 200 }, { 'set-a': 900, 'set-c': 300 })
    ).toEqual({ 'set-a': 900, 'set-b': 200, 'set-c': 300 });
  });

  it('cannot un-skip a set: a patch that omits it leaves it skipped', () => {
    expect(mergeSyncClassSkipped({ 'set-a': 100 }, {})).toEqual({ 'set-a': 100 });
    expect(mergeSyncClassSkipped({ 'set-a': 100 }, { 'set-a': false })).toEqual({
      'set-a': 100,
    });
  });
});

describe('the settings blob', () => {
  it('normalizes the key on the way out of a stored profile', () => {
    const settings = normalizeUserSettings({
      ...DEFAULT_USER_SETTINGS,
      syncClassSkipped: { 'set-a': 1700, junk: 'yes' },
    });
    expect(settings.syncClassSkipped).toEqual({ 'set-a': 1700 });
  });

  it('merges a patch onto what is stored rather than replacing it', () => {
    const base = normalizeUserSettings({
      ...DEFAULT_USER_SETTINGS,
      syncClassSkipped: { 'set-a': 100 },
    });

    const next = applySettingsPatch(base, { syncClassSkipped: { 'set-b': 200 } });

    expect(next.syncClassSkipped).toEqual({ 'set-a': 100, 'set-b': 200 });
  });

  it('cannot smuggle a privileged key in under this one', () => {
    const next = applySettingsPatch(normalizeUserSettings(DEFAULT_USER_SETTINGS), {
      syncClassSkipped: {
        'set-a': 100,
        is_banned: true,
        is_platform_admin: 1,
      },
    } as never);

    // Both names are id-shaped, so the charset alone would have stored them
    // nested under this map, looking like flags to the next reader that walks
    // the blob. `PRIVILEGED_SETTINGS_KEYS` — the same list the API strips with
    // — keeps them out of the map as well as off the top level.
    expect((next as unknown as Record<string, unknown>).is_banned).toBeUndefined();
    expect(
      (next as unknown as Record<string, unknown>).is_platform_admin
    ).toBeUndefined();
    expect(next.syncClassSkipped?.is_banned).toBeUndefined();
    expect(next.syncClassSkipped?.is_platform_admin).toBeUndefined();
    expect(next.syncClassSkipped?.['set-a']).toBe(100);
  });

  it('leaves the map alone when the patch does not carry it', () => {
    const base = normalizeUserSettings({
      ...DEFAULT_USER_SETTINGS,
      syncClassSkipped: { 'set-a': 100 },
    });

    const next = applySettingsPatch(base, { study: { dailyCardGoal: 30 } });

    expect(next.syncClassSkipped).toEqual({ 'set-a': 100 });
  });
});

describe('the offline patch queue (mobile)', () => {
  it('accumulates two skips made before a sync instead of losing the first', () => {
    const merged = mergeSettingsPatches(
      { syncClassSkipped: { 'set-a': 100 } },
      { syncClassSkipped: { 'set-b': 200 } }
    );
    expect(merged.syncClassSkipped).toEqual({ 'set-a': 100, 'set-b': 200 });
  });

  it('subtracts only the keys the sync actually sent', () => {
    const remaining = subtractSettingsPatch(
      { syncClassSkipped: { 'set-a': 100, 'set-b': 200 } },
      { syncClassSkipped: { 'set-a': 100 } }
    );
    expect(remaining.syncClassSkipped).toEqual({ 'set-b': 200 });
  });

  it('clears the pending patch once every key has been sent', () => {
    const remaining = subtractSettingsPatch(
      { syncClassSkipped: { 'set-a': 100 } },
      { syncClassSkipped: { 'set-a': 100 } }
    );
    expect(remaining.syncClassSkipped).toBeUndefined();
  });
});
