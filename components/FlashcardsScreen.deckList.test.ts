import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const source = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'FlashcardsScreen.tsx'),
  'utf8'
);

describe('Library deck tiles', () => {
  it('does not paint index-based rainbow headers', () => {
    expect(source).not.toContain('ACCENT_GRADIENTS');
    expect(source).not.toContain('bg-gradient-to-r');
  });

  it('uses the shared FeatureDisc list-row and study-first helpers', () => {
    expect(source).toContain('FeatureDisc');
    expect(source).toContain('deckDisplayTitle');
    expect(source).toContain('sortDecksForList');
    expect(source).toContain('dueCards > 0');
  });
});
