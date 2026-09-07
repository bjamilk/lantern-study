import React, { useState } from 'react';
import { useToastStore } from '../stores/toastStore';
import { AppIcon } from './ui/AppIcon';

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
      className={`rounded-lg border border-lantern-primary/30 dark:border-lantern-primary/30 bg-lantern-primary-background ${
        compact ? 'p-3 space-y-2' : 'p-4 space-y-3'
      }`}
    >
      <div className="flex items-center gap-2">
        <AppIcon name="link" size={16} className="text-lantern-primary shrink-0" />
        <h3 className="text-sm font-semibold text-lantern-primary-dark dark:text-lantern-primary-light">
          Invite link
        </h3>
      </div>
      <p className="text-xs text-lantern-primary-dark/80 dark:text-lantern-primary-light/80">
        Anyone with this link can request to join your group.
      </p>
      <div className="rounded-md border border-lantern-primary/20 dark:border-lantern-border bg-lantern-surface px-3 py-2 overflow-x-auto">
        <code
          className="block text-xs font-mono text-lantern-text whitespace-nowrap select-all"
          title={inviteLink}
        >
          {inviteLink}
        </code>
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void handleCopy()}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-white bg-lantern-primary hover:bg-lantern-primary-dark rounded-md"
        >
          {copied ? (
            <>
              <AppIcon name="checkmark" size={16} />
              Copied
            </>
          ) : (
            <>
              <AppIcon name="clipboard-copy" size={16} />
              Copy link
            </>
          )}
        </button>
        <button
          type="button"
          onClick={() => void handleShare()}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-lantern-primary dark:text-lantern-primary-light bg-lantern-surface hover:bg-lantern-primary-background dark:hover:bg-lantern-surface-secondary border border-lantern-primary/30 dark:border-lantern-border rounded-md"
        >
          <AppIcon name="share" size={16} />
          {canNativeShare ? 'Share' : 'Copy to share'}
        </button>
      </div>
    </div>
  );
};

export default GroupInviteLinkPanel;
