import { describe, expect, it } from 'vitest';

import {
  COVER_MAX_BYTES,
  COVER_MIGRATION,
  COVER_SERVER_UPDATE_MESSAGE,
  coverErrorMessage,
  coverMenuItems,
  coverMenuLabel,
  validateCoverFile,
} from './coverPickerModel';

/**
 * The picker's model. Every rule here has a server-side twin, so these tests
 * are about what the STUDENT is told: a refusal that names the actual limit,
 * a menu that offers "Remove" only when there is something to remove, and a
 * 503 that reads as "not yet" rather than as a broken feature.
 */

const file = (over: Partial<{ type: string; size: number; name: string }> = {}) => ({
  type: 'image/png',
  size: 1024,
  name: 'cover.png',
  ...over,
});

describe('validateCoverFile', () => {
  it('accepts each type the server accepts', () => {
    for (const type of ['image/jpeg', 'image/png', 'image/webp', 'image/gif']) {
      expect(validateCoverFile(file({ type })).ok).toBe(true);
    }
  });

  it('accepts a type the browser reported in upper case', () => {
    expect(validateCoverFile(file({ type: 'IMAGE/PNG' })).ok).toBe(true);
  });

  it('refuses a non-image and says which types work', () => {
    const result = validateCoverFile(file({ type: 'application/pdf', name: 'notes.pdf' }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/JPEG, PNG, WebP or GIF/);
  });

  it('refuses an empty file rather than uploading zero bytes', () => {
    expect(validateCoverFile(file({ size: 0 })).ok).toBe(false);
  });

  it('accepts a file exactly at the ceiling and refuses one byte more', () => {
    expect(validateCoverFile(file({ size: COVER_MAX_BYTES })).ok).toBe(true);
    const tooBig = validateCoverFile(file({ size: COVER_MAX_BYTES + 1 }));
    expect(tooBig.ok).toBe(false);
    // The refusal names the limit AND the size picked, so a student knows how
    // far over they are instead of guessing.
    if (!tooBig.ok) {
      expect(tooBig.message).toContain('10 MB');
      expect(tooBig.message).toMatch(/10\.0 MB/);
    }
  });

  it('refuses nothing-chosen without throwing', () => {
    expect(validateCoverFile(null).ok).toBe(false);
    expect(validateCoverFile(undefined).ok).toBe(false);
  });
});

describe('cover menu', () => {
  it('names itself for what it will do', () => {
    expect(coverMenuLabel(false)).toBe('Add cover');
    expect(coverMenuLabel(true)).toBe('Change cover');
  });

  it('offers only Choose image when there is no cover', () => {
    expect(coverMenuItems(false).map((i) => i.id)).toEqual(['choose']);
  });

  it('offers Remove only once a cover exists, and marks it destructive', () => {
    const items = coverMenuItems(true);
    expect(items.map((i) => i.id)).toEqual(['choose', 'remove']);
    expect(items[1]).toMatchObject({ label: 'Remove cover', destructive: true });
  });

  it('never offers image generation — the app has none', () => {
    const labels = [...coverMenuItems(false), ...coverMenuItems(true)].map((i) => i.label);
    expect(labels.join(' ')).not.toMatch(/generate/i);
  });
});

describe('coverErrorMessage', () => {
  it('turns a 503 into "not yet", with the migration behind Details', () => {
    const err = Object.assign(
      new Error(`Cover images need migration ${COVER_MIGRATION}`),
      { status: 503 },
    );
    const shown = coverErrorMessage(err);
    expect(shown.message).toBe(COVER_SERVER_UPDATE_MESSAGE);
    expect(shown.details).toContain(COVER_MIGRATION);
  });

  it('still names the migration when the 503 body did not', () => {
    const err = Object.assign(new Error('Service Unavailable'), { status: 503 });
    expect(coverErrorMessage(err).details).toContain(COVER_MIGRATION);
  });

  it('shows the server sentence for every other refusal', () => {
    const err = Object.assign(new Error('Cover must be 10 MB or smaller'), { status: 400 });
    const shown = coverErrorMessage(err);
    expect(shown.message).toBe('Cover must be 10 MB or smaller');
    expect(shown.details).toBeUndefined();
  });

  it('falls back to one plain sentence when there is nothing to quote', () => {
    expect(coverErrorMessage({}).message).toBe('Could not save that cover. Try again.');
  });
});
