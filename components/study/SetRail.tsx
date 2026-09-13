import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { studySetLabel } from '@lantern/shared';
import {
  buildSetRailModel,
  type SetRailLink,
  type SetRailNoteNode,
} from '@lantern/shared/study';
import type { StudyNote } from '../../types';
import { AppIcon } from '../ui/AppIcon';
import { useNotesStore } from '../../stores/notesStore';
import { useStudySetStore } from '../../stores/studySetStore';
import * as notesApi from '../../services/notes';
import { SetTile } from './SetRoomTile';
import { setRelativeTime } from './StudySetSwitcher';

interface SetRailProps {
  /** The set the student is standing in. Never rendered without one. */
  studySetId: string;
  /** The rail's own expanded state — the set section follows it. */
  expanded: boolean;
  /** `location.pathname`, so the lit row is the route, not a remembered click. */
  currentPath: string;
  onNavigate: (path: string) => void;
  /** Chat is the docked companion, already scoped to the open set. */
  onToggleCompanion: () => void;
  isCompanionOpen?: boolean;
}

/**
 * The set-scoped section of the left rail.
 *
 * WHY THIS EXISTS. The reference product's defining structure is that the rail
 * *becomes* the set while you are inside one: the switcher, the four doors, the
 * practice drawer, Upload and a live materials tree all live in the rail, and
 * the page body is left for the work. Lantern had none of it — the rail stayed
 * global on every route and every set section was a card in the page, so a
 * student inside a set had no persistent way to reach the set's other tools or
 * its own notes without going back out through the room.
 *
 * The rows themselves are computed by `buildSetRailModel` in
 * `@lantern/shared/study` — pure and tested — so the expanded rail, the
 * collapsed icon rail and (later) mobile cannot disagree about what is lit.
 * This file is the dark-rail chrome, the data it needs, and the navigation.
 *
 * Type scale: six steps only (`text-body`, `text-caption`, `text-label`).
 */
