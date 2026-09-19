import React, { useMemo, useState } from 'react';
import {
  filterLectures,
  formatLectureRowStamp,
  groupLecturesByDay,
  type LectureListRow,
} from '@lantern/shared';
import { Button } from '../ui';
import { AppIcon } from '../ui/AppIcon';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { Menu, MenuContent, MenuItem, MenuTrigger } from '../ui/Menu';

/**
 * The lectures page: every take this set holds, as a diary.
 *
 * WHY NOT THE CARD GRID IT REPLACED. `StudySetArtifactLibrary` draws lectures
 * the way it draws decks and tests — a grid of preview cards. That is right for
 * an artifact you browse by what is IN it, and wrong for a lecture, which a
 * student looks for by WHEN it was: "the Tuesday one, the week before the
 * test". The reference groups its sessions under day headings for exactly that
 * reason, and the founder asked for it by name. So this page is one column of
 * rows under "Today" / "Yesterday" / "Sunday, 13 Sep 2026", newest first, with
 * a search field over the top for the student who does remember the title.
 *
 * Each row is a 64px mic tile on the recording tint, the title, the stamp, a ⋮
 * (Rename · Delete, with a confirm) and a → — one press to open, everything
 * rare behind the kebab.
 */

export interface LectureSessionsListProps {
  lectures: LectureListRow[];
  onOpen: (id: string) => void;
  onCreate: () => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
}

export const LectureSessionsList: React.FC<LectureSessionsListProps> = ({
  lectures,
  onOpen,
  onCreate,
  onRename,
  onDelete,
}) => {
  const [query, setQuery] = useState('');
  const [renaming, setRenaming] = useState<{ id: string; title: string } | null>(null);
  const [deleting, setDeleting] = useState<LectureListRow | null>(null);

  const groups = useMemo(
    () => groupLecturesByDay(filterLectures(lectures, query)),
    [lectures, query]
  );

  return (
    <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4">
      <div className="mx-auto w-full max-w-[728px] space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-title text-lantern-text">Lectures</h1>
          <Button className="ml-auto" onClick={onCreate}>
            + New lecture
          </Button>
        </div>

        <label className="sr-only" htmlFor="lecture-search">
          Search lectures
        </label>
        <input
          id="lecture-search"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search lectures…"
          className="min-h-[44px] w-full rounded-xl border border-lantern-border bg-lantern-surface px-3 text-body text-lantern-text placeholder:text-lantern-text-tertiary"
        />

        {groups.length === 0 ? (
          <p className="text-body text-lantern-text-secondary">
            {lectures.length
              ? 'No lecture matches that search.'
              : 'Record a lecture or open one you already filed.'}
          </p>
        ) : null}

        {groups.map((group) => (
          <section key={group.key} className="space-y-2">
            <h2 className="text-label uppercase text-lantern-text-secondary">{group.label}</h2>
            <ul className="space-y-2">
              {group.rows.map((row) => (
                <li
                  key={row.id}
                  className="flex items-center gap-3 rounded-lantern-lg border border-lantern-border bg-lantern-surface p-2"
                >
                  <button
                    type="button"
                    onClick={() => onOpen(row.id)}
                    className="flex min-w-0 flex-1 items-center gap-3 text-left"
                  >
                    <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-lantern-feature-recording-tint">
                      <AppIcon
                        name="mic"
                        size={24}
                        className="text-lantern-feature-recording-ink"
                      />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-body font-medium text-lantern-text">
                        {row.title || 'Untitled lecture'}
                      </span>
                      <span className="block text-caption text-lantern-text-secondary">
                        {formatLectureRowStamp(row.createdAt ?? row.updatedAt)}
                      </span>
                    </span>
                  </button>
                  <Menu>
                    <MenuTrigger
                      aria-label={`Actions for ${row.title || 'Untitled lecture'}`}
                      className="inline-flex h-11 w-11 items-center justify-center rounded-full text-lantern-text-secondary hover:text-lantern-text"
                    >
                      <AppIcon name="ellipsis-vertical" size={18} />
                    </MenuTrigger>
                    <MenuContent align="end" placement="bottom">
                      <MenuItem
                        onSelect={() => setRenaming({ id: row.id, title: row.title || '' })}
                      >
                        Rename
                      </MenuItem>
                      <MenuItem destructive onSelect={() => setDeleting(row)}>
                        Delete
                      </MenuItem>
                    </MenuContent>
                  </Menu>
                  <button
                    type="button"
                    onClick={() => onOpen(row.id)}
                    aria-label={`Open ${row.title || 'Untitled lecture'}`}
                    className="inline-flex h-11 w-11 items-center justify-center rounded-full text-lantern-text-secondary hover:text-lantern-text"
                  >
                    <AppIcon name="arrow-forward" size={18} />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      {renaming ? (
        <div className="fixed inset-x-0 bottom-4 z-50 mx-auto w-[min(28rem,90vw)] rounded-lantern-lg border border-lantern-border bg-lantern-surface p-3 shadow-lantern-lg">
          <label htmlFor="lecture-rename" className="block text-caption text-lantern-text-secondary">
            Rename lecture
          </label>
          <input
            id="lecture-rename"
            autoFocus
            value={renaming.title}
            onChange={(event) => setRenaming({ ...renaming, title: event.target.value })}
            className="mt-1 min-h-[44px] w-full rounded-xl border border-lantern-border bg-lantern-background px-3 text-body text-lantern-text"
          />
          <div className="mt-2 flex justify-end gap-2">
            <Button size="sm" variant="secondary" onClick={() => setRenaming(null)}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => {
                onRename(renaming.id, renaming.title.trim());
                setRenaming(null);
              }}
            >
              Save
            </Button>
          </div>
        </div>
      ) : null}

      <ConfirmDialog
        open={Boolean(deleting)}
        danger
        title="Delete this lecture?"
        message={`“${deleting?.title || 'Untitled lecture'}” and its transcript and audio go with it. This cannot be undone.`}
        confirmLabel="Delete"
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          if (deleting) onDelete(deleting.id);
          setDeleting(null);
        }}
      />
    </div>
  );
};

export default LectureSessionsList;
