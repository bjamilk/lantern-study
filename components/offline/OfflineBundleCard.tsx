import React from 'react';
import { OfflineSessionBundle } from '../../types';
import {
  ArrowDownTrayIcon,
  PlayIcon,
  TrashIcon,
  PencilIcon,
  CheckIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { featureAccents } from '@lantern/shared/design';

interface OfflineBundleCardProps {
  bundle: OfflineSessionBundle;
  isEditing: boolean;
  editNameValue: string;
  onEditNameChange: (v: string) => void;
  onStartEdit: () => void;
  onCommitRename: () => void;
  onCancelEdit: () => void;
  onExport: () => void;
  onStartTest: () => void;
  onDelete: () => void;
}

export const OfflineBundleCard: React.FC<OfflineBundleCardProps> = ({
  bundle,
  isEditing,
  editNameValue,
  onEditNameChange,
  onStartEdit,
  onCommitRename,
  onCancelEdit,
  onExport,
  onStartTest,
  onDelete,
}) => (
  <div
    className="bg-lantern-surface border border-lantern-border rounded-lantern-xl shadow-lantern p-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 transition-shadow duration-200 hover:shadow-lantern-md"
    style={{ borderLeftWidth: 3, borderLeftColor: featureAccents.offline }}
  >
    <div className="flex-1 min-w-0 mr-0 sm:mr-4">
      {isEditing ? (
        <div className="flex items-center gap-2 mb-1">
          <input
            type="text"
            value={editNameValue}
            onChange={e => onEditNameChange(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') onCommitRename();
              if (e.key === 'Escape') onCancelEdit();
            }}
            autoFocus
            className="flex-1 min-w-0 px-2 py-1 text-base font-semibold border border-lantern-border rounded-lantern bg-lantern-background text-lantern-text focus:outline-none focus:ring-2 focus:ring-lantern-primary"
          />
          <button type="button" onClick={onCommitRename} className="p-1 text-lantern-success" title="Save name">
            <CheckIcon className="w-5 h-5" />
          </button>
          <button type="button" onClick={onCancelEdit} className="p-1 text-lantern-text-tertiary" title="Cancel">
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-2 mb-1">
          <p className="font-semibold text-lantern-text text-lg truncate">
            {bundle.displayName || bundle.groupName}
          </p>
          {bundle.displayName && bundle.displayName !== bundle.groupName ? (
            <span className="text-xs text-lantern-text-tertiary truncate">({bundle.groupName})</span>
          ) : null}
          <button
            type="button"
            onClick={onStartEdit}
            className="flex-shrink-0 p-1 text-lantern-text-tertiary hover:text-lantern-primary rounded"
            title="Rename bundle"
          >
            <PencilIcon className="w-4 h-4" />
          </button>
        </div>
      )}
      <p className="text-xs text-lantern-text-secondary">
        {bundle.config.numberOfQuestions} questions · Downloaded{' '}
        {new Date(bundle.downloadedAt).toLocaleDateString()}
      </p>
      <p className="text-xs text-lantern-text-tertiary">
        Types: {bundle.config.allowedQuestionTypes.join(', ').replace(/_/g, ' ')}
        {bundle.config.selectedTags && bundle.config.selectedTags.length > 0
          ? ` · Tags: ${bundle.config.selectedTags.join(', ')}`
          : ''}
      </p>
    </div>
    <div className="flex space-x-2 flex-shrink-0">
      <button
        type="button"
        onClick={onExport}
        className="p-2 min-w-[44px] min-h-[44px] flex items-center justify-center text-lantern-text-secondary hover:text-lantern-primary hover:bg-lantern-primary-background rounded-lantern transition-colors"
        title="Export bundle"
      >
        <ArrowDownTrayIcon className="w-5 h-5" />
      </button>
      <button
        type="button"
        onClick={onStartTest}
        className="px-3 py-2 min-h-[44px] bg-lantern-primary hover:bg-lantern-primary-dark text-white rounded-lantern text-sm flex items-center transition-colors"
        title="Start offline test"
      >
        <PlayIcon className="w-4 h-4 mr-1.5" />
        Start Test
      </button>
      <button
        type="button"
        onClick={onDelete}
        className="p-2 min-w-[44px] min-h-[44px] flex items-center justify-center text-lantern-error hover:bg-lantern-error/10 rounded-lantern transition-colors"
        title="Delete bundle"
      >
        <TrashIcon className="w-5 h-5" />
      </button>
    </div>
  </div>
);

export default OfflineBundleCard;
