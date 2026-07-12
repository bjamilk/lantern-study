
import React, { useRef, useState } from 'react';
import { useToastStore } from '../stores/toastStore';
import { OfflineSessionBundle, Deck } from '../types';
import { CloudArrowDownIcon, ArrowPathIcon, DocumentTextIcon, ArrowUpTrayIcon } from '@heroicons/react/24/outline';
import { syncCopy, featureAccents } from '@lantern/shared/design';
import { useUIStore } from '../stores/uiStore';
import { FeatureHero } from './ui/FeatureHero';
import { ConnectionBadge } from './ui/ConnectionBadge';
import { OfflineBundleCard } from './offline/OfflineBundleCard';

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

  const handleExportBundle = (bundle: OfflineSessionBundle) => {
    const displayName = bundle.displayName || bundle.groupName;
    const filename = `lantern-bundle-${displayName.replace(/\s+/g, '-')}-${new Date(bundle.downloadedAt).toISOString().split('T')[0]}.json`;
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
        subtitle="Download test bundles from groups and study without a connection."
        accentColor={featureAccents.offline}
        icon={<CloudArrowDownIcon className="w-6 h-6" />}
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
              <ArrowUpTrayIcon className="w-4 h-4" />
              Import Bundle
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
          <span className="font-semibold whitespace-nowrap">Low-Data Mode</span>
          <span>Download bundles below to study offline. {syncCopy.savedLocally}</span>
        </div>
      )}

      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-3 text-lantern-text">Sync Status</h2>
        <div className="bg-lantern-surface border border-lantern-border p-4 rounded-lantern-xl shadow-lantern space-y-4">
          {pendingSyncResultsCount > 0 ? (
            <div className="flex flex-col sm:flex-row justify-between items-center gap-3">
              <p className="text-lantern-accent mb-0">
                {syncCopy.pendingSync(pendingSyncResultsCount)} (test results)
              </p>
              <button
                type="button"
                onClick={onSyncPendingResults}
                disabled={!isOnline}
                className="px-4 py-2 min-h-[44px] bg-lantern-success hover:opacity-90 text-white rounded-lantern flex items-center text-sm disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
              >
                <ArrowPathIcon className="w-5 h-5 mr-2" />
                Sync Test Results
              </button>
            </div>
          ) : (
            <p className="text-lantern-success">All offline test results are synced!</p>
          )}
          {pendingFlashcardReviewsCount > 0 ? (
            <div className="flex flex-col sm:flex-row justify-between items-center gap-3">
              <p className="text-lantern-accent mb-0">
                {pendingFlashcardReviewsCount} flashcard review{pendingFlashcardReviewsCount !== 1 ? 's' : ''} waiting to sync
              </p>
              <button
                type="button"
                onClick={onSyncFlashcardReviews}
                disabled={!isOnline}
                className="px-4 py-2 min-h-[44px] bg-lantern-success hover:opacity-90 text-white rounded-lantern flex items-center text-sm disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
              >
                <ArrowPathIcon className="w-5 h-5 mr-2" />
                Sync Flashcard Reviews
              </button>
            </div>
          ) : (
            <p className="text-lantern-success">All flashcard reviews are synced!</p>
          )}
          {!isOnline && totalPendingSync > 0 && (
            <p className="text-xs text-lantern-text-secondary">
              Connect to the internet to sync your pending activity.
            </p>
          )}
        </div>
      </section>

      {offlineDecks.length > 0 && (
        <section className="mb-8">
          <h2 className="text-lg font-semibold mb-3 text-lantern-text">Downloaded Flashcard Decks</h2>
          <div className="space-y-2">
            {offlineDecks.map(deck => (
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
        {offlineBundles.length > 0 ? (
          <div className="space-y-4">
            {offlineBundles.map(bundle => (
              <OfflineBundleCard
                key={bundle.bundleId}
                bundle={bundle}
                isEditing={editingBundleId === bundle.bundleId}
                editNameValue={editNameValue}
                onEditNameChange={setEditNameValue}
                onStartEdit={() => startEditing(bundle)}
                onCommitRename={() => commitRename(bundle.bundleId)}
                onCancelEdit={cancelEditing}
                onExport={() => handleExportBundle(bundle)}
                onStartTest={() => onStartOfflineSession(bundle.bundleId, 'test')}
                onDelete={() => onDeleteBundle(bundle.bundleId)}
              />
            ))}
          </div>
        ) : (
          <div className="text-center py-10 bg-lantern-surface border border-lantern-border rounded-lantern-xl shadow-lantern">
            <DocumentTextIcon className="w-16 h-16 text-lantern-text-tertiary mx-auto mb-4" />
            <p className="text-lantern-text-secondary">
              You haven&apos;t downloaded any tests for offline use yet.
            </p>
            <p className="text-xs text-lantern-text-tertiary mt-1">
              Go to a group and configure a test to download questions.
            </p>
          </div>
        )}
      </section>
    </div>
  );
};

export default OfflineModeScreen;
