// @vitest-environment jsdom
/**
 * The Materials page at the anatomy measured off StudyFetch on 2026-09-17
 * (docs/studyfetch-mysets-2026-09-17/02-style-and-subpages.md, §Materials).
 *
 * STRUCTURE, not pixels. What is pinned is what was actually missing: a page
 * that is scoped to THIS set (the old "View all materials" left the set
 * entirely for the account-wide Library, which has no set filter at all), the
 * two lead cards the reference opens the grid with, folder cards that are real
 * buttons carrying their item count, and a kebab on each material.
 */
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { SetMaterialsPage } from './SetMaterialsPage';
import type { StudyNote } from '../../types';

vi.mock('./ViewModeToggle', async () => {
  const actual = await vi.importActual<typeof import('./ViewModeToggle')>('./ViewModeToggle');
  return {
    ...actual,
    // The stored view/sort read localStorage, which a static render has none of.
    useViewMode: (_surface: string, fallback: 'grid' | 'list') => [fallback, () => {}],
    useMaterialSort: (_surface: string, fallback: string) => [fallback, () => {}],
  };
});

const note = (id: string, title: string, folderId?: string): StudyNote =>
  ({
    id,
    title,
    body: 'Body text',
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...(folderId ? { folderId } : {}),
  }) as StudyNote;

const NOTES = [note('n1', 'Lecture 3'), note('n2', 'Cell biology', 'f1')];

const page = (extra: Partial<React.ComponentProps<typeof SetMaterialsPage>> = {}) =>
  renderToStaticMarkup(
    <SetMaterialsPage
      setLabel="BIO 201"
      notes={NOTES}
      folders={[{ id: 'f1', name: 'Week 1', count: 1 }]}
      folderId={null}
      onSelectFolder={() => {}}
      onOpenNote={() => {}}
      onUpload={() => {}}
      onCreateFolder={() => {}}
      folderOfNote={(row) => row.folderId ?? null}
      {...extra}
    />
  );

describe('the header row', () => {
  it('is titled Materials and offers Folder and Upload', () => {
    const html = page();
    expect(html).toContain('Materials');
    expect(html).toContain('Folder');
    expect(html).toContain('Upload material');
  });

  it('names the set it is scoped to, so it cannot be mistaken for the Library', () => {
    expect(page()).toContain('BIO 201');
  });
});

describe('the filter row', () => {
  it('offers a type filter, a sort and a search', () => {
    const html = page();
    expect(html).toContain('Filter materials by type');
    expect(html).toContain('All types');
    expect(html).toContain('Newest first');
    expect(html).toContain('role="search"');
  });
});

describe('the grid', () => {
  it('opens with Add material and Create folder, as the reference does', () => {
    const html = page();
    expect(html).toContain('Add material');
    expect(html).toContain('Create folder');
  });

  it('draws a folder as a button with its item count', () => {
    const html = page();
    expect(html).toContain('Week 1');
    expect(html).toContain('Folder · 1 item');
  });

  it('pluralises the count rather than saying "1 items"', () => {
    const html = page({ folders: [{ id: 'f1', name: 'Week 1', count: 3 }] });
    expect(html).toContain('Folder · 3 items');
  });

  it('draws every material in the set', () => {
    const html = page();
    expect(html).toContain('Lecture 3');
    expect(html).toContain('Cell biology');
  });

  it('gives each material its kebab when the caller supplies one', () => {
    const html = page({
      renderNoteMenu: (row) => <button type="button">Options for {row.title}</button>,
    });
    expect(html).toContain('Options for Lecture 3');
  });
});

describe('inside a folder', () => {
  it('shows only that folder’s materials and a way back out', () => {
    const html = page({ folderId: 'f1' });
    expect(html).toContain('Cell biology');
    expect(html).not.toContain('Lecture 3');
    // The scope chip becomes the step back out, so the folder is never a trap.
    expect(html).toContain('Week 1');
  });

  it('does not offer the folder cards again from inside one', () => {
    expect(page({ folderId: 'f1' })).not.toContain('Folder · 1 item');
  });
});

describe('when there is nothing to show', () => {
  it('says so rather than leaving a blank column', () => {
    expect(page({ notes: [] })).toContain('Nothing of that type in this set yet');
  });
});
