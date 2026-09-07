import React from 'react';
import { AppIcon } from '../ui/AppIcon';
import { COURSE_TOPIC_COPY } from '@lantern/shared';
import { useLibraryStore } from '../../stores/libraryStore';
import { useCourseFilterShownAbove } from './CourseChips';
import { UNFILED_COURSE_ID, UNTOPICED_TOPIC_ID } from '../../utils/libraryArchive';

/**
 * The Library's active topic, shown beside the course chips on Notes and
 * Flashcards.
 *
 * `CourseChips` names only the course, so on its own a topic picked in the
 * Library rail quietly shortens those lists with nothing on screen to explain
 * or undo it. Clearing here widens to the whole course — never all the way to
 * "everything", which is what the course chip is for.
 *
 * Inside the Library that job belongs to the scope row above the panels, so
 * this renders nothing there (see `CourseFilterShownAboveProvider`).
 */
export const TopicFilterChip: React.FC<{ className?: string }> = ({ className = '' }) => {
  const shownAbove = useCourseFilterShownAbove();
  const courseFilterId = useLibraryStore((s) => s.courseFilterId);
  const topicFilterId = useLibraryStore((s) => s.topicFilterId);
  const topicFilterLabel = useLibraryStore((s) => s.topicFilterLabel);
  const setTopicFilter = useLibraryStore((s) => s.setTopicFilter);

  if (shownAbove) return null;
  if (!courseFilterId || courseFilterId === UNFILED_COURSE_ID || !topicFilterId) return null;
  const label = topicFilterId === UNTOPICED_TOPIC_ID ? COURSE_TOPIC_COPY.none : topicFilterLabel || COURSE_TOPIC_COPY.filterLabel;

  return (
    <span
      className={`inline-flex w-max items-center gap-1.5 rounded-full border border-lantern-border bg-lantern-background-secondary px-2.5 py-1 text-xs font-medium text-lantern-text-secondary ${className}`}
    >
      <AppIcon name="bookmark" size={14} className="shrink-0" aria-hidden />
      <span className="truncate max-w-[12rem]">{label}</span>
      <button
        type="button"
        onClick={() => setTopicFilter(courseFilterId, null)}
        title={COURSE_TOPIC_COPY.filterClearHint}
        aria-label={`Clear topic filter ${label}`}
        className="rounded-full p-0.5 hover:bg-lantern-surface"
      >
        <AppIcon name="close" size={12} aria-hidden />
      </button>
    </span>
  );
};

export default TopicFilterChip;
