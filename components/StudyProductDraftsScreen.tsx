import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  createStudyPackDraft,
  fetchStudyPackDrafts,
  fetchStudyPackDraft,
  deleteStudyPackDraft,
  type StudyPackDraftSummary,
  type StudyPackDraft,
} from '../services/supabase';
import * as notesApi from '../services/notes';
import { PublishStudyPackModal } from './marketplace/PublishStudyPackModal';
import { useToastStore } from '../stores/toastStore';
import { summarizeStudyPackCounts, STUDY_PACK_DRAFT_CREDITS } from '@lantern/shared/marketplace';
import {
  ArrowLeftIcon,
  SparklesIcon,
  TrashIcon,
  ArrowPathIcon,
  BuildingStorefrontIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline';

/** A source handed in by an entry point ("Turn this into a Study Product"). */
export interface StudyProductDraftSource {
  noteIds?: string[];
  folderId?: string | null;
  courseId?: string | null;
  title?: string;
}

interface Props {
  onBack: () => void;
  /** When present, a draft is generated from this source on mount. */
  initialSource?: StudyProductDraftSource | null;
  /**
   * Called once the source has been turned into a draft. The owner MUST clear
   * it — otherwise returning to this screen would silently spend credits
   * generating the same draft again.
   */
  onSourceConsumed?: () => void;
  onNavigate?: (screen: string, params?: any) => void;
}

const POLL_MS = 4000;

export const StudyProductDraftsScreen: React.FC<Props> = ({
  onBack,
  initialSource,
  onSourceConsumed,
  onNavigate,
}) => {
  const [drafts, setDrafts] = useState<StudyPackDraftSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reviewDraft, setReviewDraft] = useState<StudyPackDraft | null>(null);
  const showToast = useToastStore((s) => s.showToast);
  const createdRef = useRef(false);

  const load = useCallback(async () => {
    try {
      setDrafts(await fetchStudyPackDrafts());
      setError(null);
    } catch (e: any) {
      setError(e?.message || 'Could not load your drafts.');
    } finally {
      setLoading(false);
    }
  }, []);

  // Generate from the entry-point source once.
  useEffect(() => {
    if (!initialSource || createdRef.current) return;
    createdRef.current = true;
    setCreating(true);
    void (async () => {
      try {
        for (const id of initialSource.noteIds || []) {
          try {
            await notesApi.waitForNoteOcr(id);
          } catch {
            /* proceed even if OCR is still running — the factory waits too */
          }
        }
        await createStudyPackDraft(initialSource);
        showToast('Generating your study product… this takes a moment.');
      } catch (e: any) {
        showToast(e?.message || 'Could not start the study product.', 'error');
      } finally {
        setCreating(false);
        onSourceConsumed?.();
        void load();
      }
    })();
  }, [initialSource, load, showToast, onSourceConsumed]);

  useEffect(() => {
    void load();
  }, [load]);

  // Poll while anything is still generating.
  const hasPending = drafts.some((d) => d.status === 'queued' || d.status === 'generating');
  useEffect(() => {
    if (!hasPending) return;
    const t = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(t);
  }, [hasPending, load]);

  const handleDelete = async (id: string) => {
    setDrafts((prev) => prev.filter((d) => d.id !== id));
    try {
      await deleteStudyPackDraft(id);
    } catch {
      void load();
    }
  };

  const handleReview = async (id: string) => {
    try {
      setReviewDraft(await fetchStudyPackDraft(id));
    } catch (e: any) {
      showToast(e?.message || 'Could not open this draft.', 'error');
    }
  };

  return (
    <div className="min-h-full bg-lantern-background">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-5 sm:py-7">
        <div className="flex items-center gap-3 mb-1">
          <button
            onClick={onBack}
            className="p-2 -ml-2 rounded-lg text-lantern-text-secondary hover:text-lantern-text hover:bg-lantern-background-secondary transition-colors"
            aria-label="Back"
          >
            <ArrowLeftIcon className="w-5 h-5" />
          </button>
          <div className="flex-1">
            <h1 className="text-xl sm:text-2xl font-bold text-lantern-text flex items-center gap-2">
              <SparklesIcon className="w-6 h-6 text-lantern-primary" />
              Study Products
            </h1>
            <p className="text-sm text-lantern-text-secondary">
              Turn your notes into a sellable study pack — AI writes the guide, cards and questions.
            </p>
          </div>
          <button
            onClick={() => void load()}
            className="p-2 rounded-lg text-lantern-text-secondary hover:text-lantern-text hover:bg-lantern-background-secondary transition-colors"
            aria-label="Refresh"
          >
            <ArrowPathIcon className="w-5 h-5" />
          </button>
        </div>

        {creating && (
          <div className="mt-4 rounded-xl border border-lantern-primary/30 bg-lantern-primary/5 px-4 py-2.5 text-sm text-lantern-text">
            Starting a new study product… (uses {STUDY_PACK_DRAFT_CREDITS} AI credits)
          </div>
        )}

        {loading ? (
          <div className="mt-4 space-y-3">
            {[0, 1].map((i) => (
              <div key={i} className="h-24 rounded-xl bg-lantern-background-secondary animate-pulse" />
            ))}
          </div>
        ) : error ? (
          <div className="mt-4 rounded-xl border border-lantern-error/30 bg-lantern-error/5 p-4 text-sm text-lantern-error">
            {error}
            <button onClick={() => void load()} className="ml-2 font-semibold underline">
              Retry
            </button>
          </div>
        ) : drafts.length === 0 ? (
          <div className="mt-6 rounded-2xl border border-lantern-border bg-lantern-surface p-8 text-center">
            <SparklesIcon className="w-10 h-10 mx-auto text-lantern-text-tertiary mb-3" />
            <p className="text-lantern-text font-semibold">No study products yet</p>
            <p className="text-sm text-lantern-text-secondary mt-1">
              Open a note and press <span className="font-semibold">Sell</span>, or pick a course in
              your Library and choose <span className="font-semibold">Create a study pack</span>.
              Lantern drafts the guide, flashcards and questions for you to review before publishing.
            </p>
            <p className="text-xs text-lantern-text-tertiary mt-2">
              Uses {STUDY_PACK_DRAFT_CREDITS} AI credits per draft.
            </p>
          </div>
        ) : (
          <ul className="mt-4 space-y-3">
            {drafts.map((d) => {
              const pending = d.status === 'queued' || d.status === 'generating';
              const countLine = summarizeStudyPackCounts(d.counts || {});
              return (
                <li
                  key={d.id}
                  className="rounded-xl border border-lantern-border bg-lantern-surface p-4 flex items-start gap-3"
                >
                  <div className="mt-0.5 shrink-0 w-9 h-9 rounded-lg bg-lantern-primary-background flex items-center justify-center">
                    {pending ? (
                      <ArrowPathIcon className="w-5 h-5 text-lantern-primary animate-spin" />
                    ) : d.status === 'failed' ? (
                      <ExclamationTriangleIcon className="w-5 h-5 text-lantern-error" />
                    ) : (
                      <SparklesIcon className="w-5 h-5 text-lantern-primary" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-lantern-text truncate">
                      {d.suggested_title || 'Untitled study product'}
                    </p>
                    <p className="text-xs text-lantern-text-tertiary mt-0.5">
                      {pending
                        ? 'Generating…'
                        : d.status === 'failed'
                          ? d.error || 'Generation failed'
                          : countLine || 'Ready to review'}
                    </p>
                  </div>
                  <div className="shrink-0 self-center flex items-center gap-2">
                    {d.status === 'ready' && (
                      <button
                        onClick={() => void handleReview(d.id)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-lantern-primary hover:bg-lantern-primary-dark text-white text-xs font-semibold transition-colors"
                      >
                        <BuildingStorefrontIcon className="w-3.5 h-3.5" />
                        Review &amp; sell
                      </button>
                    )}
                    <button
                      onClick={() => void handleDelete(d.id)}
                      className="p-1.5 rounded-lg text-lantern-text-tertiary hover:text-lantern-error hover:bg-lantern-error/5 transition-colors"
                      aria-label="Delete draft"
                    >
                      <TrashIcon className="w-4 h-4" />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {reviewDraft && (
        <PublishStudyPackModal
          isOpen={!!reviewDraft}
          onClose={() => setReviewDraft(null)}
          draftId={reviewDraft.id}
          content={reviewDraft.content || {}}
          defaultTitle={reviewDraft.suggested_title || ''}
          defaultDescription={reviewDraft.suggested_description || ''}
          defaultPrice={
            reviewDraft.suggested_price_kobo != null
              ? Math.round(reviewDraft.suggested_price_kobo / 100)
              : null
          }
          defaultCourseId={reviewDraft.course_id ?? null}
          onPublished={(listingId) => {
            setReviewDraft(null);
            setDrafts((prev) => prev.filter((d) => d.id !== reviewDraft.id));
            if (listingId && onNavigate) {
              onNavigate('MarketplaceListingDetail', { listingId });
            }
          }}
        />
      )}
    </div>
  );
};

export default StudyProductDraftsScreen;
