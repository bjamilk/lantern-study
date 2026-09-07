import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CheckIcon,
  PencilSquareIcon,
  TrashIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import {
  COURSE_TOPIC_COPY,
  TOPIC_TITLE_MAX,
  formatDeleteTopicTitle,
  sortCourseTopics,
  upsertCourseTopic,
} from '@lantern/shared';
import type { CourseTopic } from '../../types';
import Modal from '../ui/Modal';
import { Button } from '../ui/Button';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import {
  createCourseTopic,
  deleteCourseTopic,
  fetchCourseTopics,
  renameCourseTopic,
  reorderCourseTopics,
} from '../../services/academic';
import { fetchUnmatchedTags } from '../../services/supabase';
import {
  planUnmatchedTags,
  unmatchedTagSubtitle,
  type UnmatchedTag,
} from '@lantern/shared/learning/readinessCard';

export interface ManageOutlineModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Course whose shared outline this manages. */
  courseId: string;
  /** Human label for the course (code, or "code — title"). */
  courseLabel?: string | null;
  /**
   * Fires after any successful mutation. The Library overview carries per-topic
   * counts, so it must be refreshed or the tree lies about where items sit.
   */
  onChanged?: () => void;
  /**
   * A topic was deleted. A Library filter can be pointing AT it, and a filter on
   * a uuid nothing carries any more matches nothing — every tab empties out
   * under a chip still naming the deleted topic. The owner of the filter clears
   * it here.
   */
  onTopicDeleted?: (topicId: string) => void;
}

/**
 * Rename / reorder / delete a course's syllabus outline (Phase 1 · A).
 *
 * The outline is SHARED course data: every edit here changes what every student
 * on the course sees, which is why the header says so and delete confirms with
 * the shared-and-nothing-lost body. Reorder is up/down buttons (not drag) so it
 * works from the keyboard, and every mutation refreshes the Library overview via
 * `onChanged` so the tree's counts stay truthful.
 *
 * Topics are added here too, in place. The outline used to be curate-only —
 * new topics existed only as a side effect of filing a note, deck or test —
 * so a student sent here to fill in a course's topics landed on a screen that
 * could not add one. The endpoint is find-or-create, so typing a title that
 * already exists returns the existing row instead of a duplicate.
 */
