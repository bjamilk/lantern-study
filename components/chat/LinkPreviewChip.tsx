import React from 'react';
import { firstLinkPreviewUrl, linkPreviewHostname } from '@lantern/shared/chat';
import { AppIcon } from '../ui/AppIcon';

export function LinkPreviewChip({
  text,
  onPrimary,
}: {
  text?: string | null;
  onPrimary?: boolean;
}) {
  const url = firstLinkPreviewUrl(text);
  if (!url) return null;
  const host = linkPreviewHostname(url);
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={`mt-2 flex items-center gap-2 rounded-lg border px-2.5 py-2 text-caption ${
        onPrimary
          ? 'border-white/30 bg-white/10 text-white'
          : 'border-lantern-border bg-lantern-background-secondary text-lantern-text'
      }`}
    >
      <AppIcon name="link" size={14} className="shrink-0 opacity-80" />
      <span className="min-w-0">
        <span className="block truncate font-semibold">{host}</span>
        <span className={`block truncate ${onPrimary ? 'text-white/70' : 'text-lantern-text-tertiary'}`}>
          {url}
        </span>
      </span>
    </a>
  );
}
