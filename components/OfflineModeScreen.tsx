
import React from 'react';
import { OfflineSessionBundle } from '../types';
import { CloudArrowDownIcon, ArrowPathIcon, TrashIcon, PlayIcon, DocumentTextIcon } from '@heroicons/react/24/outline';
import { useUIStore } from '../stores/uiStore';

interface OfflineModeScreenProps {
  offlineBundles: OfflineSessionBundle[];
  pendingSyncResultsCount: number;
  onStartOfflineSession: (bundleId: string, mode: 'test' | 'study') => void; // Assuming test for now
  onDeleteBundle: (bundleId: string) => void;
  onSyncPendingResults: () => void;
  isOnline: boolean;
}

const OfflineModeScreen: React.FC<OfflineModeScreenProps> = ({
  offlineBundles,
  pendingSyncResultsCount,
  onStartOfflineSession,
  onDeleteBundle,
  onSyncPendingResults,
  isOnline,
}) => {
  const { lowDataMode } = useUIStore();
  return (
    <div className="flex-1 flex flex-col p-4 md:p-6 bg-gray-100 dark:bg-slate-900 text-gray-800 dark:text-gray-200 overflow-y-auto">
      {lowDataMode && (
        <div className="mb-4 flex items-start gap-3 p-3 bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-700 rounded-lg text-sm text-amber-800 dark:text-amber-300">
          <span className="font-semibold whitespace-nowrap">Low-Data Mode On</span>
          <span>Real-time updates and performance charts are disabled to minimize data use. Download bundles below to study offline.</span>
        </div>
      )}
      <div className="mb-6 pb-4 border-b border-gray-300 dark:border-gray-700">
        <div className="flex items-center text-2xl md:text-3xl font-semibold text-purple-600 dark:text-purple-400">
          <CloudArrowDownIcon className="w-8 h-8 mr-3" />
          Offline Activity
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
                <div className="mb-3 sm:mb-0">
                  <p className="font-semibold text-gray-800 dark:text-gray-100 text-lg">{bundle.groupName}</p>
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