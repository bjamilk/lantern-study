import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Modal from '../ui/Modal';
import {
  AcademicCapIcon,
  ArrowLeftIcon,
  MagnifyingGlassIcon,
  PhotoIcon,
} from '@heroicons/react/24/outline';
import {
  COURSE_ANCHOR_COPY,
  courseAnchorLabel,
  courseListingCountLabel,
  type MarketplaceCourseSummary,
} from '@lantern/shared/marketplace';
import { useUIStore } from '../../stores/uiStore';
import {
  fetchMarketplaceCourseListings,
  fetchMarketplaceCourses,
  type CourseBrowsePage,
} from './courseBrowseApi';

interface CourseBrowsePanelProps {
  isOpen: boolean;
  onClose: () => void;
  /**
   * Which course is open, from `/campus/shop/courses/:courseId`. The panel
   * holds no drill-down state of its own: the url is the authority, so a
   * refresh lands back on the same course and Back returns to the index.
   */
  courseId?: string | null;
  /** Navigate to a course page. The caller changes the url; this re-renders. */
  onOpenCourse?: (courseId: string) => void;
  /** Back to the course index (`/campus/shop/courses`). */
  onOpenCourseIndex?: () => void;
  /** Opens the listing detail screen; the panel closes first. */
  onOpenListing: (listingId: string) => void;
  /** Scope the index to one institution (defaults to every campus). */
  institutionId?: string | null;
}

const naira = (value: number) => `₦${value.toLocaleString()}`;

function kindLabel(kind: string | null): string {
  if (kind === 'question_bank') return 'Question bank';
  if (kind === 'study_pack') return 'Study pack';
  return 'Listing';
}

/**
 * "Browse by course" — the durable way into the digital marketplace.
 *
 * Two levels inside one panel: the index of courses that actually have an
 * active listing, then that course's banks and packs. Both states are honest —
 * a course with nothing published never appears in the index, and an empty
 * course page says so instead of showing a spinner forever.
 *
 * LOW-DATA: the index is text only (it never requests an image at all — the
 * API does not even send one), and the course page keeps thumbnails behind a
 * "Show images" chip, the same tap-to-load bargain the rest of the app makes.
 * With the app-wide low-data setting on, the chip starts off; otherwise it
 * starts on, so nobody has to opt in twice.
 */
