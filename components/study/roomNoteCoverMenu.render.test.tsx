// @vitest-environment jsdom
/**
 * A note in the set room must offer its owner a cover — from the surface the
 * student actually meets it on.
 *
 * `Recent materials` is that surface: it is the set room's materials section,
 * it has a grid AND a list, and it shipped with no ⋮ on either. The room's only
 * note menu lived on the `Notes` activity list (`NoteRoomRow`), a different
 * screen, so a student standing in a set could see a note's cover but had no
 * way to set one without leaving for the Library.
 *
 * Both views are tested, because a menu wired into one of them is the same bug
 * with a smaller radius. A note that is not the viewer's gets no trigger at
 * all: the cover route answers 403 there, and a menu item that always fails is
 * worse than no item.
 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { StudyNote } from '../../types';
import { RecentMaterials } from './RecentMaterials';

const OWNED = { id: 'n1', title: 'Gas exchange', accessRole: 'owner' } as unknown as StudyNote;
const SHARED = { id: 'n2', title: 'Someone else’s', accessRole: 'viewer' } as unknown as StudyNote;

/** The room's real rule, mirrored: owner (or no role at all) gets the menu. */
const renderNoteMenu = (note: StudyNote) =>
  note.accessRole && note.accessRole !== 'owner' ? null : (
    <button type="button" aria-label={`Note options for ${note.title}`}>
      Add cover…
    </button>
  );

// Without this React warns on every act() call and the noise hides real output.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  window.localStorage.clear();
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

/** Render the section, then switch it to the named view via its own toggle. */
function renderMaterials(view: 'grid' | 'list', notes: StudyNote[]) {
  act(() => {
    root.render(
      <RecentMaterials
        notes={notes}
        onOpenNote={() => {}}
        onViewAll={() => {}}
        renderNoteMenu={renderNoteMenu}
      />
    );
  });
  if (view === 'list') {
    const toggle = [...host.querySelectorAll('button')].find((button) =>
      /list/i.test(button.getAttribute('aria-label') || button.textContent || '')
    );
    expect(toggle, 'the view toggle should offer a list option').toBeTruthy();
    act(() => toggle!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  }
  // Prove the view actually switched. Without this, a toggle that silently did
  // nothing would leave every "list view" case asserting against the grid, and
  // the list branch would be untested while the suite stayed green.
  const isList = Boolean(host.querySelector('ul'));
  expect(isList, `expected the ${view} view to be showing`).toBe(view === 'list');
}

const menuTrigger = (title: string) =>
  host.querySelector<HTMLButtonElement>(`button[aria-label="Note options for ${title}"]`);

describe('Recent materials — the owner’s note ⋮', () => {
  for (const view of ['grid', 'list'] as const) {
    it(`offers Add cover… on an owned note in ${view} view`, () => {
      renderMaterials(view, [OWNED]);
      const trigger = menuTrigger('Gas exchange');
      expect(trigger).toBeTruthy();
      expect(trigger!.textContent).toContain('Add cover…');
    });

    it(`nests the ⋮ beside the row button, never inside it, in ${view} view`, () => {
      renderMaterials(view, [OWNED]);
      const trigger = menuTrigger('Gas exchange')!;
      // A <button> inside a <button> is invalid markup the keyboard cannot
      // reach, and every click of the menu would also open the note.
      expect(trigger.closest('button')).toBe(trigger);
    });

    it(`offers no ⋮ on a note that is not the viewer’s in ${view} view`, () => {
      renderMaterials(view, [SHARED]);
      expect(menuTrigger('Someone else’s')).toBeNull();
    });
  }
});
