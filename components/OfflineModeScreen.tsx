
import { toDateOnlyLocal } from '@lantern/shared/utils/dateOnly';
import { AppIcon } from './ui/AppIcon';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useToastStore } from '../stores/toastStore';
import { OfflineSessionBundle, Deck } from '../types';
import { syncCopy, featureAccents } from '@lantern/shared/design';
import { useUIStore } from '../stores/uiStore';
import { useAuthStore } from '../stores/authStore';
import { useTestStore } from '../stores/testStore';
import { useLibraryStore } from '../stores/libraryStore';
import { useAcademicStore } from '../stores/academicStore';
import { UNFILED_COURSE_ID, filterBundlesByCourse, matchesCourseFilter } from '../utils/libraryArchive';
import { courseLabel } from '../utils/academicSetup';
import {
  restoreQuestionBanks,
  fetchOfflineBundles,
  fetchQuestionBankUpdates,
  downloadQuestionBank,
} from '../services/supabase';
import { EmptyState } from './ui/EmptyState';
import { FeatureHero } from './ui/FeatureHero';
import { ConnectionBadge } from './ui/ConnectionBadge';
import { OfflineBundleCard } from './offline/OfflineBundleCard';
import PublishQuestionBankModal from './marketplace/PublishQuestionBankModal';

interface OfflineModeScreenProps {
  offlineBundles: OfflineSessionBundle[];
  offlineDecks: Deck[];
  pendingSyncResultsCount: number;
  pendingFlashcardReviewsCount: number;
  onStartOfflineSession: (bundleId: string, mode: 'test' | 'study') => void;
  onDeleteBundle: (bundleId: string) => void;
  onSyncPendingResults: () => void;
  onSyncFlashcardReviews: () => void;
  onImportBundle: (bundle: OfflineSessionBundle) => string | null;
  onRenameBundle: (bundleId: string, newName: string) => void;
  isOnline: boolean;
}

