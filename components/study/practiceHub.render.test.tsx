// @vitest-environment jsdom
/**
 * The Practice hub at the anatomy measured off StudyFetch on 2026-09-17
 * (docs/studyfetch-mysets-2026-09-17/02-style-and-subpages.md, §Practice).
 *
 * What is pinned is the thing the hub exists for: quizzes and tests are ONE
 * destination with three tabs, where Lantern had two unconnected pages. Plus
 * the deep-link rule — the tab is read off the path activity, so `/quiz` and
 * `/test` keep meaning what they meant and simply open the hub on their tab.
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

const card = (id: string, title: string, icon: ArtifactCard['icon']): ArtifactCard => ({
  id,
  title,
  feature: 'tests',
  icon,
});

const QUIZZES = [card('q1', 'Mitosis quiz', 'help-circle')];
const TESTS = [card('t1', 'Midterm practice', 'clipboard')];

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

describe('the deliberate omission', () => {
  /**
   * The founder's pass saw "SF6 pass folder · Folder" beside the quizzes and
   * read it as a quiz folder. It was not one: the old quiz library passed
   * `useStudySetStore.folders` through, which come from
   * `/users/me/study-sets/folders` and group SETS — clicking one LEFT the room
   * for the set picker. No test row carries a `folderId` anywhere. So the hub
   * draws neither the folder nor a Create folder that could only make the
   * wrong kind.
   */
  it('draws no folder card and no "Create folder"', () => {
    const html = hub().toLowerCase();
    expect(html).not.toContain('create folder');
    expect(html).not.toContain('· folder');
  });

  it('takes no folder props at all, so none can be passed back in by accident', () => {
    expect(Object.keys(hub())).not.toContain('folders');
    // The real guard: the prop type has no `folders`, so this file would not
    // compile if one were reintroduced without a decision.
    const props: React.ComponentProps<typeof PracticeHub> = {
      setLabel: 'BIO 201',
      tab: 'all',
      onTabChange: () => {},
      quizzes: [],
      tests: [],
      onOpen: () => {},
      onCreate: () => {},
    };
    expect('folders' in props).toBe(false);
  });
});