export const ManageOutlineModal: React.FC<ManageOutlineModalProps> = ({
  isOpen,
  onClose,
  courseId,
  courseLabel,
  onChanged,
  onTopicDeleted,
}) => {
  const [topics, setTopics] = useState<CourseTopic[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  // One in-flight mutation at a time keeps the ordering unambiguous: a reorder
  // rewrites positions server-side, so overlapping writes could interleave.
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState('');
  const [pendingDelete, setPendingDelete] = useState<CourseTopic | null>(null);
  /** The in-place "Add a topic" field. */
  const [newTitle, setNewTitle] = useState('');
  /**
   * Tags on this student's own work that no outline topic covers. `null` means
   * "not answered yet, or could not be read" and HIDES the section — an empty
   * "Unmatched tags" header is a promise the card cannot keep.
   */
  const [unmatched, setUnmatched] = useState<UnmatchedTag[] | null>(null);
  /** Surfaced inside ConfirmDialog, which stays open over the parent's error line. */
  const [deleteError, setDeleteError] = useState<string | null>(null);
  // Announced to assistive tech after a move/rename/delete, and the disabled
  // first/last reorder buttons — so the state is spoken, not only shown.
  const [status, setStatus] = useState('');
  const seq = useRef(0);

  useEffect(() => {
    if (!isOpen) return;
    setEditingId(null);
    setActionError(null);
    setStatus('');
    setPendingDelete(null);
    setNewTitle('');
    setUnmatched(null);
    const current = ++seq.current;
    setLoading(true);
    setLoadError(false);
    fetchCourseTopics(courseId)
      .then((rows) => {
        if (seq.current !== current) return;
        setTopics(sortCourseTopics(rows));
      })
      .catch(() => {
        if (seq.current !== current) return;
        setTopics([]);
        setLoadError(true);
      })
      .finally(() => {
        if (seq.current === current) setLoading(false);
      });
    // Additive: a failure here leaves the section away rather than blocking
    // the outline this modal exists to edit.
    fetchUnmatchedTags(courseId)
      .then((data) => {
        if (seq.current === current) setUnmatched(data?.tags ?? []);
      })
      .catch(() => {
        if (seq.current === current) setUnmatched(null);
      });
  }, [isOpen, courseId]);

  const addTopic = async () => {
    const title = newTitle.trim().replace(/\s+/g, ' ');
    if (!title) return;
    if (title.length > TOPIC_TITLE_MAX) {
      setActionError(COURSE_TOPIC_COPY.titleTooLong);
      return;
    }
    setBusy(true);
    setActionError(null);
    try {
      const created = await createCourseTopic(courseId, title);
      // find-or-create: an existing title comes back as its existing row, so
      // upsert rather than append — appending would show a twin that the next
      // load silently removes.
      setTopics((prev) => upsertCourseTopic(prev, created));
      setNewTitle('');
      setStatus(`Added ${created.title}`);
      onChanged?.();
    } catch (e: any) {
      setActionError(e?.message || COURSE_TOPIC_COPY.createFailed);
    } finally {
      setBusy(false);
    }
  };

  /**
   * One click turns a tag the student already uses into an outline topic. The
   * row leaves the list because it is no longer unmatched — it is now a topic.
   */
  const addTagAsTopic = async (tag: string) => {
    setBusy(true);
    setActionError(null);
    try {
      const created = await createCourseTopic(courseId, tag);
      setTopics((prev) => upsertCourseTopic(prev, created));
      setUnmatched((prev) =>
        prev ? prev.filter((row) => row.tag.toLowerCase() !== tag.toLowerCase()) : prev
      );
      setStatus(`Added ${created.title}`);
      onChanged?.();
    } catch (e: any) {
      setActionError(e?.message || COURSE_TOPIC_COPY.createFailed);
    } finally {
      setBusy(false);
    }
  };

  const beginRename = (topic: CourseTopic) => {
    setActionError(null);
    setEditingId(topic.id);
    setDraftTitle(topic.title || '');
  };

  const cancelRename = () => {
    setEditingId(null);
    setDraftTitle('');
  };

  const saveRename = async (topic: CourseTopic) => {
    const title = draftTitle.trim().replace(/\s+/g, ' ');
    if (!title || title === topic.title) {
      cancelRename();
      return;
    }
    if (title.length > TOPIC_TITLE_MAX) {
      setActionError(COURSE_TOPIC_COPY.titleTooLong);
      return;
    }
    setBusy(true);
    setActionError(null);
    try {
      const updated = await renameCourseTopic(courseId, topic.id, title);
      // Keep the user's explicit order — replace in place rather than re-sort.
      setTopics((prev) => prev.map((t) => (t.id === topic.id ? updated : t)));
      setEditingId(null);
      setDraftTitle('');
      setStatus(`Renamed to ${updated.title}`);
      onChanged?.();
    } catch (e: any) {
      // The server's 23505 message IS the shared duplicate copy, so surface it verbatim.
      setActionError(e?.message || COURSE_TOPIC_COPY.renameFailed);
    } finally {
      setBusy(false);
    }
  };

  const move = async (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= topics.length) return;
    const previous = topics;
    const next = topics.slice();
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved);
    // Optimistic: reflect the move immediately, then persist the FULL order.
    setTopics(next);
    setBusy(true);
    setActionError(null);
    try {
      const saved = await reorderCourseTopics(
        courseId,
        next.map((t) => t.id)
      );
      setTopics(sortCourseTopics(saved));
      setStatus(`Moved ${moved.title} to position ${target + 1} of ${next.length}`);
      onChanged?.();
    } catch (e: any) {
      setTopics(previous);
      setActionError(e?.message || COURSE_TOPIC_COPY.reorderFailed);
    } finally {
      setBusy(false);
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    const topic = pendingDelete;
    setBusy(true);
    setActionError(null);
    setDeleteError(null);
    try {
      await deleteCourseTopic(courseId, topic.id);
      setTopics((prev) => prev.filter((t) => t.id !== topic.id));
      setPendingDelete(null);
      setStatus(`Deleted ${topic.title}`);
      // Before the overview refetch: a live filter on this topic now points at a
      // dead uuid and would silently empty Notes, Flashcards and Tests.
      onTopicDeleted?.(topic.id);
      onChanged?.();
    } catch (e: any) {
      // The dialog stays open on failure, so the message has to travel INTO it:
      // the parent's error line sits behind ConfirmDialog's own backdrop, where
      // it reads as "nothing happened" and invites a second Delete press.
      setDeleteError(e?.message || COURSE_TOPIC_COPY.deleteFailed);
      setActionError(e?.message || COURSE_TOPIC_COPY.deleteFailed);
    } finally {
      setBusy(false);
    }
  };

  const unmatchedPlan = planUnmatchedTags(unmatched);

  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={() => {
          if (!busy) onClose();
        }}
        ariaLabelledBy="manage-outline-title"
        ariaDescribedBy="manage-outline-shared"
        maxWidthClass="max-w-md"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id="manage-outline-title" className="text-lg font-bold text-lantern-text">
              {COURSE_TOPIC_COPY.manageTitle}
            </h2>
            {courseLabel ? (
              <p className="text-sm text-lantern-text-secondary truncate" title={courseLabel}>
                {courseLabel}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => {
              if (!busy) onClose();
            }}
            aria-label="Close"
            className="shrink-0 rounded-lg p-1 text-lantern-text-secondary hover:bg-lantern-background-secondary hover:text-lantern-text"
          >
            <XMarkIcon className="w-5 h-5" aria-hidden />
          </button>
        </div>

        <p id="manage-outline-shared" className="mt-2 text-xs text-lantern-text-tertiary">
          {COURSE_TOPIC_COPY.shared}
        </p>

        {/* Announced-only region: moves, renames and deletes speak here. */}
        <p aria-live="polite" className="sr-only">
          {status}
        </p>

        {actionError ? (
          <p className="mt-3 text-xs text-red-600 dark:text-red-400" role="alert">
            {actionError}
          </p>
        ) : null}

        {/* Add sits ABOVE the list and outside every load gate: the course a
            student is sent here to fill in is exactly the one whose list is
            empty, and a field that only appeared once topics existed could
            never have created the first one. */}
        <div className="mt-3 flex items-center gap-2">
          <input
            type="text"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void addTopic();
              }
            }}
            disabled={busy || loadError}
            maxLength={TOPIC_TITLE_MAX}
            placeholder={COURSE_TOPIC_COPY.addPlaceholder}
            aria-label={COURSE_TOPIC_COPY.addTitle}
            className="flex-1 min-w-0 px-2 py-2 text-body rounded-md border border-lantern-border bg-lantern-surface text-lantern-text focus:outline-none focus:ring-2 focus:ring-lantern-primary disabled:opacity-50"
          />
          <Button
            type="button"
            variant="secondary"
            onClick={() => void addTopic()}
            disabled={busy || loadError || !newTitle.trim()}
            className="min-h-[44px] shrink-0"
          >
            {COURSE_TOPIC_COPY.addAction}
          </Button>
        </div>

        <div className="mt-3">
          {loading ? (
            <div className="space-y-2" aria-busy="true" aria-label={COURSE_TOPIC_COPY.loading}>
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-11 rounded-lg bg-lantern-background-secondary animate-pulse" />
              ))}
            </div>
          ) : loadError ? (
            <p className="text-sm text-lantern-text-secondary">{COURSE_TOPIC_COPY.unavailable}</p>
          ) : topics.length === 0 ? (
            // Not the picker's "type a title" line — there is no title field here.
            <p className="text-sm text-lantern-text-secondary">{COURSE_TOPIC_COPY.manageEmpty}</p>
          ) : (
            <ul className="space-y-1.5">
              {topics.map((topic, index) => {
                const isEditing = editingId === topic.id;
                const isFirst = index === 0;
                const isLast = index === topics.length - 1;
                const position = `${index + 1} of ${topics.length}`;
                return (
                  <li
                    key={topic.id}
                    className="flex items-center gap-2 rounded-lg border border-lantern-border bg-lantern-surface dark:bg-lantern-surface-secondary px-2 py-1.5"
                  >
                    <div className="flex flex-col shrink-0">
                      <button
                        type="button"
                        onClick={() => void move(index, -1)}
                        disabled={busy || isFirst}
                        aria-label={`Move ${topic.title} up (currently ${position})`}
                        className="grid place-items-center min-w-[24px] min-h-[24px] rounded text-lantern-text-secondary hover:text-lantern-text hover:bg-lantern-background-secondary disabled:opacity-30 disabled:hover:bg-transparent"
                      >
                        <ArrowUpIcon className="w-4 h-4" aria-hidden />
                      </button>
                      <button
                        type="button"
                        onClick={() => void move(index, 1)}
                        disabled={busy || isLast}
                        aria-label={`Move ${topic.title} down (currently ${position})`}
                        className="grid place-items-center min-w-[24px] min-h-[24px] rounded text-lantern-text-secondary hover:text-lantern-text hover:bg-lantern-background-secondary disabled:opacity-30 disabled:hover:bg-transparent"
                      >
                        <ArrowDownIcon className="w-4 h-4" aria-hidden />
                      </button>
                    </div>

                    {isEditing ? (
                      <div className="flex-1 min-w-0 flex items-center gap-1.5">
                        <input
                          type="text"
                          value={draftTitle}
                          onChange={(e) => setDraftTitle(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              void saveRename(topic);
                            } else if (e.key === 'Escape') {
                              e.preventDefault();
                              cancelRename();
                            }
                          }}
                          maxLength={TOPIC_TITLE_MAX}
                          aria-label={COURSE_TOPIC_COPY.rename}
                          autoFocus
                          className="flex-1 min-w-0 px-2 py-1 text-sm rounded-md border border-lantern-border bg-lantern-surface dark:bg-lantern-surface text-lantern-text focus:outline-none focus:ring-2 focus:ring-lantern-primary"
                        />
                        <button
                          type="button"
                          onClick={() => void saveRename(topic)}
                          disabled={busy}
                          aria-label={`Save ${topic.title}`}
                          className="shrink-0 rounded p-1 text-lantern-primary hover:bg-lantern-primary/10 disabled:opacity-50"
                        >
                          <CheckIcon className="w-4 h-4" aria-hidden />
                        </button>
                        <button
                          type="button"
                          onClick={cancelRename}
                          disabled={busy}
                          aria-label={COURSE_TOPIC_COPY.deleteCancel}
                          className="shrink-0 rounded p-1 text-lantern-text-secondary hover:bg-lantern-background-secondary disabled:opacity-50"
                        >
                          <XMarkIcon className="w-4 h-4" aria-hidden />
                        </button>
                      </div>
                    ) : (
                      <>
                        <span className="flex-1 min-w-0 truncate text-sm text-lantern-text" title={topic.title}>
                          {topic.title || COURSE_TOPIC_COPY.untitled}
                        </span>
                        <button
                          type="button"
                          onClick={() => beginRename(topic)}
                          disabled={busy}
                          aria-label={`${COURSE_TOPIC_COPY.rename}: ${topic.title}`}
                          className="shrink-0 rounded p-1 text-lantern-text-secondary hover:text-lantern-text hover:bg-lantern-background-secondary disabled:opacity-50"
                        >
                          <PencilSquareIcon className="w-4 h-4" aria-hidden />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setActionError(null);
                            setPendingDelete(topic);
                          }}
                          disabled={busy}
                          aria-label={`${COURSE_TOPIC_COPY.delete}: ${topic.title}`}
                          className="shrink-0 rounded p-1 text-lantern-text-secondary hover:text-red-600 dark:hover:text-red-400 hover:bg-lantern-background-secondary disabled:opacity-50"
                        >
                          <TrashIcon className="w-4 h-4" aria-hidden />
                        </button>
                      </>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {unmatchedPlan.visible ? (
          <div className="mt-4 border-t border-lantern-border/60 pt-3">
            <h3 className="text-body font-semibold text-lantern-text">Unmatched tags</h3>
            <p className="text-label text-lantern-text-tertiary">
              You already file work under these, but they are not in the outline yet.
            </p>
            <ul className="mt-2 space-y-1.5">
              {unmatchedPlan.tags.slice(0, 6).map((row) => (
                <li key={row.tag} className="flex items-center gap-2">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-caption text-lantern-text">{row.tag}</span>
                    <span className="block text-label text-lantern-text-tertiary">
                      {unmatchedTagSubtitle(row)}
                    </span>
                  </span>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => void addTagAsTopic(row.tag)}
                    disabled={busy}
                    className="min-h-[44px] shrink-0"
                  >
                    Add as topic
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="mt-4 flex justify-end">
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy} className="min-h-[44px]">
            Done
          </Button>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!pendingDelete}
        title={formatDeleteTopicTitle(pendingDelete?.title)}
        message={deleteError ? `${COURSE_TOPIC_COPY.deleteBody}\n\n${deleteError}` : COURSE_TOPIC_COPY.deleteBody}
        confirmLabel={COURSE_TOPIC_COPY.deleteConfirm}
        cancelLabel={COURSE_TOPIC_COPY.deleteCancel}
        danger
        loading={busy}
        onConfirm={() => void confirmDelete()}
        onCancel={() => {
          if (busy) return;
          setPendingDelete(null);
          setDeleteError(null);
        }}
      />
    </>
  );
};

export default ManageOutlineModal;
