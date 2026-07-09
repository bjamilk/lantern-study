import React, { useState } from 'react';
import {
  ClipboardDocumentIcon,
  ArrowUpOnSquareIcon,
  CheckIcon,
  LinkIcon,
} from '@heroicons/react/24/outline';
import { useToastStore } from '../stores/toastStore';

interface GroupInviteLinkPanelProps {
  inviteLink: string;
  groupName?: string;
  /** Smaller padding and text for modals with limited space */
  compact?: boolean;
}

const GroupInviteLinkPanel: React.FC<GroupInviteLinkPanelProps> = ({
  inviteLink,
  groupName,
  compact = false,
}) => {
  const [copied, setCopied] = useState(false);
  const canNativeShare = typeof navigator !== 'undefined' && Boolean(navigator.share);

  const handleCopy = async () => {
    if (!inviteLink) return;
    try {
      await navigator.clipboard.writeText(inviteLink);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy invite link:', err);
      useToastStore.getState().showToast('Failed to copy link.', 'error');
    }
  };

  const handleShare = async () => {
    if (!inviteLink) return;
    const shareText = groupName
      ? `Join my study group "${groupName}" on Lantern Study!\n\n${inviteLink}`
      : `Join my study group on Lantern Study!\n\n${inviteLink}`;

    if (canNativeShare) {
      try {
        await navigator.share({
          title: groupName ? `Join ${groupName}` : 'Lantern Study group invite',
          text: shareText,
          url: inviteLink,
        });
        return;
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return;
        console.error('Native share failed:', err);
      }
    }

    await handleCopy();
  };

  return (
    <div
      className={`rounded-lg border border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-900/20 ${
        compact ? 'p-3 space-y-2' : 'p-4 space-y-3'
      }`}
    >
      <div className="flex items-center gap-2">
        <LinkIcon className="w-4 h-4 text-indigo-700 dark:text-indigo-300 shrink-0" />
        <h3 className="text-sm font-semibold text-indigo-900 dark:text-indigo-200">
          Invite link
        </h3>
      </div>
      <p className="text-xs text-indigo-800/80 dark:text-indigo-200/80">
        Anyone with this link can request to join your group.
      </p>
      <div className="rounded-md border border-indigo-100 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 overflow-x-auto">
        <code
          className="block text-xs font-mono text-slate-700 dark:text-slate-200 whitespace-nowrap select-all"
          title={inviteLink}
        >
          {inviteLink}
        </code>
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void handleCopy()}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-md"
        >
          {copied ? (
            <>
              <CheckIcon className="w-4 h-4" />
              Copied
            </>
          ) : (
            <>
              <ClipboardDocumentIcon className="w-4 h-4" />
              Copy link
            </>
          )}
        </button>
        <button
          type="button"
          onClick={() => void handleShare()}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-indigo-700 dark:text-indigo-200 bg-white dark:bg-slate-800 hover:bg-indigo-100 dark:hover:bg-slate-700 border border-indigo-200 dark:border-slate-600 rounded-md"
        >
          <ArrowUpOnSquareIcon className="w-4 h-4" />
          {canNativeShare ? 'Share' : 'Copy to share'}
        </button>
      </div>
    </div>
  );
};

export default GroupInviteLinkPanel;
