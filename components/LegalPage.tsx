import React, { useEffect } from 'react';
import {
  LEGAL_DOCUMENT_TITLES,
  LEGAL_PATHS,
  getLegalDocumentContent,
  type LegalDocumentId,
} from '@lantern/shared';
import { MarkdownRenderer } from '@lantern/shared';

const PATH_TO_DOC: Record<string, LegalDocumentId> = {
  [LEGAL_PATHS.privacy]: 'privacy',
  [LEGAL_PATHS.terms]: 'terms',
  [LEGAL_PATHS.cookies]: 'cookies',
};

export function getLegalDocFromPathname(pathname: string): LegalDocumentId | null {
  const normalized = pathname.replace(/\/$/, '') || '/';
  return PATH_TO_DOC[normalized] ?? null;
}

interface LegalPageProps {
  document: LegalDocumentId;
}

const DEFAULT_DOCUMENT_TITLE = 'Lantern Study — Flashcards, tests, groups & AI study tools';

export const LegalPage: React.FC<LegalPageProps> = ({ document: documentId }) => {
  const title = LEGAL_DOCUMENT_TITLES[documentId];
  const content = getLegalDocumentContent(documentId);

  useEffect(() => {
    const previousTitle = window.document.title;
    window.document.title = `${title} — Lantern Study`;
    return () => {
      window.document.title = previousTitle || DEFAULT_DOCUMENT_TITLE;
    };
  }, [title]);

  return (
    <div className="min-h-screen bg-lantern-background text-lantern-text">
      <header className="border-b border-gray-200 dark:border-gray-800 bg-white/80 dark:bg-slate-900/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center justify-between gap-4">
          <a href="/" className="text-sm font-medium text-indigo-600 dark:text-indigo-400 hover:underline">
            ← Back to Lantern Study
          </a>
          <nav className="flex gap-3 text-xs sm:text-sm">
            <a href={LEGAL_PATHS.privacy} className={documentId === 'privacy' ? 'font-semibold' : 'opacity-70 hover:opacity-100'}>
              Privacy
            </a>
            <a href={LEGAL_PATHS.terms} className={documentId === 'terms' ? 'font-semibold' : 'opacity-70 hover:opacity-100'}>
              Terms
            </a>
            <a href={LEGAL_PATHS.cookies} className={documentId === 'cookies' ? 'font-semibold' : 'opacity-70 hover:opacity-100'}>
              Cookies
            </a>
          </nav>
        </div>
      </header>
      <main className="max-w-3xl mx-auto px-4 py-8">
        <h1 className="text-2xl font-bold mb-6">{title}</h1>
        <div className="prose prose-slate dark:prose-invert max-w-none legal-markdown">
          <MarkdownRenderer content={content} />
        </div>
      </main>
    </div>
  );
};

export default LegalPage;
