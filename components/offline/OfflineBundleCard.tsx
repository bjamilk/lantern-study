import React from 'react';
import { OfflineSessionBundle } from '../../types';
import { featureAccents } from '@lantern/shared/design';
import { AppIcon } from '../ui/AppIcon';

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
  onStartStudy: () => void;
  onDelete: () => void;
  /** Publish this bundle as a marketplace question bank (online only). */
  onPublish?: () => void;
  /** Marketplace purchase: shows the badge and disables export/sharing. */
  isPurchased?: boolean;
  /** A newer version of this purchased bank is published. */
  updateAvailable?: boolean;
  onUpdate?: () => void;
  updating?: boolean;
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
  onStartStudy,
  onDelete,
  onPublish,
  isPurchased = false,
  updateAvailable = false,
  onUpdate,
  updating = false,
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
            <AppIcon name="checkmark" size={20} />
          </button>
          <button type="button" onClick={onCancelEdit} className="p-1 text-lantern-text-tertiary" title="Cancel">
            <AppIcon name="close" size={20} />
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-2 mb-1">
          <p className="font-semibold text-lantern-text text-lg truncate">
            {bundle.displayName || bundle.groupName}
          </p>
          {isPurchased ? (
            <span className="shrink-0 px-1.5 py-0.5 rounded-full bg-lantern-primary/10 text-lantern-primary text-label font-bold uppercase tracking-wide">
              Purchased
            </span>
          ) : null}
          {bundle.displayName && bundle.displayName !== bundle.groupName ? (
            <span className="text-xs text-lantern-text-tertiary truncate">({bundle.groupName})</span>
          ) : null}
          <button
            type="button"
            onClick={onStartEdit}
            className="flex-shrink-0 p-1 text-lantern-text-tertiary hover:text-lantern-primary rounded"
            title="Rename bundle"
          >
            <AppIcon name="pencil" size={16} />
          </button>
        </div>
      )}
      <p className="text-xs text-lantern-text-secondary">
        {/* Tolerate partial configs (imported/marketplace bundles) — one bad
            bundle must not crash the whole Offline screen. */}
        {bundle.config?.numberOfQuestions ?? bundle.questions?.length ?? 0} questions · Downloaded{' '}
        {new Date(bundle.downloadedAt).toLocaleDateString()}
      </p>
      {Array.isArray(bundle.config?.allowedQuestionTypes) && bundle.config.allowedQuestionTypes.length > 0 ? (
        <p className="text-xs text-lantern-text-tertiary">
          Types: {bundle.config.allowedQuestionTypes.join(', ').replace(/_/g, ' ')}
          {bundle.config.selectedTags && bundle.config.selectedTags.length > 0
            ? ` · Tags: ${bundle.config.selectedTags.join(', ')}`
            : ''}
        </p>
      ) : null}
    </div>
    {/* Up to six actions (~490px). flex-shrink-0 without wrap ran them past
        the card edge on phones and half-width windows, hiding Start Test and
        Delete entirely — wrap instead of overflowing. */}
    <div className="flex flex-wrap gap-2 min-w-0">
      {updateAvailable && onUpdate ? (
        <button
          type="button"
          onClick={onUpdate}
          disabled={updating}
          className="px-3 py-2 min-h-[44px] bg-lantern-accent-background text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-700 rounded-lantern text-sm flex items-center transition-colors hover:border-amber-500 disabled:opacity-50"
          title="A newer version of this question bank is available"
        >
          <AppIcon name="refresh" size={16} className={`mr-1.5 ${updating ? 'animate-spin' : ''}`} />
          {updating ? 'Updating…' : 'Update'}
        </button>
      ) : null}
      {onPublish ? (
        <button
          type="button"
          onClick={onPublish}
          className="p-2 min-w-[44px] min-h-[44px] flex items-center justify-center text-lantern-text-secondary hover:text-lantern-primary hover:bg-lantern-primary-background rounded-lantern transition-colors"
          title="Publish to marketplace"
        >
          <AppIcon name="storefront" size={20} />
        </button>
      ) : null}
      {/* Purchased banks are someone else's product — no export/re-sharing. */}
      {!isPurchased ? (
        <button
          type="button"
          onClick={onExport}
          className="p-2 min-w-[44px] min-h-[44px] flex items-center justify-center text-lantern-text-secondary hover:text-lantern-primary hover:bg-lantern-primary-background rounded-lantern transition-colors"
          title="Export bundle"
        >
          <AppIcon name="download" size={20} />
        </button>
      ) : null}
      <button
        type="button"
        onClick={onStartStudy}
        className="px-3 py-2 min-h-[44px] border border-lantern-primary text-lantern-primary hover:bg-lantern-primary-background rounded-lantern text-sm flex items-center transition-colors"
        title="Study these questions without scoring"
      >
        <AppIcon name="book-open" size={16} className="mr-1.5" />
        Study
      </button>
      <button
        type="button"
        onClick={onStartTest}
        className="px-3 py-2 min-h-[44px] bg-lantern-primary hover:bg-lantern-primary-dark text-white rounded-lantern text-sm flex items-center transition-colors"
        title="Start offline test"
      >
        <AppIcon name="play" size={16} className="mr-1.5" />
        Start Test
      </button>
      <button
        type="button"
        onClick={onDelete}
        className="p-2 min-w-[44px] min-h-[44px] flex items-center justify-center text-lantern-error hover:bg-lantern-error/10 rounded-lantern transition-colors"
        title="Delete bundle"
      >
        <AppIcon name="trash" size={20} />
      </button>
    </div>
  </div>
);

export default OfflineBundleCard;
