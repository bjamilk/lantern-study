/**
 * Home's "Recent materials" tile preview.
 *
 * Live (AH smoke 1.0.58) the tile for a mastery-plan note printed the note's
 * raw snapshot — `{"mode":"mastery","pages":[{...` — because the tile built
 * its preview from the body, and the body of a lesson note IS machine data.
 * The preview now goes through the typed helper, which names the plan instead
 * of quoting it (and never shows a check question's answer, which the JSON
 * also carries).
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

const masteryBody =
  'Cell transport · Mastery\n\n```lantern-lesson\n' +
  JSON.stringify({
    mode: 'mastery',
    pages: [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }],
    transcript: [{ role: 'assistant', text: 'The answer is osmosis.' }],
  }) +
  '\n```\n';

const notes = [
  { id: 'n1', title: 'Cell transport', body: masteryBody, studySetId: 's1', updatedAt: '2026-01-02' },
  { id: 'n2', title: 'Osmosis notes', body: '## Osmosis\nWater moves down its gradient.', studySetId: 's1', updatedAt: '2026-01-01' },
];

vi.mock('../../stores/notesStore', () => ({
  useNotesStore: (selector: (s: { notes: typeof notes }) => unknown) => selector({ notes }),
}));
vi.mock('../../stores/studySetStore', () => ({
  useStudySetStore: (selector: (s: { lastOpenedId: string }) => unknown) =>
    selector({ lastOpenedId: 's1' }),
}));
vi.mock('../../stores/studyResumeStore', () => ({
  useStudyResumeStore: () => ({
    // The server's own short field, as it used to arrive: a raw slice of the
    // body. The tile must not print it even when it is all it has.
    recentMaterials: [
      {
        id: 'n1',
        title: 'Cell transport',
        studySetId: 's1',
        kind: 'note',
        href: 'n1',
        preview: masteryBody.slice(0, 60),
        updatedAt: '2026-01-02',
      },
      {
        id: 'n3',
        title: 'Unloaded note',
        studySetId: 's1',
        kind: 'note',
        href: 'n3',
        preview: masteryBody.slice(0, 60),
        updatedAt: '2026-01-01',
      },
    ],
    recentActivities: [],
    loadResume: () => {},
  }),
}));

const { HomeRecentMaterials } = await import('./HomeRecentMaterials');

describe('HomeRecentMaterials tile preview', () => {
  const html = renderToStaticMarkup(<HomeRecentMaterials onOpenNote={() => {}} />);

  it('names the plan instead of printing its JSON', () => {
    expect(html).toContain('Mastery plan · 3 steps');
  });

  it('prints no fragment of the snapshot — braces, keys or transcript', () => {
    expect(html).not.toContain('{&quot;mode&quot;');
    expect(html).not.toContain('lantern-lesson');
    expect(html).not.toContain('The answer is osmosis');
  });

  it('types a material this client has NOT loaded, from the server field alone', () => {
    // n3 has no local body, so all the tile holds is the truncated slice.
    expect(html).toContain('Structured note');
  });
});
