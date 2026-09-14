import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The first-paint regression this file exists for.
 *
 * `/study` branched on `sets.length === 0`, which is TRUE for every render
 * before the sets query resolves. A returning student with four sets was shown
 * the empty state — `Create study set`, no toolbar, no search, no sort — and
 * the real content only appeared a frame later. The empty state must be
 * reachable ONLY from `loaded && sets.length === 0`.
 *
 * Server rendering keeps the suite off a DOM it does not need and off the
 * effects that would fire the real queries; the stores are stubbed so each case
 * is exactly one store shape.
 */

const studySetState = {
  sets: [] as unknown[],
  folders: [] as unknown[],
  loaded: false,
  loadError: null as string | null,
  lastOpenedId: null as string | null,
  loadSets: async () => [],
  loadFolders: async () => [],
  createSet: async () => ({}),
  updateSet: async () => ({}),
  removeSet: async () => undefined,
  touchOpened: () => undefined,
  createFolder: async () => ({}),
};

vi.mock('../stores/studySetStore', () => ({
  useStudySetStore: (selector: (state: typeof studySetState) => unknown) => selector(studySetState),
}));
vi.mock('../stores/academicStore', () => ({
  useAcademicStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ loadMyCourses: async () => undefined, resolveCourse: () => null }),
}));
vi.mock('../stores/notesStore', () => ({
  useNotesStore: (selector: (state: Record<string, unknown>) => unknown) => selector({ notes: [] }),
}));
vi.mock('../stores/toastStore', () => ({
  useToastStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ showToast: () => undefined }),
}));

const { StudyHubScreen } = await import('./StudyHubScreen');

const render = () =>
  renderToStaticMarkup(
    <StudyHubScreen
      dueCardsCount={0}
      decks={[]}
      onStartDueReview={() => undefined}
      onOpenLibrary={() => undefined}
      onOpenAITools={() => undefined}
      onSelectDeck={() => undefined}
      onOpenStudySet={() => undefined}
    />
  );

const visibleText = (html: string) => html.replace(/<[^>]*>/g, ' ');

describe('StudyHubScreen first paint', () => {
  beforeEach(() => {
    studySetState.sets = [];
    studySetState.folders = [];
    studySetState.loaded = false;
    studySetState.loadError = null;
  });

  it('does not claim the user has nothing while the sets query is still in flight', () => {
    const html = render();
    expect(html).toContain('aria-busy="true"');
    expect(visibleText(html)).toContain('Loading your study sets');
    // The empty state's own sentence — the one the bug painted over four real sets.
    expect(visibleText(html)).not.toContain('Name a set to organize your materials');
  });

  it('shows a retry state when the list request fails with no cached sets', () => {
    studySetState.loadError = 'Too Many Requests';
    const html = render();
    expect(html).not.toContain('aria-busy="true"');
    expect(visibleText(html)).toContain('Could not load your study sets');
    expect(visibleText(html)).toContain('asked for them too quickly');
    expect(visibleText(html)).not.toContain('Name a set to organize your materials');
  });

  it('shows the empty state only once the query resolved to zero sets', () => {
    studySetState.loaded = true;
    const html = render();
    expect(html).not.toContain('aria-busy="true"');
    expect(visibleText(html)).toContain('Name a set to organize your materials');
  });

  it('renders the toolbar and the create tile first when sets arrive', () => {
    studySetState.loaded = true;
    studySetState.sets = [
      {
        id: 'set-1',
        userId: 'u1',
        title: 'Client Centre Care',
        createdAt: '2026-09-01T00:00:00.000Z',
        updatedAt: '2026-09-01T00:00:00.000Z',
        lastStudiedAt: null,
      },
    ];
    const html = render();
    const text = visibleText(html);
    expect(html).toContain('Search study sets…');
    expect(text).toContain('Create folder');
    expect(text).toContain('Client Centre Care');
    // The dashed tile leads the grid, so "new" comes before "old".
    expect(text.indexOf('Name a set, then add materials.')).toBeLessThan(
      text.indexOf('Client Centre Care')
    );
    // The sort control is a menu button, not the unstyled native select.
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).not.toContain('<select');
  });

  it('keeps Delete behind the kebab instead of printing it on the card face', () => {
    studySetState.loaded = true;
    studySetState.sets = [
      {
        id: 'set-2',
        userId: 'u1',
        title: 'PHARM 212',
        createdAt: '2026-09-01T00:00:00.000Z',
        updatedAt: '2026-09-01T00:00:00.000Z',
        lastStudiedAt: null,
      },
    ];
    const html = render();
    // The menu renders through a portal only once opened, so nothing destructive
    // is in the card's own markup.
    expect(visibleText(html)).not.toContain('Delete');
    expect(html).toContain('Actions for PHARM 212');
  });
});