const SetRail: React.FC<SetRailProps> = ({
  studySetId,
  expanded,
  currentPath,
  onNavigate,
  onToggleCompanion,
  isCompanionOpen,
}) => {
  const sets = useStudySetStore((s) => s.sets);
  const loadSets = useStudySetStore((s) => s.loadSets);
  const resolveSet = useStudySetStore((s) => s.resolveSet);
  const storeNotes = useNotesStore((s) => s.notes);
  const folders = useNotesStore((s) => s.folders);
  const loadFolders = useNotesStore((s) => s.loadFolders);
  const setSelectedFolderId = useNotesStore((s) => s.setSelectedFolderId);

  const [fetchedNotes, setFetchedNotes] = useState<StudyNote[]>([]);
  const [practiceOpen, setPracticeOpen] = useState(false);
  const [openFolderIds, setOpenFolderIds] = useState<Record<string, boolean>>({});
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [menuFolderId, setMenuFolderId] = useState<string | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const [anchor, setAnchor] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    void loadSets();
    void loadFolders();
  }, [loadSets, loadFolders]);

  // The materials tree is the rail's only live data. The set room fetches the
  // same rows into its own local state rather than the store, so the rail asks
  // for them itself instead of rendering whatever the store happens to hold.
  useEffect(() => {
    let cancelled = false;
    notesApi
      .fetchNotes({ studySetId })
      .then((rows) => {
        if (!cancelled) setFetchedNotes(Array.isArray(rows) ? rows : []);
      })
      // A failed fetch falls back to the store below; an empty tree is a
      // better rail than a broken one, and the room reports the real error.
      .catch(() => {
        if (!cancelled) setFetchedNotes([]);
      });
    return () => {
      cancelled = true;
    };
  }, [studySetId, currentPath]);

  const set = resolveSet(studySetId);

  const notes = useMemo(() => {
    const byId = new Map<string, StudyNote>();
    for (const note of fetchedNotes) byId.set(note.id, note);
    // Store rows win on conflict: a title the student just edited is newer
    // than the row this rail fetched when the route changed.
    for (const note of storeNotes) {
      if (note.studySetId === studySetId) byId.set(note.id, note);
    }
    return [...byId.values()].map((note) => ({
      id: note.id,
      title: note.title,
      folderId: note.folderId ?? null,
    }));
  }, [fetchedNotes, storeNotes, studySetId]);

  const model = useMemo(
    () =>
      buildSetRailModel({
        setId: studySetId,
        setTitle: set ? studySetLabel(set) : null,
        notes,
        folders: folders.map((folder) => ({ id: folder.id, name: folder.name })),
        activeRoute: currentPath,
      }),
    [studySetId, set, notes, folders, currentPath]
  );

  // A drawer whose child is the open activity opens itself, and stays open
  // while the student clicks around inside it.
  useEffect(() => {
    if (model.practice.hasActive) setPracticeOpen(true);
  }, [model.practice.hasActive]);
  useEffect(() => {
    const active = model.materials.folders.find((folder) => folder.active);
    if (active) setOpenFolderIds((prev) => (prev[active.id] ? prev : { ...prev, [active.id]: true }));
  }, [model.materials.folders]);

  // The rail scrolls, so a popover inside it would be clipped by the scroll
  // box. It is positioned from the trigger's rect and rendered fixed instead.
  useEffect(() => {
    if (!switcherOpen) return;
    const place = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (rect) setAnchor({ top: rect.bottom + 6, left: rect.left });
    };
    place();
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (popoverRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setSwitcherOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSwitcherOpen(false);
    };
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [switcherOpen]);

  const switcherRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return [...sets]
      .filter((row) => !q || studySetLabel(row).toLowerCase().includes(q))
      .sort((a, b) => {
        const at = a.lastStudiedAt ? Date.parse(a.lastStudiedAt) : 0;
        const bt = b.lastStudiedAt ? Date.parse(b.lastStudiedAt) : 0;
        return (Number.isNaN(bt) ? 0 : bt) - (Number.isNaN(at) ? 0 : at);
      });
  }, [sets, query]);

  const runLink = useCallback(
    (link: SetRailLink) => {
      if (link.action.kind === 'companion') onToggleCompanion();
      else onNavigate(link.action.path);
    },
    [onNavigate, onToggleCompanion]
  );

  const rowClass = (active: boolean) =>
    `w-full flex items-center gap-3 rounded-xl p-2.5 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40 transition-colors duration-150 ${
      active
        ? 'bg-lantern-nav-column-active text-lantern-nav-column-text font-semibold'
        : 'text-lantern-nav-column-text-secondary hover:bg-white/10 hover:text-lantern-nav-column-text'
    } ${expanded ? '' : 'justify-center'}`;

  const renderLink = (link: SetRailLink, indented = false) => {
    const active = link.id === 'chat' ? Boolean(isCompanionOpen) : link.active;
    return (
      <button
        key={link.id}
        type="button"
        onClick={() => runLink(link)}
        title={link.label}
        aria-label={link.label}
        aria-current={active ? 'page' : undefined}
        className={`${rowClass(active)} ${expanded && indented ? 'pl-9' : ''}`}
      >
        <AppIcon name={link.icon} size={16} className="flex-shrink-0" />
        {expanded ? <span className="min-w-0 flex-1 truncate text-body tracking-tight">{link.label}</span> : null}
      </button>
    );
  };

  const renderNote = (note: SetRailNoteNode) => (
    <button
      key={note.id}
      type="button"
      onClick={() => onNavigate(note.path)}
      title={note.label}
      aria-current={note.active ? 'page' : undefined}
      className={`${rowClass(note.active)} py-1.5 ${expanded ? 'pl-9' : ''}`}
    >
      <AppIcon name="document-text" size={14} className="flex-shrink-0" />
      {expanded ? <span className="min-w-0 flex-1 truncate text-caption">{note.label}</span> : null}
    </button>
  );

  return (
    <div className="mt-3 border-t border-white/10 px-2 pt-3" data-testid="set-rail">
      {expanded ? (
        <p className="px-2.5 pb-1.5 text-label uppercase text-lantern-nav-column-text-secondary">
          Study set
        </p>
      ) : null}

      {/* The switcher pill: which set you are in, and the way to another. */}
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          setQuery('');
          setSwitcherOpen((value) => !value);
        }}
        aria-haspopup="dialog"
        aria-expanded={switcherOpen}
        aria-label={`Study set: ${model.setTitle}. Switch study set`}
        title={model.setTitle}
        className={`w-full flex items-center gap-2 rounded-xl border border-white/15 bg-white/5 p-1.5 text-lantern-nav-column-text hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40 ${
          expanded ? '' : 'justify-center'
        }`}
      >
        <SetTile
          setId={studySetId}
          title={model.setTitle || ''}
          coverPath={set?.coverPath}
          size={expanded ? 24 : 22}
          className="flex-shrink-0"
        />
        {expanded ? (
          <>
            <span className="min-w-0 flex-1 truncate text-caption font-semibold">{model.setTitle}</span>
            <AppIcon name="swap-horizontal" size={14} className="flex-shrink-0 text-lantern-nav-column-text-secondary" />
          </>
        ) : null}
      </button>

      {switcherOpen && anchor ? (
        <div
          ref={popoverRef}
          role="dialog"
          aria-label="Study sets"
          style={{ top: anchor.top, left: anchor.left }}
          className="fixed z-50 w-72 rounded-2xl border border-lantern-border bg-lantern-surface p-2 shadow-lantern-lg"
        >
          <label className="block px-1 pb-2">
            <span className="sr-only">Search study sets</span>
            <input
              type="search"
              value={query}
              autoFocus
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search study sets"
              className="w-full min-h-[40px] rounded-xl border border-lantern-border bg-lantern-background-secondary px-3 text-caption text-lantern-text placeholder:text-lantern-text-tertiary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lantern-ink/40"
            />
          </label>
          <div className="max-h-72 overflow-y-auto">
            {switcherRows.length === 0 ? (
              <p className="px-3 py-4 text-caption text-lantern-text-secondary">No set matches that.</p>
            ) : (
              switcherRows.map((row) => (
                <button
                  key={row.id}
                  type="button"
                  onClick={() => {
                    setSwitcherOpen(false);
                    onNavigate(`/study/sets/${encodeURIComponent(row.id)}`);
                  }}
                  aria-current={row.id === studySetId ? 'true' : undefined}
                  className={`w-full flex items-center gap-2 rounded-xl px-2 py-2 text-left hover:bg-lantern-background-secondary ${
                    row.id === studySetId ? 'bg-lantern-background-secondary' : ''
                  }`}
                >
                  <SetTile
                    setId={row.id}
                    title={studySetLabel(row)}
                    coverPath={row.coverPath}
                    size={26}
                    className="flex-shrink-0"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-caption font-semibold text-lantern-text">
                      {studySetLabel(row)}
                    </span>
                    <span className="block text-label text-lantern-text-secondary">
                      {setRelativeTime(row.lastStudiedAt)}
                    </span>
                  </span>
                </button>
              ))
            )}
          </div>
          <button
            type="button"
            onClick={() => {
              setSwitcherOpen(false);
              onNavigate(model.switcher.fallbackPath);
            }}
            className="mt-1 w-full rounded-xl px-3 py-2 text-left text-caption font-semibold text-lantern-text hover:bg-lantern-background-secondary"
          >
            View all study sets
          </button>
        </div>
      ) : null}

      <nav aria-label="Study set" className="mt-2 space-y-1">
        {model.primary.map((link) => renderLink(link))}

        <button
          type="button"
          onClick={() => setPracticeOpen((value) => !value)}
          aria-expanded={practiceOpen}
          title={model.practice.label}
          aria-label={model.practice.label}
          className={rowClass(!practiceOpen && model.practice.hasActive)}
        >
          <AppIcon name="game-controller" size={16} className="flex-shrink-0" />
          {expanded ? (
            <>
              <span className="min-w-0 flex-1 truncate text-body tracking-tight">{model.practice.label}</span>
              <AppIcon
                name={practiceOpen ? 'chevron-down' : 'chevron-forward'}
                size={14}
                className="flex-shrink-0"
              />
            </>
          ) : null}
        </button>
        {practiceOpen ? model.practice.items.map((link) => renderLink(link, true)) : null}
      </nav>

      {/* Upload is the one black pill in the rail: the set's only create door. */}
      <button
        type="button"
        onClick={() => onNavigate((model.upload.action as { path: string }).path)}
        title="Upload to this set"
        aria-label="Upload to this set"
        className={`mt-3 w-full flex items-center gap-2 rounded-full bg-lantern-ink px-3 py-2 text-lantern-surface hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40 ${
          expanded ? '' : 'justify-center px-0'
        }`}
      >
        <AppIcon name="add" size={16} className="flex-shrink-0" />
        {expanded ? <span className="text-caption font-semibold">Upload</span> : null}
      </button>

      <div className="mt-3">
        {expanded ? (
          <div className="flex items-center justify-between px-2.5 pb-1">
            <span className="text-label uppercase text-lantern-nav-column-text-secondary">
              Materials
            </span>
            <button
              type="button"
              onClick={() => onNavigate(model.materials.viewAllPath)}
              className="rounded-lg px-1.5 py-0.5 text-label text-lantern-nav-column-text-secondary hover:bg-white/10 hover:text-lantern-nav-column-text focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
            >
              View all
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => onNavigate(model.materials.viewAllPath)}
            title={`Materials (${model.materials.total})`}
            aria-label={`Materials, ${model.materials.total}`}
            className={rowClass(false)}
          >
            <AppIcon name="folder" size={16} className="flex-shrink-0" />
          </button>
        )}

        {expanded ? (
          model.materials.total === 0 ? (
            <p className="px-2.5 py-1 text-caption text-lantern-nav-column-text-secondary">
              No materials yet.
            </p>
          ) : (
            <div className="space-y-0.5">
              {model.materials.folders.map((folder) => {
                const open = Boolean(openFolderIds[folder.id]);
                return (
                  <div key={folder.id}>
                    <div className="group flex items-center">
                      <button
                        type="button"
                        onClick={() =>
                          setOpenFolderIds((prev) => ({ ...prev, [folder.id]: !prev[folder.id] }))
                        }
                        aria-expanded={open}
                        title={folder.label}
                        className={`${rowClass(false)} min-w-0 flex-1 py-1.5 text-cyan-300 hover:text-cyan-200`}
                      >
                        <AppIcon
                          name={open ? 'chevron-down' : 'chevron-forward'}
                          size={12}
                          className="flex-shrink-0"
                        />
                        <AppIcon name="folder" size={14} className="flex-shrink-0" />
                        <span className="min-w-0 flex-1 truncate text-caption">{folder.label}</span>
                        <span className="flex-shrink-0 text-label">{folder.notes.length}</span>
                      </button>
                      {/* The only folder action that is honest from here: the
                          folder itself is a Library folder, not a set folder,
                          so renaming or deleting it from inside one set would
                          act on every set that files notes in it. */}
                      <button
                        type="button"
                        onClick={() => setMenuFolderId(menuFolderId === folder.id ? null : folder.id)}
                        aria-expanded={menuFolderId === folder.id}
                        aria-label={`Actions for ${folder.label}`}
                        title={`Actions for ${folder.label}`}
                        className="flex-shrink-0 rounded-lg p-1 text-lantern-nav-column-text-secondary hover:bg-white/10 hover:text-lantern-nav-column-text focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
                      >
                        <AppIcon name="ellipsis-vertical" size={14} />
                      </button>
                    </div>
                    {menuFolderId === folder.id ? (
                      <button
                        type="button"
                        onClick={() => {
                          setMenuFolderId(null);
                          setSelectedFolderId(folder.id);
                          onNavigate('/library/notes');
                        }}
                        className="ml-9 mb-1 rounded-lg px-2 py-1 text-caption text-lantern-nav-column-text-secondary hover:bg-white/10 hover:text-lantern-nav-column-text focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
                      >
                        Open folder in Library
                      </button>
                    ) : null}
                    {open ? folder.notes.map(renderNote) : null}
                  </div>
                );
              })}
              {model.materials.unfiled.map(renderNote)}
            </div>
          )
        ) : null}
      </div>
    </div>
  );
};

export default SetRail;
