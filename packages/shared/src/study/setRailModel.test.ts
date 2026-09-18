import { buildSetRailModel, studySetIdForRoute } from './setRailModel';

const NOTES = [
  { id: 'n1', title: 'Lecture — 11 Sep', folderId: 'f1' },
  { id: 'n2', title: 'Week 2 summary', folderId: 'f1' },
  { id: 'n3', title: 'Loose page', folderId: null },
  { id: 'n4', title: '   ', folderId: 'gone' },
];
const FOLDERS = [
  { id: 'f1', name: 'Lectures' },
  { id: 'f2', name: 'Empty folder' },
];

function model(activeRoute?: string) {
  return buildSetRailModel({
    setId: 'set-1',
    setTitle: 'Client Centre Care',
    notes: NOTES,
    folders: FOLDERS,
    activeRoute,
  });
}

describe('buildSetRailModel', () => {
  it('names the set and offers the hub as the switcher fallback', () => {
    const rail = model();
    expect(rail.setTitle).toBe('Client Centre Care');
    expect(rail.switcher).toEqual({ label: 'Client Centre Care', fallbackPath: '/study' });
  });

  it('falls back to a generic title rather than an empty pill', () => {
    const rail = buildSetRailModel({ setId: 's', setTitle: '   ' });
    expect(rail.setTitle).toBe('Study set');
  });

  it('lists the primary rows in the reference order', () => {
    expect(model().primary.map((row) => row.label)).toEqual([
      'Study plan',
      'Chat',
      'Tutor',
      'Record lecture',
    ]);
  });

  it('gives Chat no URL — it opens the set-scoped companion panel', () => {
    const chat = model().primary.find((row) => row.id === 'chat');
    expect(chat?.action).toEqual({ kind: 'companion' });
  });

  it('routes every primary row into THIS set', () => {
    const rail = model();
    const paths = rail.primary
      .filter((row) => row.action.kind === 'path')
      .map((row) => (row.action as { path: string }).path);
    expect(paths).toEqual([
      '/study/sets/set-1/plan',
      '/study/sets/set-1/lesson',
      '/study/sets/set-1/lecture',
    ]);
  });

  it('lists the practice drawer in the reference order, led by the hub', () => {
    expect(model().practice.items.map((row) => row.label)).toEqual([
      // Wave 3: the hub itself, because the drawer's header is a disclosure
      // and cannot also be the link to it.
      'All practice',
      'Quiz',
      'Test',
      'Flashcards',
      'Play',
      'Essay',
      'Recap',
      // Lantern's own door, kept at the end: the reference's drawer stops at
      // Recap, and the set-home wall no longer draws Walkthrough either.
      'Walkthrough',
    ]);
  });

  it('lights the open activity and opens the drawer that holds it', () => {
    const rail = model('/study/sets/set-1/quiz');
    expect(rail.practice.hasActive).toBe(true);
    expect(rail.practice.items.find((row) => row.id === 'quiz')?.active).toBe(true);
    expect(rail.primary.some((row) => row.active)).toBe(false);
  });

  it('treats /calendar as the study plan and /read as the walkthrough', () => {
    expect(model('/study/sets/set-1/calendar').primary.find((r) => r.id === 'plan')?.active).toBe(
      true
    );
    expect(
      model('/study/sets/set-1/read').practice.items.find((r) => r.id === 'walkthrough')?.active
    ).toBe(true);
  });

  it('lights nothing when the path belongs to another set', () => {
    const rail = model('/study/sets/other/quiz');
    expect(rail.practice.hasActive).toBe(false);
    expect(rail.upload.active).toBe(false);
    expect(rail.materials.folders.every((f) => !f.active)).toBe(true);
  });

  it('lights nothing outside a set', () => {
    const rail = model('/library/notes');
    expect(rail.primary.some((row) => row.active)).toBe(false);
    expect(rail.practice.hasActive).toBe(false);
  });

  it('points Upload at the set import flow and lights it there', () => {
    expect(model().upload.action).toEqual({ kind: 'path', path: '/study/sets/set-1/add' });
    expect(model('/study/sets/set-1/add').upload.active).toBe(true);
  });

  it('groups notes under their folders and drops folders with none', () => {
    const { materials } = model();
    expect(materials.folders.map((f) => f.label)).toEqual(['Lectures']);
    expect(materials.folders[0].notes.map((n) => n.label)).toEqual([
      'Lecture — 11 Sep',
      'Week 2 summary',
    ]);
  });

  it('keeps a note whose folder is missing rather than losing it', () => {
    const { materials } = model();
    expect(materials.unfiled.map((n) => n.label)).toEqual(['Loose page', 'Untitled note']);
    expect(materials.total).toBe(4);
  });

  it('opens each note inside the set, and marks the open one', () => {
    const rail = model('/study/sets/set-1/notes/n2');
    const folder = rail.materials.folders[0];
    expect(folder.notes[1].path).toBe('/study/sets/set-1/notes/n2');
    expect(folder.notes[1].active).toBe(true);
    expect(folder.active).toBe(true);
    expect(folder.notes[0].active).toBe(false);
  });

  it('sends View all to the set-scoped Materials page', () => {
    // Wave 3: the set's own Materials page, not its notes list and certainly
    // not the account-wide Library, which has no per-set filter.
    expect(model().materials.viewAllPath).toBe('/study/sets/set-1/materials');
  });

  it('survives a set with no notes or folders at all', () => {
    const rail = buildSetRailModel({ setId: 'set-1' });
    expect(rail.materials).toMatchObject({ folders: [], unfiled: [], total: 0 });
    expect(rail.primary).toHaveLength(4);
  });
});

describe('studySetIdForRoute', () => {
  it.each([
    ['/study/sets/abc', 'abc'],
    ['/study/sets/abc/quiz', 'abc'],
    ['/study/sets/abc/notes/n1', 'abc'],
    ['/study', null],
    ['/library/notes', null],
    ['/study/courses/c1', null],
    [null, null],
    [undefined, null],
  ])('%s → %s', (path, expected) => {
    expect(studySetIdForRoute(path as string | null | undefined)).toBe(expected);
  });
});
