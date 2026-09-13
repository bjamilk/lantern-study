/**
 * The photos waiting on the next question, as removable chips.
 *
 * Each chip carries the thumbnail AND the word count, because those are two
 * different facts: the thumbnail says which picture is attached, the count says
 * how much of it the companion can actually use.
 */
import React from 'react';
import type { CompanionImageAttachment } from '../../types';
import { AppIcon } from '../ui/AppIcon';
import { describeImageAttachment } from './imageAttach';

interface ImageAttachmentChipsProps {
  images: CompanionImageAttachment[];
  onRemove: (attachmentId: string) => void;
  theme?: 'light' | 'dark';
  disabled?: boolean;
}

export const ImageAttachmentChips: React.FC<ImageAttachmentChipsProps> = ({
  images,
  onRemove,
  theme = 'light',
  disabled = false,
}) => {
  if (images.length === 0) return null;

  return (
    <div className="mb-2 flex flex-wrap items-center gap-2" data-testid="companion-image-chips">
      {images.map((image) => (
        <span
          key={image.attachmentId}
          className={`inline-flex items-center gap-2 rounded-lg border pl-1 pr-1.5 py-1 text-caption
            ${theme === 'dark'
              ? 'border-lantern-border bg-lantern-surface-secondary text-white'
              : 'border-lantern-border bg-lantern-surface text-lantern-text'}`}
        >
          <img
            src={image.url}
            alt=""
            className="h-7 w-7 rounded object-cover flex-shrink-0"
            loading="lazy"
          />
          <span className="max-w-[11rem] truncate" title={image.fileName}>
            {describeImageAttachment(image.wordCount)}
          </span>
          <button
            type="button"
            onClick={() => onRemove(image.attachmentId)}
            disabled={disabled}
            aria-label={`Remove ${image.fileName}`}
            title="Remove image"
            className="flex h-5 w-5 items-center justify-center rounded text-lantern-text-tertiary hover:text-lantern-text disabled:opacity-40"
          >
            <AppIcon name="close" size={12} />
          </button>
        </span>
      ))}
    </div>
  );
};

export default ImageAttachmentChips;
