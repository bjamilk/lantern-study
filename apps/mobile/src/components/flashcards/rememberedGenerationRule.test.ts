import { readFileSync } from 'fs';
import { join } from 'path';
import { DEFAULT_FLASHCARD_GENERATION_OPTIONS } from '@lantern/shared/flashcards/generationOptions';
import {
  isDefaultGeneration,
  resolveRememberedGeneration,
  sameGeneration,
} from './rememberedGenerationRule';

describe('resolveRememberedGeneration', () => {
  it('falls back to the shipped default when nothing is remembered', () => {
    expect(resolveRememberedGeneration({})).toEqual(DEFAULT_FLASHCARD_GENERATION_OPTIONS);
  });

  it('opens on the stored choice when there is no device mirror', () => {
    expect(resolveRememberedGeneration({ stored: { count: 30, typeMix: 'cloze' } })).toEqual({
      count: 30,
      typeMix: 'cloze',
    });
  });

  it('opens on the device mirror when nothing is stored', () => {
    expect(resolveRememberedGeneration({ mirrored: { count: 10, typeMix: 'basic' } })).toEqual({
      count: 10,
      typeMix: 'basic',
    });
  });

  it('THE DEFECT: the mirror wins when sync handed back the untouched default', () => {
    // What the device did: generate with 10 + Questions, the settings sync
    // drops the category, the server's reply restores 20 + mixed, and the
    // sheet reopened on 20 + "A mix".
    expect(
      resolveRememberedGeneration({
        stored: { count: 20, typeMix: 'mixed' },
        mirrored: { count: 10, typeMix: 'basic' },
      })
    ).toEqual({ count: 10, typeMix: 'basic' });
  });

  it('a real choice from another device still beats this device mirror', () => {
    expect(
      resolveRememberedGeneration({
        stored: { count: 30, typeMix: 'cloze' },
        mirrored: { count: 10, typeMix: 'basic' },
      })
    ).toEqual({ count: 30, typeMix: 'cloze' });
  });

  it('sanitises whatever storage held rather than trusting it', () => {
    expect(
      resolveRememberedGeneration({ mirrored: { count: 5000, typeMix: 'sideways' } })
    ).toEqual({
      count: expect.any(Number),
      typeMix: 'mixed',
    });
    expect(
      resolveRememberedGeneration({ mirrored: { count: 5000, typeMix: 'sideways' } }).count
    ).toBeLessThanOrEqual(100);
  });

  it('ignores non-objects on either side', () => {
    expect(resolveRememberedGeneration({ stored: 'nope', mirrored: [1, 2] })).toEqual(
      DEFAULT_FLASHCARD_GENERATION_OPTIONS
    );
  });
});

describe('sameGeneration / isDefaultGeneration', () => {
  it('compares only the two remembered fields', () => {
    expect(
      sameGeneration({ count: 10, typeMix: 'basic' }, { count: 10, typeMix: 'basic', difficulty: 'hard' })
    ).toBe(true);
    expect(sameGeneration({ count: 10, typeMix: 'basic' }, { count: 20, typeMix: 'basic' })).toBe(
      false
    );
  });

  it('recognises the shipped default', () => {
    expect(isDefaultGeneration(DEFAULT_FLASHCARD_GENERATION_OPTIONS)).toBe(true);
    expect(isDefaultGeneration({ count: 10, typeMix: 'basic' })).toBe(false);
  });
});

/**
 * The write-on-use rule and the open-on-store rule are both in components the
 * node test environment cannot render, so they are asserted from the source.
 */
describe('generation sheet wiring', () => {
  const remembered = readFileSync(join(__dirname, 'rememberedGeneration.ts'), 'utf8');
  const modal = readFileSync(join(__dirname, '..', 'AIGenerateFlashcardsModal.tsx'), 'utf8');

  it('writes the choice to the shared settings category on use', () => {
    expect(remembered).toContain("updateSettings('flashcardGeneration'");
  });

  it('also writes the device mirror, so a dropped sync cannot lose the choice', () => {
    expect(remembered).toContain('AsyncStorage.setItem(REMEMBERED_GENERATION_KEY');
  });

  it('remembers on generate, not on every chip tap', () => {
    const generate = modal.slice(modal.indexOf('const handleGenerate'));
    expect(generate).toContain('rememberGeneration(options)');
    expect(modal).not.toContain('rememberGeneration({ ...o');
  });

  it('re-reads on every open, not only on first mount', () => {
    expect(modal).toContain('if (!visible) return;');
    expect(modal).toContain('readRememberedGeneration()');
    expect(modal).toContain('hydrateRememberedGeneration()');
  });
});
