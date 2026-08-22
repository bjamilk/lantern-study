import React, { useMemo } from 'react';
import {
  LEGAL_DOCUMENT_DESCRIPTIONS,
  LEGAL_DOCUMENT_IDS,
  LEGAL_DOCUMENT_TITLES,
  LEGAL_PATHS,
  getLegalDocumentContent,
  type LegalDocumentId,
} from '@lantern/shared';
import { MarkdownRenderer } from '@lantern/shared';
import { usePageSeo } from '../hooks/usePageSeo';
import { openCookiePreferenceCenter } from './CookieNoticeBanner';

// Every legal document the shared package knows about is routable here
// (index.tsx mounts one <Route> per LEGAL_PATHS entry).
const PATH_TO_DOC: Record<string, LegalDocumentId> = Object.fromEntries(
  LEGAL_DOCUMENT_IDS.map((id) => [LEGAL_PATHS[id], id]),
) as Record<string, LegalDocumentId>;

export function getLegalDocFromPathname(pathname: string): LegalDocumentId | null {
  const normalized = pathname.replace(/\/$/, '') || '/';
  return PATH_TO_DOC[normalized] ?? null;
}

interface LegalPageProps {
  document: LegalDocumentId;
}

/** Short nav labels; full titles stay in LEGAL_DOCUMENT_TITLES. */
const LEGAL_NAV_LABELS: Record<LegalDocumentId, string> = {
  privacy: 'Privacy',
  terms: 'Terms',
  cookies: 'Cookies',
  prohibited: 'Prohibited content',
  'seller-terms': 'Seller terms',
};

const LEGAL_DESCRIPTIONS: Record<LegalDocumentId, string> = LEGAL_DOCUMENT_DESCRIPTIONS;

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
          <nav className="flex flex-wrap justify-end gap-x-3 gap-y-1 text-xs sm:text-sm" aria-label="Legal documents">
            {LEGAL_DOCUMENT_IDS.map((id) => (
              <a
                key={id}
                href={LEGAL_PATHS[id]}
                aria-current={documentId === id ? 'page' : undefined}
                className={documentId === id ? 'font-semibold' : 'opacity-70 hover:opacity-100'}
              >
                {LEGAL_NAV_LABELS[id]}
              </a>
            ))}
          </nav>
        </div>
      </header>
      <main className="max-w-3xl mx-auto px-4 py-8">
        <h1 className="text-2xl font-bold mb-6">{title}</h1>
        {documentId === 'cookies' && (
          <div className="mb-6 rounded-xl border border-lantern-border bg-lantern-surface/80 p-4 flex flex-col sm:flex-row sm:items-center gap-3">
            <p className="flex-1 text-sm text-lantern-text-secondary leading-snug">
              Open the Cookie Preference Center to review categories and confirm your choices. Strictly Necessary
              cookies always stay on.
            </p>
            <button
              type="button"
              onClick={() => openCookiePreferenceCenter()}
              className="shrink-0 min-h-[44px] rounded-lg bg-lantern-primary text-white px-4 py-2 text-sm font-medium"
            >
              Manage cookie preferences
            </button>
          </div>
        )}
        <div className="prose prose-slate dark:prose-invert max-w-none legal-markdown">
          <MarkdownRenderer content={content} enableMath={false} />
        </div>
      </main>
    </div>
  );
};

export default LegalPage;
