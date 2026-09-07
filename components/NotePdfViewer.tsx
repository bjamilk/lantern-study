import React, { useEffect, useRef, useState } from 'react';
import type { NoteAttachment } from '../types';
import { fetchNoteAttachmentContent } from '../services/notes';
import { useModalFocusTrap } from '../hooks/useModalFocusTrap';
import { AppIcon } from './ui/AppIcon';

const PDFJS_VERSION = '4.10.38';

interface NotePdfViewerProps {
  noteId: string;
  attachment: NoteAttachment;
  theme?: 'light' | 'dark';
  className?: string;
}

const NotePdfViewer: React.FC<NotePdfViewerProps> = ({
  noteId,
  attachment,
  theme = 'light',
  className = '',
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const blobUrlRef = useRef<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [openUrl, setOpenUrl] = useState<string | null>(null);
  // Fullscreen swaps wrapper classes only. The rendered canvases live in
  // containerRef's div, appended imperatively — remounting that div (e.g. by
  // rendering a separate fullscreen tree) would silently drop every page.
  const [isFullscreen, setIsFullscreen] = useState(false);
  const trapRef = useModalFocusTrap(isFullscreen, () => setIsFullscreen(false));
  const isDark = theme === 'dark';

  useEffect(() => {
    if (!isFullscreen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [isFullscreen]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const buffer = await fetchNoteAttachmentContent(noteId, attachment.id);
        if (cancelled) return;

        const blob = new Blob([buffer], { type: 'application/pdf' });
        const blobUrl = URL.createObjectURL(blob);
        blobUrlRef.current = blobUrl;
        setOpenUrl(blobUrl);

        const pdfjs = await import('pdfjs-dist');
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(
          'pdfjs-dist/build/pdf.worker.min.mjs',
          import.meta.url
        ).toString();

        const pdf = await pdfjs.getDocument({
          data: buffer,
          standardFontDataUrl: `https://unpkg.com/pdfjs-dist@${PDFJS_VERSION}/standard_fonts/`,
          cMapUrl: `https://unpkg.com/pdfjs-dist@${PDFJS_VERSION}/cmaps/`,
          cMapPacked: true,
        }).promise;
        if (cancelled) return;
        setNumPages(pdf.numPages);

        const container = containerRef.current;
        if (!container) return;
        container.innerHTML = '';

        for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
          const page = await pdf.getPage(pageNum);
          if (cancelled) return;
          const viewport = page.getViewport({ scale: 1.25 });
          const canvas = document.createElement('canvas');
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          canvas.className = 'w-full h-auto mb-3 rounded-lg shadow-sm';
          const context = canvas.getContext('2d');
          if (!context) continue;
          await page.render({ canvasContext: context, viewport, canvas }).promise;
          container.appendChild(canvas);
        }
      } catch (err: unknown) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load PDF');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }
    };
  }, [noteId, attachment.id]);

  return (
    <div
      ref={trapRef}
      role={isFullscreen ? 'dialog' : undefined}
      aria-modal={isFullscreen || undefined}
      aria-label={isFullscreen ? attachment.fileName || 'Document' : undefined}
      className={
        isFullscreen
          ? // !m-0: the editor stacks attachments with space-y utilities, whose
            // margin-top still applies once this element goes position:fixed and
            // would push the overlay 12px below the top of the screen.
            'fixed inset-0 z-50 !m-0 flex flex-col bg-lantern-background'
          : `rounded-xl border overflow-hidden ${isDark ? 'border-lantern-border bg-lantern-surface' : 'border-lantern-border bg-lantern-surface'} ${className}`
      }
    >
      <div
        className={`flex items-center justify-between gap-2 px-3 py-2 border-b text-sm border-lantern-border text-lantern-text ${isFullscreen ? 'bg-lantern-surface' : ''}`}
      >
        <span className="font-medium truncate">
          {attachment.fileName || 'Document'}
        </span>
        <span className="flex items-center gap-1 shrink-0">
          {numPages > 0 && (
            <span className="text-xs text-lantern-text-tertiary mr-1">{numPages} pages</span>
          )}
          <button
            type="button"
            onClick={() => setIsFullscreen((v) => !v)}
            className="p-1.5 rounded-lg hover:bg-lantern-background-secondary text-lantern-text-secondary"
            aria-label={isFullscreen ? 'Exit fullscreen' : 'View fullscreen'}
            title={isFullscreen ? 'Exit fullscreen' : 'View fullscreen'}
          >
            {isFullscreen ? (
              <AppIcon name="contract" size={16} />
            ) : (
              <AppIcon name="expand" size={16} />
            )}
          </button>
          {isFullscreen && (
            <button
              type="button"
              onClick={() => setIsFullscreen(false)}
              className="p-1.5 rounded-lg hover:bg-lantern-background-secondary text-lantern-text-secondary"
              aria-label="Close fullscreen"
              title="Close"
            >
              <AppIcon name="close" size={16} />
            </button>
          )}
        </span>
      </div>
      <div
        className={
          isFullscreen
            ? 'flex-1 overflow-y-auto p-4'
            : 'max-h-[min(70vh,720px)] overflow-y-auto p-3'
        }
      >
        {loading && <p className="text-sm text-lantern-text-tertiary py-8 text-center">Loading document...</p>}
        {error && (
          <div className="text-sm text-center py-6 space-y-2">
            <p className="text-red-500">{error}</p>
            {openUrl && (
              <a
                href={openUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-lantern-primary underline"
              >
                Open PDF in new tab
              </a>
            )}
          </div>
        )}
        <div ref={containerRef} className={isFullscreen ? 'mx-auto w-full max-w-3xl' : undefined} />
      </div>
    </div>
  );
};

export default NotePdfViewer;
