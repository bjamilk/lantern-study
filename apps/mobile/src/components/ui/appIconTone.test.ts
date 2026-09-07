import { readFileSync } from 'fs';
import { join } from 'path';
import {
  DUOTONE_BLOB_ICONS,
  isDuotoneBlob,
  resolveIconTone,
} from './appIconTone';

const ACCENT = { ink: '#0369a1', tint: '#e0f2fe' };

/**
 * The icon names, read out of the map's SOURCE rather than imported: the map
 * pulls 175 lucide modules, which this node test environment cannot transform.
 * Reading the text still catches the thing that matters — a deny-list entry
 * that no longer names a real icon, and so silently stops applying.
 */
function appIconNames(): string[] {
  const source = readFileSync(join(__dirname, 'appIconMap.ts'), 'utf8');
  const body = source.slice(source.indexOf('export const APP_ICONS = {'));
  return Array.from(body.matchAll(/^ {2}'([^']+)':/gm)).map((m) => m[1]);
}

describe('resolveIconTone', () => {
  it('neutral keeps the caller colour and never fills', () => {
    expect(resolveIconTone('neutral', ACCENT, '#111827', 'home')).toEqual({
      stroke: '#111827',
      fill: null,
      disc: null,
    });
  });

  it('feature strokes in the ink and never fills', () => {
    expect(resolveIconTone('feature', ACCENT, '#111827', 'home')).toEqual({
      stroke: ACCENT.ink,
      fill: null,
      disc: null,
    });
  });

  it('active is a tint fill under an ink stroke', () => {
    expect(resolveIconTone('active', ACCENT, undefined, 'home')).toEqual({
      stroke: ACCENT.ink,
      fill: ACCENT.tint,
      disc: null,
    });
  });

  it('active falls back to a tint disc for glyphs a fill would flatten', () => {
    expect(resolveIconTone('active', ACCENT, undefined, 'person-circle')).toEqual({
      stroke: ACCENT.ink,
      fill: null,
      disc: ACCENT.tint,
    });
  });

  it('degrades to neutral rather than invisible when no accent is supplied', () => {
    expect(resolveIconTone('active', null, '#111827', 'home')).toEqual({
      stroke: '#111827',
      fill: null,
      disc: null,
    });
  });
});

describe('DUOTONE_BLOB_ICONS', () => {
  it('names only real icons', () => {
    const names = new Set(appIconNames());
    expect(names.size).toBeGreaterThan(100);
    for (const name of DUOTONE_BLOB_ICONS) {
      expect(names.has(name)).toBe(true);
    }
  });

  it('covers the container glyphs whose meaning is their interior', () => {
    expect(isDuotoneBlob('checkmark-circle')).toBe(true);
    expect(isDuotoneBlob('square')).toBe(true);
    expect(isDuotoneBlob('school')).toBe(false);
  });
});
