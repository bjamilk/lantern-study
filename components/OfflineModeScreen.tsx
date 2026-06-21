
import React, { useRef, useState } from 'react';
import { OfflineSessionBundle } from '../types';
import { CloudArrowDownIcon, ArrowPathIcon, TrashIcon, PlayIcon, DocumentTextIcon, ArrowDownTrayIcon, ArrowUpTrayIcon, PencilIcon, CheckIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { syncCopy } from '@lantern/shared/design';
import { useUIStore } from '../stores/uiStore';

interface OfflineModeScreenProps {
  offlineBundles: OfflineSessionBundle[];
  pendingSyncResultsCount: number;
  onStartOfflineSession: (bundleId: string, mode: 'test' | 'study') => void;
  onDeleteBundle: (bundleId: string) => void;
  onSyncPendingResults: () => void;
  onImportBundle: (bundle: OfflineSessionBundle) => string | null;
  onRenameBundle: (bundleId: string, newName: string) => void;
  isOnline: boolean;
}

const OfflineModeScreen: React.FC<OfflineModeScreenProps> = ({
  offlineBundles,
  pendingSyncResultsCount,
  onStartOfflineSession,
  onDeleteBundle,
  onSyncPendingResults,
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
          alert('Invalid bundle file. Please use a file exported from Lantern Study.');
          return;
        }
        const newBundleId = onImportBundle(parsed as OfflineSessionBundle);
        if (newBundleId) {
          setEditingBundleId(newBundleId);
          setEditNameValue(parsed.groupName);
        }
      } catch {
        alert('Could not read the file. Make sure it is a valid Lantern bundle (.json).');
      } finally {
        // Reset so the same file can be re-imported if needed
        if (importInputRef.current) importInputRef.current.value = '';
      }
    };
    reader.readAsText(file);
  };
  return (
    <div className="flex-1 flex flex-col p-4 md:p-6 bg-lantern-background text-lantern-text overflow-y-auto">
      {lowDataMode && (
        <div className="mb-4 flex items-start gap-3 p-3 bg-lantern-accent-background border border-amber-200 dark:border-amber-700 rounded-lantern text-sm text-amber-800 dark:text-amber-300">
          <span className="font-semibold whitespace-nowrap">Low-Data Mode</span>
          <span>Download bundles below to study offline. {syncCopy.savedLocally}</span>
        </div>
      )}
      <div className="mb-6 pb-4 border-b border-lantern-border">
        <div className="flex items-center justify-between">
          <div className="flex items-center text-2xl md:text-3xl font-semibold text-lantern-primary">
            <CloudArrowDownIcon className="w-8 h-8 mr-3" />
            Offline Activity
          </div>
          <div className="flex items-center gap-2">
            <input
              ref={importInputRef}
              type="file"
              accept=".json"
              className="hidden"
              onChange={handleFileImport}
            />
            <button
              onClick={() => importInputRef.current?.click()}
              className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-600 text-white rounded-lg text-sm font-medium transition-colors"
              title="Import a shared bundle file (.json)"
            >
              <ArrowUpTrayIcon className="w-4 h-4" />
              Import Bundle
            </button>
          </div>
        </div>
      </div>

      {/* Pending Sync Section */}
      <section className="mb-8">
        <h2 className="text-xl font-semibold mb-3 text-gray-700 dark:text-gray-300">Sync Status</h2>
        <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow-md">
          {pendingSyncResultsCount > 0 ? (
            <div className="flex flex-col sm:flex-row justify-between items-center">
              <p className="text-yellow-600 dark:text-yellow-400 mb-2 sm:mb-0">
                You have {pendingSyncResultsCount} test result(s) pending synchronization.
              </p>
              <button
                onClick={onSyncPendingResults}
                disabled={!isOnline}
                className="px-4 py-2 bg-green-600 hover:bg-green-700 dark:bg-green-500 dark:hover:bg-green-600 text-white rounded-md focus:ring-2 focus:ring-green-400 dark:focus:ring-green-500 focus:ring-offset-2 flex items-center text-sm disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <ArrowPathIcon className="w-5 h-5 mr-2" />
                Sync Now
              </button>
            </div>
          ) : (
            <p className="text-green-600 dark:text-green-400">All offline results are synced!</p>
          )}
          {!isOnline && pendingSyncResultsCount > 0 && (
            <p className="text-xs text-red-500 dark:text-red-400 mt-2">
              Connect to the internet to sync your pending results.
            </p>
          )}
        </div>
      </section>

      {/* Downloaded Test Bundles Section */}
      <section>
        <h2 className="text-xl font-semibold mb-3 text-gray-700 dark:text-gray-300">Downloaded Test Bundles</h2>
        {offlineBundles.length > 0 ? (
          <div className="space-y-4">
            {offlineBundles.map(bundle => (
              <div key={bundle.bundleId} className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow-md flex flex-col sm:flex-row justify-between items-start sm:items-center">
                <div className="mb-3 sm:mb-0 flex-1 min-w-0 mr-4">
                  {editingBundleId === bundle.bundleId ? (
                    <div className="flex items-center gap-2 mb-1">
                      <input
                        type="text"
                        value={editNameValue}
                        onChange={e => setEditNameValue(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') commitRename(bundle.bundleId); if (e.key === 'Escape') cancelEditing(); }}
                        autoFocus
                        className="flex-1 min-w-0 px-2 py-1 text-base font-semibold border border-indigo-400 rounded bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                      <button onClick={() => commitRename(bundle.bundleId)} className="p-1 text-green-600 hover:text-green-700 dark:text-green-400" title="Save name"><CheckIcon className="w-5 h-5" /></button>
                      <button onClick={cancelEditing} className="p-1 text-gray-500 hover:text-gray-700 dark:text-gray-400" title="Cancel"><XMarkIcon className="w-5 h-5" /></button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 mb-1">
                      <p className="font-semibold text-gray-800 dark:text-gray-100 text-lg truncate">
                        {bundle.displayName || bundle.groupName}
                      </p>
                      {bundle.displayName && bundle.displayName !== bundle.groupName && (
                        <span className="text-xs text-gray-400 dark:text-gray-500 truncate">({bundle.groupName})</span>
                      )}
                      <button onClick={() => startEditing(bundle)} className="flex-shrink-0 p-1 text-gray-400 hover:text-indigo-500 dark:hover:text-indigo-400 rounded" title="Rename bundle"><PencilIcon className="w-4 h-4" /></button>
                    </div>
                  )}
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {bundle.config.numberOfQuestions} questions | Downloaded: {new Date(bundle.downloadedAt).toLocaleDateString()}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    Types: {bundle.config.allowedQuestionTypes.join(', ').replace(/_/g, ' ')}
                    {bundle.config.selectedTags && bundle.config.selectedTags.length > 0 && ` | Tags: ${bundle.config.selectedTags.join(', ')}`}
                  </p>
                </div>
                <div className="flex space-x-2 flex-shrink-0">
                  <button
                    onClick={() => handleExportBundle(bundle)}
                    className="p-2 text-slate-500 hover:text-indigo-600 dark:text-slate-400 dark:hover:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 rounded-md"
                    title="Export bundle as file to share"
                  >
                    <ArrowDownTrayIcon className="w-5 h-5" />
                  </button>
                  <button
                    onClick={() => { console.log('[OfflineModeScreen] button start', bundle.bundleId); onStartOfflineSession(bundle.bundleId, 'test'); }}
                    className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600 text-white rounded-md text-sm flex items-center"
                    title="Start Offline Test"
                  >
                    <PlayIcon className="w-4 h-4 mr-1.5" /> Start Test
                  </button>
                  <button
                    onClick={() => onDeleteBundle(bundle.bundleId)}
                    className="p-2 text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 hover:bg-red-100 dark:hover:bg-red-700/50 rounded-md"
                    title="Delete Bundle"
                  >
                    <TrashIcon className="w-5 h-5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-10 bg-white dark:bg-gray-800 rounded-lg shadow">
            <DocumentTextIcon className="w-16 h-16 text-gray-300 dark:text-gray-600 mx-auto mb-4" />
            <p className="text-gray-500 dark:text-gray-400">
              You haven't downloaded any tests for offline use yet.
            </p>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
              Go to a group and configure a test to download questions.
            </p>
          </div>
        )}
      </section>
    </div>
  );
};

export default OfflineModeScreen;