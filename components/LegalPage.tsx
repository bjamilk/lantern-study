import React, { useMemo } from 'react';
import {
  LEGAL_DOCUMENT_TITLES,
  LEGAL_PATHS,
  getLegalDocumentContent,
  type LegalDocumentId,
} from '@lantern/shared';
import { MarkdownRenderer } from '@lantern/shared';
import { usePageSeo } from '../hooks/usePageSeo';

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

const LEGAL_DESCRIPTIONS: Record<LegalDocumentId, string> = {
  privacy: 'How Lantern Study collects, uses, and protects your personal data.',
  terms: 'Terms of Service for using Lantern Study flashcards, tests, groups, and marketplace.',
  cookies: 'How Lantern Study uses cookies and similar technologies on lanternstudy.com.',
};

export const LegalPage: React.FC<LegalPageProps> = ({ document: documentId }) => {
  const title = LEGAL_DOCUMENT_TITLES[documentId];
  const content = getLegalDocumentContent(documentId);
  const path = LEGAL_PATHS[documentId];

  const seo = useMemo(
    () => ({
      title: `${title} — Lantern Study`,
      description: LEGAL_DESCRIPTIONS[documentId],
      canonicalUrl: `https://lanternstudy.com${path}`,
    }),
    [documentId, path, title],
  );
  usePageSeo(seo);

  return (
    <div className="min-h-screen bg-lantern-background text-lantern-text">
      <header className="border-b border-lantern-border dark:border-lantern-border bg-lantern-surface/80 dark:bg-lantern-background/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center justify-between gap-4">
          <a href="/" className="text-sm font-medium text-lantern-primary hover:underline">
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
          <MarkdownRenderer content={content} enableMath={false} />
        </div>
      </main>
    </div>
  );
};

export default LegalPage;