export const CourseBrowsePanel: React.FC<CourseBrowsePanelProps> = ({
  isOpen,
  onClose,
  courseId = null,
  onOpenCourse,
  onOpenCourseIndex,
  onOpenListing,
  institutionId = null,
}) => {
  const lowDataMode = useUIStore((s) => s.lowDataMode);
  const [courses, setCourses] = useState<MarketplaceCourseSummary[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  // Only a label cache, filled when the reader arrives from the index — a
  // deep link has no summary, so the header falls back to the loaded page.
  const [openCourse, setOpenCourse] = useState<MarketplaceCourseSummary | null>(null);
  const [page, setPage] = useState<CourseBrowsePage | null>(null);
  const [pageLoading, setPageLoading] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const [showImages, setShowImages] = useState(!lowDataMode);

  const loadCourses = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchMarketplaceCourses({ institutionId });
      setCourses(result.courses);
      setTruncated(result.truncated);
    } catch (err) {
      // A failure must never render as "no course has anything", which is a
      // different and false claim.
      setError(err instanceof Error ? err.message : COURSE_ANCHOR_COPY.browseError);
    } finally {
      setLoading(false);
    }
  }, [institutionId]);

  // The index is only needed on the index url; a deep link straight to a
  // course must not pay for it.
  useEffect(() => {
    if (!isOpen || courseId) return;
    void loadCourses();
  }, [isOpen, courseId, loadCourses]);

  useEffect(() => {
    setShowImages(!lowDataMode);
  }, [lowDataMode]);

  const loadCoursePage = useCallback(async (id: string) => {
    setPage(null);
    setPageError(null);
    setPageLoading(true);
    try {
      setPage(await fetchMarketplaceCourseListings(id));
    } catch (err) {
      setPageError(err instanceof Error ? err.message : COURSE_ANCHOR_COPY.browseError);
    } finally {
      setPageLoading(false);
    }
  }, []);

  // The open course follows the url — including a Back step out of a course,
  // which clears `courseId` and returns the reader to the index.
  useEffect(() => {
    if (!isOpen || !courseId) {
      setPage(null);
      setPageError(null);
      setOpenCourse(null);
      return;
    }
    void loadCoursePage(courseId);
  }, [isOpen, courseId, loadCoursePage]);

  const visibleCourses = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return courses;
    return courses.filter(
      (course) =>
        course.code.toLowerCase().includes(q) ||
        (course.title || '').toLowerCase().includes(q) ||
        (course.institutionName || '').toLowerCase().includes(q)
    );
  }, [courses, query]);

  const renderIndex = () => (
    <>
      <div className="relative">
        <MagnifyingGlassIcon
          className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-lantern-text-tertiary pointer-events-none"
          aria-hidden
        />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search courses"
          placeholder="Search course code, title or campus"
          className="w-full pl-9 pr-3 py-2.5 rounded-lg border border-lantern-border bg-lantern-surface text-sm text-lantern-text focus:outline-none focus:ring-2 focus:ring-lantern-primary"
        />
      </div>

      {loading ? (
        <p className="py-8 text-center text-sm text-lantern-text-secondary">Loading courses…</p>
      ) : error ? (
        <div role="alert" className="py-8 text-center space-y-3">
          <p className="text-sm text-lantern-error">{error}</p>
          <button
            type="button"
            onClick={() => void loadCourses()}
            className="px-3 py-2 rounded-lg border border-lantern-border text-sm font-semibold text-lantern-text hover:bg-lantern-background"
          >
            {COURSE_ANCHOR_COPY.retry}
          </button>
        </div>
      ) : visibleCourses.length === 0 ? (
        <p className="py-8 text-center text-sm text-lantern-text-secondary">
          {courses.length === 0
            ? COURSE_ANCHOR_COPY.browseEmpty
            : `No course matches "${query.trim()}".`}
        </p>
      ) : (
        <ul className="divide-y divide-lantern-border rounded-lg border border-lantern-border overflow-hidden">
          {visibleCourses.map((course) => (
            <li key={course.courseId}>
              <button
                type="button"
                onClick={() => {
                  setOpenCourse(course);
                  onOpenCourse?.(course.courseId);
                }}
                className="w-full text-left px-3 py-3 min-h-[44px] hover:bg-lantern-background focus:outline-none focus:ring-2 focus:ring-inset focus:ring-lantern-primary"
              >
                <span className="block text-sm font-semibold text-lantern-text">
                  {courseAnchorLabel(course)}
                </span>
                <span className="block text-xs text-lantern-text-secondary">
                  {course.institutionName || 'Not tied to a campus'}
                </span>
                <span className="block text-xs text-lantern-text-tertiary">
                  {courseListingCountLabel(course)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {truncated ? (
        <p className="text-xs text-lantern-text-tertiary">
          Showing the busiest courses. Search above to narrow this down.
        </p>
      ) : null}
    </>
  );

  const renderCoursePage = () => (
    <>
      <button
        type="button"
        onClick={() => onOpenCourseIndex?.()}
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-lantern-primary min-h-[44px]"
      >
        <ArrowLeftIcon className="w-4 h-4" aria-hidden />
        All courses
      </button>

      <div>
        <h4 className="text-base font-bold text-lantern-text">
          {page ? courseAnchorLabel(page.course) : openCourse ? courseAnchorLabel(openCourse) : ''}
        </h4>
        <p className="text-xs text-lantern-text-secondary">
          {page?.course.institutionName || openCourse?.institutionName || 'Not tied to a campus'}
        </p>
      </div>

      {pageLoading ? (
        <p className="py-8 text-center text-sm text-lantern-text-secondary">Loading listings…</p>
      ) : pageError ? (
        <div role="alert" className="py-8 text-center space-y-3">
          <p className="text-sm text-lantern-error">{pageError}</p>
          <button
            type="button"
            onClick={() => courseId && void loadCoursePage(courseId)}
            className="px-3 py-2 rounded-lg border border-lantern-border text-sm font-semibold text-lantern-text hover:bg-lantern-background"
          >
            {COURSE_ANCHOR_COPY.retry}
          </button>
        </div>
      ) : !page || page.listings.length === 0 ? (
        <p className="py-8 text-center text-sm text-lantern-text-secondary">
          {COURSE_ANCHOR_COPY.browseEmptyForCourse}
        </p>
      ) : (
        <>
          {page.listings.some((listing) => listing.imageUrl) ? (
            <button
              type="button"
              onClick={() => setShowImages((value) => !value)}
              aria-pressed={showImages}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full border border-lantern-border text-xs font-semibold text-lantern-text-secondary hover:text-lantern-text min-h-[36px]"
            >
              <PhotoIcon className="w-4 h-4" aria-hidden />
              {showImages ? 'Hide images' : COURSE_ANCHOR_COPY.showImages}
            </button>
          ) : null}
          {!showImages ? (
            <p className="text-xs text-lantern-text-tertiary">{COURSE_ANCHOR_COPY.imagesOffNote}</p>
          ) : null}

          <ul className="space-y-2">
            {page.listings.map((listing) => (
              <li key={listing.id}>
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenListing(listing.id);
                  }}
                  className="w-full flex items-start gap-3 text-left p-3 min-h-[44px] rounded-lg border border-lantern-border hover:bg-lantern-background focus:outline-none focus:ring-2 focus:ring-lantern-primary"
                >
                  {showImages && listing.imageUrl ? (
                    <img
                      src={listing.imageUrl}
                      alt=""
                      loading="lazy"
                      className="w-14 h-14 rounded-md object-cover shrink-0 bg-lantern-background-secondary"
                    />
                  ) : null}
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-lantern-text truncate">
                      {listing.title}
                    </span>
                    <span className="block text-xs text-lantern-text-secondary">
                      {kindLabel(listing.listingKind)}
                      {listing.questionCount != null
                        ? ` · ${listing.questionCount} question${listing.questionCount === 1 ? '' : 's'}`
                        : ''}
                      {listing.sellerName ? ` · ${listing.sellerName}` : ''}
                    </span>
                    <span className="block text-xs font-semibold text-lantern-text">
                      {listing.price && listing.price > 0 ? naira(listing.price) : 'Free'}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <p className="text-xs text-lantern-text-tertiary">
            {page.total} listing{page.total === 1 ? '' : 's'} filed under this course.
          </p>
        </>
      )}
    </>
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      ariaLabelledBy="course-browse-title"
      maxWidthClass="max-w-lg"
      panelClassName="!p-0 overflow-hidden rounded-xl"
    >
      <div className="w-full">
        <div className="flex items-center gap-2 p-5 border-b border-lantern-border">
          <AcademicCapIcon className="w-5 h-5 text-lantern-primary" aria-hidden />
          <div className="min-w-0">
            <h3 id="course-browse-title" className="text-lg font-bold text-lantern-text">
              {COURSE_ANCHOR_COPY.browseTitle}
            </h3>
            <p className="text-xs text-lantern-text-secondary">
              {COURSE_ANCHOR_COPY.browseSubtitle}
            </p>
          </div>
        </div>
        <div className="p-5 space-y-3 max-h-[70vh] overflow-y-auto">
          {courseId ? renderCoursePage() : renderIndex()}
        </div>
      </div>
    </Modal>
  );
};

export default CourseBrowsePanel;
