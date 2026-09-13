import React from 'react';
import type { ChatGalleryItem } from '@lantern/shared/chat';
import { ResolvedStorageImg } from '../ui/ResolvedStorageImg';
import Modal from '../ui/Modal';
import { AppIcon } from '../ui/AppIcon';

export function ChatGalleryModal({
  isOpen,
  onClose,
  items,
  onOpenItem,
}: {
  isOpen: boolean;
  onClose: () => void;
  items: ChatGalleryItem[];
  onOpenItem?: (id: string) => void;
}) {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      ariaLabelledBy="chat-gallery-title"
      maxWidthClass="max-w-lg"
    >
      <div className="p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 id="chat-gallery-title" className="text-base font-semibold text-lantern-text">
            Photos and voice
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[40px] min-w-[40px] rounded-lg text-lantern-text-tertiary hover:text-lantern-text"
            aria-label="Close"
          >
            <AppIcon name="close" size={18} />
          </button>
        </div>
        {items.length === 0 ? (
          <p className="text-sm text-lantern-text-secondary">No photos or voice notes in this chat yet.</p>
        ) : (
          <ul className="grid grid-cols-3 gap-2 max-h-80 overflow-y-auto">
            {items.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => {
                    onOpenItem?.(item.id);
                    onClose();
                  }}
                  className="w-full aspect-square rounded-lg overflow-hidden border border-lantern-border bg-lantern-background-secondary"
                  aria-label={item.kind === 'photo' ? 'Open photo' : 'Open voice note'}
                >
                  {item.kind === 'photo' ? (
                    <ResolvedStorageImg
                      src={item.url}
                      alt=""
                      variant="thumb"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <span className="flex h-full items-center justify-center text-lantern-primary">
                      <AppIcon name="mic" size={22} />
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}
