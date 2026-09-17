/**
 * The companion rail's stored preference.
 *
 * Two values, one per surface, and the reason they are two is that the set home
 * and a studio want opposite defaults. The action below is the ONLY way either
 * is written, so a programmatic open — "Ask Lantern", a note attached to a
 * question — cannot quietly become the student's default.
 *
 * `partialize` is asserted as SOURCE rather than by round-tripping it: the web
 * suite runs in a plain-Node environment where the persist middleware has no
 * storage at all, the same reason `uiStore.focusStandDown.test.ts` gives.
 */
import fs from 'fs';
import path from 'path';
import { beforeEach, describe, expect, it } from 'vitest';

import { useUIStore } from './uiStore';
import { COMPANION_RAIL_DEFAULTS } from '../components/study/companionRail';

beforeEach(() => {
  useUIStore.setState({ companionRail: { ...COMPANION_RAIL_DEFAULTS } });
});

describe('companionRail defaults', () => {
  it('keeps the companion on the set home and stands it down in a studio', () => {
    expect(useUIStore.getState().companionRail).toEqual({ home: 'open', focus: 'collapsed' });
  });
});

describe('setCompanionRailPreference', () => {
  it('writes only the surface it was given', () => {
    useUIStore.getState().setCompanionRailPreference('focus', 'open');
    expect(useUIStore.getState().companionRail).toEqual({ home: 'open', focus: 'open' });

    useUIStore.getState().setCompanionRailPreference('home', 'collapsed');
    expect(useUIStore.getState().companionRail).toEqual({ home: 'collapsed', focus: 'open' });
  });

  it('is a no-op when nothing changes, so a re-render cannot churn the store', () => {
    const before = useUIStore.getState().companionRail;
    useUIStore.getState().setCompanionRailPreference('home', 'open');
    expect(useUIStore.getState().companionRail).toBe(before);
  });
});

describe('persistence', () => {
  it('lists companionRail in the partialize, or the choice dies on reload', () => {
    const source = fs.readFileSync(path.join(__dirname, 'uiStore.ts'), 'utf8');
    const partialize = source.slice(source.indexOf('partialize:'));
    expect(partialize).toContain('companionRail: state.companionRail,');
  });
});
