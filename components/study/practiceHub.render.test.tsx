// @vitest-environment jsdom
/**
 * The Practice hub at the anatomy measured off StudyFetch on 2026-09-17
 * (docs/studyfetch-mysets-2026-09-17/02-style-and-subpages.md, §Practice).
 *
 * What is pinned is the thing the hub exists for: quizzes and tests are ONE
 * destination with three tabs, where Lantern had two unconnected pages. Plus
 * the deep-link rule — the tab is read off the path activity, so `/quiz` and
 * `/test` keep meaning what they meant and simply open the hub on their tab.
 *
 * And, since #130's follow-up, the FOLDERS: the real ones that live inside a
 * set, the breadcrumb into them, and — the state that actually ships, because
 * 20260918120000 is hand-applied and the web deploy lands first — the degraded
 * hub that draws none of it.
 */
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import {
  PracticeHub,
  PRACTICE_TABS,
  practiceTabForActivity,
  practiceTabLabel,
} from './PracticeHub';
import type { ArtifactCard } from './StudySetArtifactLibrary';
import { workspaceActivityFromPath, type StudySetPathActivity } from '@lantern/shared';

vi.mock('./ViewModeToggle', async () => {
  const actual = await vi.importActual<typeof import('./ViewModeToggle')>('./ViewModeToggle');
  return {
    ...actual,
    useViewMode: (_surface: string, fallback: 'grid' | 'list') => [fallback, () => {}],
  };
});

const card = (
  id: string,
  title: string,
  icon: ArtifactCard['icon'],
  practiceFolderId?: string | null
): ArtifactCard => ({
  id,
  title,
  feature: 'tests',
  icon,
  // ABSENT, not null, when no folder is named: that is the difference between
  // "this database has no folder column" and "this item is unfiled".
  ...(practiceFolderId === undefined ? {} : { practiceFolderId }),
});

const QUIZZES = [card('q1', 'Mitosis quiz', 'help-circle', 'f1')];
const TESTS = [card('t1', 'Midterm practice', 'clipboard', null)];

const FOLDERS = [
  {
    id: 'f1',
    studySetId: 'set-1',
    title: 'Week 1',
    itemCount: 2,
    createdAt: '2026-09-18T00:00:00.000Z',
    updatedAt: '2026-09-18T00:00:00.000Z',
  },
];

const hub = (extra: Partial<React.ComponentProps<typeof PracticeHub>> = {}) =>
  renderToStaticMarkup(
    <PracticeHub
      setLabel="BIO 201"
      tab="all"
      onTabChange={() => {}}
      quizzes={QUIZZES}
      tests={TESTS}
      onOpen={() => {}}
      onCreate={() => {}}
      {...extra}
    />
  );

describe('the hub frame', () => {
  it('is titled Practice and offers one Create menu', () => {
    const html = hub();
    expect(html).toContain('Practice');
    expect(html).toContain('Create');
    expect(html).toContain('aria-haspopup="menu"');
  });

  it('is a real tablist of the three measured tabs', () => {
    const html = hub();
    expect(html).toContain('role="tablist"');
    expect(html).toContain('role="tabpanel"');
    for (const tab of PRACTICE_TABS) {
      expect(html).toContain(`id="practice-tab-${tab.id}"`);
    }
    expect(PRACTICE_TABS.map((tab) => tab.label)).toEqual(['All', 'Tests', 'Quiz']);
  });

  it('puts exactly one tab in the tab order, the selected one', () => {
    const html = hub({ tab: 'tests' });
    expect(html.split('tabindex="0"').length - 1).toBe(1);
    expect(html).toContain('aria-selected="true"');
  });

  it('names the set the practice belongs to', () => {
    expect(hub()).toContain('BIO 201');
  });
});

describe('what each tab shows', () => {
  it('All shows both libraries — the whole reason the hub exists', () => {
    const html = hub({ tab: 'all' });
    expect(html).toContain('Mitosis quiz');
    expect(html).toContain('Midterm practice');
  });

  it('Quiz shows only quizzes', () => {
    const html = hub({ tab: 'quiz' });
    expect(html).toContain('Mitosis quiz');
    expect(html).not.toContain('Midterm practice');
  });

  it('Tests shows only tests, and its create card says so', () => {
    const html = hub({ tab: 'tests' });
    expect(html).toContain('Midterm practice');
    expect(html).not.toContain('Mitosis quiz');
    expect(html).toContain('New test');
  });
});

describe('the deep links', () => {
  const tabFor = (activity: StudySetPathActivity) => practiceTabForActivity(activity);

  it('keeps /quiz and /test meaning what they meant', () => {
    expect(tabFor('quiz')).toBe('quiz');
    expect(tabFor('test')).toBe('tests');
    expect(tabFor('practice')).toBe('all');
  });

  it('opens the same pane for all three, so the room needs no new arm', () => {
    expect(workspaceActivityFromPath('practice')).toBe('quiz');
    expect(workspaceActivityFromPath('quiz')).toBe('quiz');
  });
});

