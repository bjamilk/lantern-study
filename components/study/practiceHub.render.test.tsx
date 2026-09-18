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

import { PracticeHub, PRACTICE_TABS, type PracticeTab } from './PracticeHub';
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
  /** The rule the hub reads, spelled out here so a route change breaks it. */
  const tabFor = (activity: StudySetPathActivity): PracticeTab =>
    activity === 'practice' ? 'all' : activity === 'test' ? 'tests' : 'quiz';

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

describe('the deliberate omission', () => {
  it('draws NO "Create folder" card — nothing files a quiz into a folder', () => {
    // The reference has one. Lantern has no quiz-folder model, so the card
    // would be a live control that does nothing — the pattern the declutter
    // pass removed everywhere else.
    expect(hub().toLowerCase()).not.toContain('create folder');
  });
});