const OfflineModeScreen: React.FC<OfflineModeScreenProps> = ({
  offlineBundles,
  offlineDecks,
  pendingSyncResultsCount,
  pendingFlashcardReviewsCount,
  onStartOfflineSession,
  onDeleteBundle,
  onSyncPendingResults,
  onSyncFlashcardReviews,
  onImportBundle,
  onRenameBundle,
  isOnline,
}) => {
  const { lowDataMode } = useUIStore();
  const importInputRef = useRef<HTMLInputElement>(null);
  const [editingBundleId, setEditingBundleId] = useState<string | null>(null);
  const [editNameValue, setEditNameValue] = useState('');
  const [publishingBundle, setPublishingBundle] = useState<OfflineSessionBundle | null>(null);
  const [restoring, setRestoring] = useState(false);
  // bundleId → new version, for purchased banks the seller has since updated.
  const [bankUpdates, setBankUpdates] = useState<Record<string, number>>({});
  const [updatingBundleId, setUpdatingBundleId] = useState<string | null>(null);
  const currentUserId = useAuthStore((s) => s.currentUser?.id);
  const setOfflineBundles = useTestStore((s) => s.setOfflineBundles);

  // Course filter (Phase 1 · B): follows the Library's archive-wide selection
  // (a course uuid or the 'null' literal for unfiled); filtered client-side by
  // bundle.courseId / config.courseId. Purchased packs are bundleId qbank-*.
  const courseFilterId = useLibraryStore((s) => s.courseFilterId);
  const topicFilterId = useLibraryStore((s) => s.topicFilterId);
  const setCourseFilter = useLibraryStore((s) => s.setCourseFilter);
  const pendingBundleId = useLibraryStore((s) => s.pendingOfflineBundleId);
  const setPendingOfflineBundleId = useLibraryStore((s) => s.setPendingOfflineBundleId);
  const resolveCourse = useAcademicStore((s) => s.resolveCourse);
  const knownCourses = useAcademicStore((s) => s.knownCourses);
  const academicLoaded = useAcademicStore((s) => s.loaded);
  const loadMyCourses = useAcademicStore((s) => s.loadMyCourses);
  void knownCourses; // subscribe so the chip label resolves once courses load
  useEffect(() => {
    if (courseFilterId && !academicLoaded) void loadMyCourses();
  }, [courseFilterId, academicLoaded, loadMyCourses]);
  const filterCourse = courseFilterId && courseFilterId !== UNFILED_COURSE_ID ? resolveCourse(courseFilterId) : null;
  const visibleBundles = useMemo(() => filterBundlesByCourse(offlineBundles, courseFilterId), [offlineBundles, courseFilterId]);
  const visibleDecks = useMemo(
    () => (courseFilterId ? offlineDecks.filter((d) => matchesCourseFilter(d.courseId, courseFilterId)) : offlineDecks),
    [offlineDecks, courseFilterId]
  );
  // Library search deep link: scroll to + briefly highlight the bundle.
  const [highlightedBundleId, setHighlightedBundleId] = useState<string | null>(null);
  useEffect(() => {
    if (!pendingBundleId) return;
    setHighlightedBundleId(pendingBundleId);
    setPendingOfflineBundleId(null);
    const raf = window.requestAnimationFrame(() => {
      document.getElementById(`offline-bundle-${pendingBundleId}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
    const timer = window.setTimeout(() => setHighlightedBundleId(null), 4000);
    return () => {
      window.cancelAnimationFrame(raf);
      window.clearTimeout(timer);
    };
  }, [pendingBundleId, setPendingOfflineBundleId]);

  useEffect(() => {
    if (!isOnline || !currentUserId) return;
    let cancelled = false;
    void fetchQuestionBankUpdates()
      .then((updates) => {
        if (cancelled) return;
        setBankUpdates(
          Object.fromEntries(updates.map((u) => [u.bundleId, u.version]))
        );
      })
      .catch(() => {
        // update checks are best-effort; offline copies keep working
      });
    return () => {
      cancelled = true;
    };
  }, [isOnline, currentUserId]);

  const handleUpdateBank = async (bundle: OfflineSessionBundle) => {
    const listingId = bundle.bundleId.replace(/^qbank-/, '');
    setUpdatingBundleId(bundle.bundleId);
    try {
      await downloadQuestionBank(listingId);
      if (currentUserId) {
        const cloudBundles = await fetchOfflineBundles(currentUserId);
        setOfflineBundles(cloudBundles as unknown as OfflineSessionBundle[]);
      }
      setBankUpdates((prev) => {
        const next = { ...prev };
        delete next[bundle.bundleId];
        return next;
      });
      useToastStore.getState().showToast('Question bank updated to the latest version.');
    } catch (err: any) {
      useToastStore.getState().showToast(err?.message || 'Could not update question bank', 'error');
    } finally {
      setUpdatingBundleId(null);
    }
  };

  /** Pull purchased question banks back onto this device (new install / cleared storage). */
  const handleRestorePurchases = async () => {
    if (!currentUserId) return;
    setRestoring(true);
    try {
      const { restored } = await restoreQuestionBanks();
      const cloudBundles = await fetchOfflineBundles(currentUserId);
      setOfflineBundles(cloudBundles as unknown as OfflineSessionBundle[]);
      useToastStore
        .getState()
        .showToast(
          restored > 0
            ? `Restored ${restored} question bank${restored !== 1 ? 's' : ''}.`
            : 'No purchased question banks to restore.'
        );
    } catch (err: any) {
      useToastStore.getState().showToast(err?.message || 'Could not restore purchases', 'error');
    } finally {
      setRestoring(false);
    }
  };

  const handleExportBundle = (bundle: OfflineSessionBundle) => {
    const displayName = bundle.displayName || bundle.groupName;
    const filename = `lantern-bundle-${displayName.replace(/\s+/g, '-')}-${toDateOnlyLocal(new Date(bundle.downloadedAt))}.json`;
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const startEditing = (bundle: OfflineSessionBundle) => {
    setEditingBundleId(bundle.bundleId);
    setEditNameValue(bundle.displayName || bundle.groupName);
  };

  const commitRename = (bundleId: string) => {
    onRenameBundle(bundleId, editNameValue);
    setEditingBundleId(null);
  };

  const cancelEditing = () => setEditingBundleId(null);

  const handleFileImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const parsed = JSON.parse(event.target?.result as string);
        if (!parsed.questions || !Array.isArray(parsed.questions) || !parsed.config || !parsed.groupName) {
          useToastStore.getState().showToast('Invalid bundle file. Please use a file exported from Lantern Study.', 'error');
          return;
        }
        const newBundleId = onImportBundle(parsed as OfflineSessionBundle);
        if (newBundleId) {
          setEditingBundleId(newBundleId);
          setEditNameValue(parsed.groupName);
        }
      } catch {
        useToastStore.getState().showToast('Could not read the file. Make sure it is a valid Lantern bundle (.json).', 'error');
      } finally {
        if (importInputRef.current) importInputRef.current.value = '';
      }
    };
    reader.readAsText(file);
  };

  const totalPendingSync = pendingSyncResultsCount + pendingFlashcardReviewsCount;

  return (
    <div className="flex-1 flex flex-col p-4 md:p-6 bg-lantern-background text-lantern-text overflow-y-auto">
      <FeatureHero
        title="Offline Activity"
        subtitle="Download test bundles and flashcard decks to study without a connection. Results and reviews sync automatically when you're back online."
        accentColor={featureAccents.offline}
        icon={<AppIcon name="cloud-download" size={24} />}
        actions={
          <>
            <input
              ref={importInputRef}
              type="file"
              accept=".json"
              className="hidden"
              onChange={handleFileImport}
            />
            <button
              type="button"
              onClick={() => importInputRef.current?.click()}
              className="flex items-center gap-2 px-4 py-2 min-h-[44px] bg-lantern-primary hover:bg-lantern-primary-dark text-white rounded-lantern text-sm font-medium transition-colors"
              title="Import a shared bundle file (.json)"
            >
              <AppIcon name="upload" size={16} />
              Import Bundle
            </button>
            <button
              type="button"
              onClick={() => void handleRestorePurchases()}
              disabled={!isOnline || restoring}
              className="flex items-center gap-2 px-4 py-2 min-h-[44px] border border-lantern-border text-lantern-text hover:border-lantern-primary/40 rounded-lantern text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              title="Re-download question banks you bought on the marketplace"
            >
              <AppIcon name="bag" size={16} />
              {restoring ? 'Restoring…' : 'Restore purchases'}
            </button>
          </>
        }
      >
        <div className="flex flex-wrap items-center gap-2">
          <ConnectionBadge
            isOnline={isOnline}
            lowDataMode={lowDataMode}
            pendingSyncCount={totalPendingSync}
          />
          {lowDataMode ? (
            <span className="text-xs text-lantern-text-secondary">{syncCopy.savedLocally}</span>
          ) : null}
        </div>
      </FeatureHero>

      {lowDataMode && (
        <div className="mb-4 flex items-start gap-3 p-3 bg-lantern-accent-background border border-amber-200 dark:border-amber-700 rounded-lantern text-sm text-amber-800 dark:text-amber-300">
          <span className="font-semibold whitespace-nowrap">Low-data mode</span>
          <span>Download bundles below to study offline. {syncCopy.savedLocally}</span>
        </div>
      )}

      {courseFilterId ? (
        <div
          className="mb-4 flex flex-wrap items-center gap-2 rounded-lantern border border-lantern-border bg-lantern-surface px-3 py-2 text-sm"
          role="status"
        >
          <AppIcon name="school" size={16} className="text-lantern-primary shrink-0" aria-hidden />
          <span className="text-lantern-text-secondary">Showing</span>
          <span className="font-semibold text-lantern-text truncate">
            {courseFilterId === UNFILED_COURSE_ID ? 'unfiled bundles' : filterCourse ? courseLabel(filterCourse) : 'one course'}
          </span>
          <span className="text-xs text-lantern-text-tertiary">
            ({visibleBundles.length} of {offlineBundles.length} bundle{offlineBundles.length === 1 ? '' : 's'})
          </span>
          {/* offline_bundles has no topic_id, so a topic cannot narrow this list.
              Say so rather than showing the whole course under a topic chip. */}
          {topicFilterId ? (
            <span className="w-full text-xs text-lantern-text-tertiary">
              Downloads are filed by course, not by topic — showing the whole course.
            </span>
          ) : null}
          <button
            type="button"
            onClick={() => setCourseFilter(null)}
            className="ml-auto inline-flex items-center gap-1 rounded-full border border-lantern-border px-2 py-0.5 text-xs font-medium text-lantern-text hover:bg-lantern-background-secondary"
          >
            <AppIcon name="close" size={12} aria-hidden /> Show all
          </button>
        </div>
      ) : null}

      {/* No standing "Sync Status" section (founder decision 2026-08-29: the
          sync badge suffices). Pending work still surfaces a compact bar,
          because a stuck auto-sync needs a visible retry. */}
      {totalPendingSync > 0 && (
        <section className="mb-8 shrink-0">
          <div className="bg-lantern-surface border border-lantern-border p-4 rounded-lantern-xl shadow-lantern space-y-4">
            {pendingSyncResultsCount > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-lantern-accent mb-0">
                  {syncCopy.pendingSync(pendingSyncResultsCount)} (test results)
                </p>
                <button
                  type="button"
                  onClick={onSyncPendingResults}
                  disabled={!isOnline}
                  className="px-4 py-2 min-h-[44px] bg-lantern-success hover:opacity-90 text-white rounded-lantern flex items-center text-sm disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
                >
                  <AppIcon name="refresh" size={20} className="mr-2" />
                  Sync Test Results
                </button>
              </div>
            )}
            {pendingFlashcardReviewsCount > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-lantern-accent mb-0">
                  {pendingFlashcardReviewsCount} flashcard review{pendingFlashcardReviewsCount !== 1 ? 's' : ''} waiting to sync
                </p>
                <button
                  type="button"
                  onClick={onSyncFlashcardReviews}
                  disabled={!isOnline}
                  className="px-4 py-2 min-h-[44px] bg-lantern-success hover:opacity-90 text-white rounded-lantern flex items-center text-sm disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
                >
                  <AppIcon name="refresh" size={20} className="mr-2" />
                  Sync Flashcard Reviews
                </button>
              </div>
            )}
            {!isOnline && (
              <p className="text-xs text-lantern-text-secondary">
                Connect to the internet to sync your pending activity.
              </p>
            )}
          </div>
        </section>
      )}

      {visibleDecks.length > 0 && (
        <section className="mb-8">
          <h2 className="text-lg font-semibold mb-3 text-lantern-text">Downloaded Flashcard Decks</h2>
          <div className="space-y-2">
            {visibleDecks.map(deck => (
              <div
                key={deck.id}
                className="flex items-center justify-between p-3 bg-lantern-surface border border-lantern-border rounded-lantern"
              >
                <span className="font-medium text-lantern-text truncate">{deck.name}</span>
                <span className="text-xs text-lantern-text-secondary shrink-0 ml-2">Available offline</span>
              </div>
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 className="text-lg font-semibold mb-3 text-lantern-text">Downloaded Test Bundles</h2>
        {courseFilterId && visibleBundles.length === 0 && offlineBundles.length > 0 ? (
          <div className="text-center py-10 bg-lantern-surface border border-lantern-border rounded-lantern-xl shadow-lantern">
            <AppIcon name="document-text" size={64} className="text-lantern-text-tertiary mx-auto mb-4" />
            <p className="text-lantern-text-secondary">
              {courseFilterId === UNFILED_COURSE_ID
                ? 'Every downloaded bundle is filed under a course.'
                : 'No downloaded bundles for this course yet.'}
            </p>
            <button
              type="button"
              onClick={() => setCourseFilter(null)}
              className="mt-3 text-sm font-medium text-lantern-primary underline-offset-2 hover:underline"
            >
              Show all bundles
            </button>
          </div>
        ) : visibleBundles.length > 0 ? (
          <div className="space-y-4">
            {visibleBundles.map(bundle => (
              <div
                key={bundle.bundleId}
                id={`offline-bundle-${bundle.bundleId}`}
                className={`rounded-lantern-xl transition-shadow ${
                  highlightedBundleId === bundle.bundleId ? 'ring-2 ring-lantern-primary ring-offset-2 ring-offset-lantern-background' : ''
                }`}
              >
              <OfflineBundleCard
                bundle={bundle}
                isEditing={editingBundleId === bundle.bundleId}
                editNameValue={editNameValue}
                onEditNameChange={setEditNameValue}
                onStartEdit={() => startEditing(bundle)}
                onCommitRename={() => commitRename(bundle.bundleId)}
                onCancelEdit={cancelEditing}
                onExport={() => handleExportBundle(bundle)}
                onStartTest={() => onStartOfflineSession(bundle.bundleId, 'test')}
                onStartStudy={() => onStartOfflineSession(bundle.bundleId, 'study')}
                onDelete={() => onDeleteBundle(bundle.bundleId)}
                onPublish={
                  // Purchased banks (qbank-*) are someone else's product — no re-publishing.
                  isOnline && !bundle.bundleId.startsWith('qbank-')
                    ? () => setPublishingBundle(bundle)
                    : undefined
                }
                isPurchased={bundle.bundleId.startsWith('qbank-')}
                updateAvailable={isOnline && !!bankUpdates[bundle.bundleId]}
                onUpdate={() => void handleUpdateBank(bundle)}
                updating={updatingBundleId === bundle.bundleId}
              />
              </div>
            ))}
          </div>
        ) : (
          /* The screen's one tint panel (§5.6 empty state), in amber — the hue
             §5.7 gives Downloads on Me, so the same idea is the same colour
             wherever a student meets it. The benefit line says what downloading
             buys, not that the list is empty. */
          <EmptyState
            compact
            feature="budget"
            illustration="download-phone"
            title="Nothing saved on this device yet"
            description="A downloaded test runs with no signal and costs no data to sit — download a group's questions and they wait here until you do."
          />
        )}
      </section>

      {publishingBundle ? (
        <PublishQuestionBankModal
          bundle={publishingBundle}
          isOpen={!!publishingBundle}
          onClose={() => setPublishingBundle(null)}
        />
      ) : null}
    </div>
  );
};

export default OfflineModeScreen;