describe('what the focus bar calls the pane', () => {
  /**
   * The bar takes its word from here, not from the activity, because all three
   * tabs ARE the `quiz` activity. Before this it read "Quiz ▾" over a list of
   * tests — found on the founder's 2026-09-17 visual pass of #130.
   */
  it('says Practice on the All tab, never "All"', () => {
    expect(practiceTabLabel('all')).toBe('Practice');
  });

  it('says Tests and Quiz on the other two', () => {
    expect(practiceTabLabel('tests')).toBe('Tests');
    expect(practiceTabLabel('quiz')).toBe('Quiz');
  });

  it('follows the path, so a deep link names itself correctly', () => {
    expect(practiceTabLabel(practiceTabForActivity('practice'))).toBe('Practice');
    expect(practiceTabLabel(practiceTabForActivity('test'))).toBe('Tests');
    expect(practiceTabLabel(practiceTabForActivity('quiz'))).toBe('Quiz');
  });
});

describe('the folders, and what they replaced', () => {
  /**
   * #130 drew no folder card, and was right to: the only "folders" in reach
   * came from `/users/me/study-sets/folders` and grouped SETS, so the founder's
   * 2026-09-17 pass saw "SF6 pass folder · Folder" beside the quizzes and read
   * it as a quiz folder — clicking one LEFT the room for the set picker.
   * These are `practice_folders`: they live inside ONE set and hold that set's
   * quizzes and tests. The set folders are still not drawn here, and the test
   * below is what keeps that true.
   */
  const withFolders = (extra: Partial<React.ComponentProps<typeof PracticeHub>> = {}) =>
    hub({ foldersSupported: true, folders: FOLDERS, onOpenFolder: () => {}, ...extra });

  it('draws a folder card with the measured "Folder · n items" line', () => {
    const html = withFolders();
    expect(html).toContain('Week 1');
    expect(html).toContain('Folder · 2 items');
  });

  it('offers a Create folder card on ALL THREE tabs, because a folder holds both doors', () => {
    for (const tab of PRACTICE_TABS) {
      const html = withFolders({ tab: tab.id, onCreateFolder: () => {} });
      expect(html).toContain('Create folder');
    }
  });

  it('keeps a filed item out of the top level, so nothing appears twice', () => {
    const html = withFolders();
    // 'Mitosis quiz' is filed in f1; 'Midterm practice' is not filed.
    expect(html).not.toContain('Mitosis quiz');
    expect(html).toContain('Midterm practice');
  });

  it('shows the folder\'s contents, and only those, once it is open', () => {
    const html = withFolders({ openFolderId: 'f1' });
    expect(html).toContain('Mitosis quiz');
    expect(html).not.toContain('Midterm practice');
    // The folder row is gone: you are inside it.
    expect(html).not.toContain('Folder · 2 items');
  });

  it('trails a breadcrumb back to Practice, with the folder as the current page', () => {
    const html = withFolders({ openFolderId: 'f1' });
    expect(html).toContain('aria-label="Breadcrumb"');
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('Practice');
    expect(html).toContain('Week 1');
  });

  it('draws no breadcrumb at the top level', () => {
    expect(withFolders()).not.toContain('aria-label="Breadcrumb"');
  });

  it('still draws none of the SET folders — the thing #130 removed', () => {
    // A set folder would read "<name> · Folder" with no count. Every folder
    // line here carries an item count, because every folder here is a
    // practice folder that belongs to this room.
    const html = withFolders();
    expect(html).not.toContain('>Folder<');
  });
});

describe('the item menu', () => {
  it('offers a kebab per card once folders are supported', () => {
    const html = hub({
      foldersSupported: true,
      folders: FOLDERS,
      onMoveItem: () => {},
      openFolderId: 'f1',
    });
    expect(html).toContain('aria-label="Options for Mitosis quiz"');
    expect(html).toContain('aria-haspopup="menu"');
  });

  it('offers a kebab per folder for Rename and Delete', () => {
    const html = hub({
      foldersSupported: true,
      folders: FOLDERS,
      onRenameFolder: () => {},
      onDeleteFolder: () => {},
    });
    expect(html).toContain('aria-label="Folder options for Week 1"');
  });
});

describe('the degraded state — before the hand-applied migration', () => {
  /**
   * 20260918120000 is applied by hand and the web deploy lands first, so this
   * is a state that really ships. The hub must then render EXACTLY as it did
   * before folders existed: every item visible, no folder card, no Create
   * folder, no kebab. Anything else is a control that could only fail.
   */
  it('shows every item, filed or not, because there are no folders to hide them in', () => {
    const html = hub({ folders: FOLDERS });
    expect(html).toContain('Mitosis quiz');
    expect(html).toContain('Midterm practice');
  });

  it('draws no folder card, no Create folder and no breadcrumb', () => {
    const html = hub({ folders: FOLDERS, onCreateFolder: () => {}, openFolderId: 'f1' });
    expect(html).not.toContain('Week 1');
    expect(html.toLowerCase()).not.toContain('create folder');
    expect(html).not.toContain('aria-label="Breadcrumb"');
  });

  it('offers no move menu, so nothing on screen can 503', () => {
    const html = hub({ folders: FOLDERS, onMoveItem: () => {} });
    expect(html).not.toContain('aria-label="Options for Mitosis quiz"');
  });

  it('defaults to the degraded state when the caller says nothing', () => {
    const props: React.ComponentProps<typeof PracticeHub> = {
      setLabel: 'BIO 201',
      tab: 'all',
      onTabChange: () => {},
      quizzes: [],
      tests: [],
      onOpen: () => {},
      onCreate: () => {},
    };
    expect(props.foldersSupported).toBeUndefined();
    expect(hub({ onCreateFolder: () => {} }).toLowerCase()).not.toContain('create folder');
  });
});
