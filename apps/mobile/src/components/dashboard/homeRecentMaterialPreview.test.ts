/**
 * The phone's half of the "Recent materials" preview.
 *
 * `DashboardScreen` builds each offline material row with `notePreviewText`
 * (and `CourseRoomScreen` renders the same field), so the leak web showed —
 * a mastery note's raw snapshot printed as the tile's preview, check answers
 * and all — is one helper away on this platform too. These pin the same two
 * shapes web pins: the whole body, and the 120-character slice the server
 * used to send instead of a built preview.
 */
import { notePreviewText } from '@lantern/shared/learning';

const masteryBody =
  'Cell transport · Mastery\n\n```lantern-lesson\n' +
  JSON.stringify({
    mode: 'mastery',
    pages: [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }],
    transcript: [{ role: 'assistant', text: 'The answer is osmosis.' }],
  }) +
  '\n```\n';

describe('the phone’s material tile preview', () => {
  it('names a mastery plan rather than quoting its JSON', () => {
    expect(notePreviewText(masteryBody)).toBe('Mastery plan · 3 steps');
  });

  it('types a truncated snapshot instead of printing the braces', () => {
    const preview = notePreviewText(masteryBody.slice(0, 60));
    expect(preview).toBe('Structured note');
    expect(preview).not.toContain('{');
  });

  it('never leaks a check answer the snapshot carries', () => {
    expect(notePreviewText(masteryBody)).not.toContain('osmosis');
    expect(notePreviewText(masteryBody.slice(0, 200))).not.toContain('osmosis');
  });

  it('still reads an ordinary note as its own first line', () => {
    expect(notePreviewText('## Osmosis\nWater moves down its gradient.')).toContain(
      'Water moves down its gradient.'
    );
  });
});
