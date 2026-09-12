import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { STUDY_SET_HOME_TOOLS, STUDY_SET_RECOMMENDED_CARDS } from '@lantern/shared';

/**
 * One door, one name.
 *
 * A device pass found the companion answering to five names at once — "Ask",
 * "Ask Lantern", "AI", "Lantern AI", and the room's tutor row taken for the
 * same thing. The door is **Ask Lantern** on every surface that labels a door;
 * **Lantern AI** is the product name and belongs to the panel header and the
 * credit rail alone. These read the sources, because the strings live in JSX a
 * studio test would have to mount a whole session to reach.
 */
const read = (file: string) =>
  fs.readFileSync(path.join(__dirname, file), 'utf8');

describe('the companion door wears one name on web', () => {
  it('shares the mobile door labels through shared', () => {
    expect(STUDY_SET_HOME_TOOLS.find((tool) => tool.id === 'ask')?.label).toBe('Ask Lantern');
    expect(STUDY_SET_RECOMMENDED_CARDS.find((card) => card.id === 'ask')?.label).toBe('Ask Lantern');
  });

  it('labels the studio doors "Ask Lantern", not "Open in Lantern AI"', () => {
    for (const file of ['RecapStudio.tsx', 'LessonStudio.tsx', 'LectureStudio.tsx']) {
      const source = read(file);
      expect(source).toContain('Ask Lantern');
      expect(source).not.toContain('Open in Lantern AI');
    }
  });
});
