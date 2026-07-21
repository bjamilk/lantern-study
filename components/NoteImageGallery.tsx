import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowDownIcon,
  ArrowUpIcon,
  MagnifyingGlassMinusIcon,
  MagnifyingGlassPlusIcon,
  PencilSquareIcon,
  PhotoIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import type { NoteAttachment } from '../types';
import { refreshNoteAttachmentUrl, reorderNoteAttachments } from '../services/notes';
import { useModalFocusTrap } from '../hooks/useModalFocusTrap';
import { Button } from './ui';

interface NoteImageGalleryProps {
  noteId: string;
  attachments: NoteAttachment[];
  theme?: 'light' | 'dark';
  editable?: boolean;
  onAttachmentsChange?: (attachments: NoteAttachment[]) => void;
  onAddPhotos?: () => void;
  className?: string;
}

function sortOrderValue(attachment: NoteAttachment): number {
  return typeof attachment.metadata?.sortOrder === 'number' ? attachment.metadata.sortOrder : 0;
}

const NoteImageGallery: React.FC<NoteImageGalleryProps> = ({
  noteId,
  attachments,
  theme = 'light',
  editable = false,
  onAttachmentsChange,
  onAddPhotos,
  className = '',
}) => {
  const isDark = theme === 'dark';
  const [ordered, setOrdered] = useState<NoteAttachment[]>([]);
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [reordering, setReordering] = useState(false);
  const [zoomIndex, setZoomIndex] = useState<number | null>(null);
  const [zoomScale, setZoomScale] = useState(1);
  const zoomContainerRef = useRef<HTMLDivElement>(null);
  const lightboxOpen = zoomIndex !== null;
  const lightboxRef = useModalFocusTrap(lightboxOpen, () => {
    setZoomIndex(null);
    setZoomScale(1);
  });

  useEffect(() => {
    setOrdered(
      [...attachments]
        .filter((a) => a.type === 'image')
        .sort((a, b) => sortOrderValue(a) - sortOrderValue(b))
    );
  }, [attachments]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setImageUrls({});

    (async () => {
      try {
        const entries = await Promise.all(
          ordered.map(async (attachment) => {
            const result = await refreshNoteAttachmentUrl(noteId, attachment.id);
            return [attachment.id, result.url] as const;
          })
        );
        if (cancelled) return;
        setImageUrls(Object.fromEntries(entries));
      } catch (err: unknown) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load photos');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [noteId, ordered]);

  const persistOrder = useCallback(
    async (next: NoteAttachment[]) => {
      setReordering(true);
      try {
        const result = await reorderNoteAttachments(
          noteId,
          next.map((attachment) => attachment.id)
        );
        const sorted = [...result.attachments].sort(
          (a, b) => sortOrderValue(a) - sortOrderValue(b)
        );
        setOrdered(sorted);
        onAttachmentsChange?.(sorted);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Failed to reorder photos');
      } finally {
        setReordering(false);
      }
    },
    [noteId, onAttachmentsChange]
  );

  const moveImage = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= ordered.length) return;
    const next = [...ordered];
    const [item] = next.splice(index, 1);
    next.splice(target, 0, item);
    setOrdered(next);
    void persistOrder(next);
  };

  const openZoom = (index: number) => {
    setZoomIndex(index);
    setZoomScale(1);
  };

  const closeZoom = () => {
    setZoomIndex(null);
    setZoomScale(1);
  };

  useEffect(() => {
    if (zoomIndex === null) return;
    const container = zoomContainerRef.current;
    if (!container) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      setZoomScale((scale) => Math.min(4, Math.max(0.5, scale + (event.deltaY < 0 ? 0.12 : -0.12))));
    };
    container.addEventListener('wheel', onWheel, { passive: false });
    return () => container.removeEventListener('wheel', onWheel);
  }, [zoomIndex]);

  return (
    <div
      className={`rounded-xl border overflow-hidden ${
        isDark ? 'border-lantern-border bg-lantern-surface' : 'border-lantern-border bg-lantern-surface'
      } ${className}`}
    >
      <div
        className={`flex items-center justify-between gap-2 px-3 py-2 border-b text-sm ${
          isDark ? 'border-lantern-border text-lantern-text' : 'border-lantern-border text-lantern-text'
        }`}
      >
        <span className="font-medium truncate flex items-center gap-2">
          <PhotoIcon className="w-4 h-4 shrink-0" />
          {ordered.length === 1 ? '1 photo' : `${ordered.length} photos`}
        </span>
        <div className="flex items-center gap-2 shrink-0">
          {editable && ordered.length > 1 && (
            <button
              type="button"
              onClick={() => setEditMode((value) => !value)}
              className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md border ${
                editMode
                  ? 'border-lantern-primary text-lantern-primary bg-lantern-primary-background'
                  : 'border-lantern-border text-lantern-text-secondary hover:bg-lantern-background-secondary'
              }`}
            >
              <PencilSquareIcon className="w-3.5 h-3.5" />
              {editMode ? 'Done' : 'Reorder'}
            </button>
          )}
          {editable && onAddPhotos && (
            <Button size="sm" variant="secondary" onClick={onAddPhotos}>
              Add photos
            </Button>
          )}
        </div>
      </div>

      <div className="max-h-[min(70vh,720px)] overflow-y-auto p-3 space-y-3">
        {loading && (
          <p className="text-sm text-lantern-text-tertiary py-8 text-center">Loading photos...</p>
        )}
        {error && !loading && (
          <p className="text-sm text-red-500 py-6 text-center">{error}</p>
        )}
        {!loading &&
          ordered.map((attachment, index) => (
            <div key={attachment.id} className="relative">
              {editMode && (
                <div className="absolute top-2 right-2 z-10 flex flex-col gap-1">
                  <button
                    type="button"
                    disabled={index === 0 || reordering}
                    onClick={() => moveImage(index, -1)}
                    className="p-1.5 rounded-md bg-black/55 text-white disabled:opacity-40"
                    aria-label="Move up"
                  >
                    <ArrowUpIcon className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    disabled={index === ordered.length - 1 || reordering}
                    onClick={() => moveImage(index, 1)}
                    className="p-1.5 rounded-md bg-black/55 text-white disabled:opacity-40"
                    aria-label="Move down"
                  >
                    <ArrowDownIcon className="w-4 h-4" />
                  </button>
                </div>
              )}
              <button
                type="button"
                onClick={() => !editMode && openZoom(index)}
                className={`block w-full overflow-hidden rounded-lg ${
                  editMode ? 'cursor-default' : 'cursor-zoom-in'
                }`}
              >
                {imageUrls[attachment.id] ? (
                  <img
                    src={imageUrls[attachment.id]}
                    alt={attachment.fileName || `Photo ${index + 1}`}
                    className="w-full h-auto"
                    loading="lazy"
                  />
                ) : (
                  <div className="h-40 bg-lantern-background-secondary animate-pulse" />
                )}
              </button>
              {attachment.fileName && (
                <p className="text-xs text-lantern-text-tertiary mt-1 truncate">{attachment.fileName}</p>
              )}
            </div>
          ))}
      </div>

      {zoomIndex !== null && imageUrls[ordered[zoomIndex]?.id] && (
        <div
          ref={lightboxRef}
          className="fixed inset-0 z-50 bg-black/90 flex flex-col"
          role="dialog"
          aria-modal="true"
          aria-label="Photo zoom"
        >
          <div className="flex items-center justify-between px-4 py-3 text-white">
            <span className="text-sm truncate">
              {ordered[zoomIndex]?.fileName || `Photo ${zoomIndex + 1}`}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setZoomScale((scale) => Math.max(0.5, scale - 0.25))}
                className="p-2 rounded-md bg-white/10"
                aria-label="Zoom out"
              >
                <MagnifyingGlassMinusIcon className="w-5 h-5" />
              </button>
              <span className="text-xs w-12 text-center">{Math.round(zoomScale * 100)}%</span>
              <button
                type="button"
                onClick={() => setZoomScale((scale) => Math.min(4, scale + 0.25))}
                className="p-2 rounded-md bg-white/10"
                aria-label="Zoom in"
              >
                <MagnifyingGlassPlusIcon className="w-5 h-5" />
              </button>
              <button
                type="button"
                onClick={closeZoom}
                className="p-2 rounded-md bg-white/10"
                aria-label="Close"
              >
                <XMarkIcon className="w-5 h-5" />
              </button>
            </div>
          </div>
          <div
            ref={zoomContainerRef}
            className="flex-1 overflow-auto flex items-center justify-center p-4"
            onClick={closeZoom}
          >
            <img
              src={imageUrls[ordered[zoomIndex].id]}
              alt={ordered[zoomIndex]?.fileName || `Photo ${zoomIndex + 1}`}
              style={{ transform: `scale(${zoomScale})` }}
              className="max-w-full max-h-full object-contain transition-transform duration-150"
              onClick={(event) => event.stopPropagation()}
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default NoteImageGallery;
