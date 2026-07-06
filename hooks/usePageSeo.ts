import { useEffect } from 'react';

export interface PageSeoOptions {
  title: string;
  description?: string;
  canonicalUrl?: string;
  ogImage?: string;
  ogType?: string;
  jsonLd?: Record<string, unknown> | Record<string, unknown>[];
}

const DEFAULT_TITLE = 'Lantern Study — Flashcards, tests, groups & AI study tools';
const DEFAULT_DESCRIPTION =
  'Lantern Study is a collaborative learning app with flashcards, practice tests, study groups, marketplace decks, and AI tools.';

function upsertMeta(attr: 'name' | 'property', key: string, content: string) {
  const selector = `meta[${attr}="${key}"]`;
  let el = document.querySelector(selector) as HTMLMetaElement | null;
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
}

function upsertCanonical(href: string) {
  let el = document.querySelector('link[rel="canonical"]') as HTMLLinkElement | null;
  if (!el) {
    el = document.createElement('link');
    el.setAttribute('rel', 'canonical');
    document.head.appendChild(el);
  }
  el.setAttribute('href', href);
}

function upsertJsonLd(data: PageSeoOptions['jsonLd']) {
  const id = 'page-seo-jsonld';
  const existing = document.getElementById(id);
  if (existing) existing.remove();
  if (!data) return;
  const script = document.createElement('script');
  script.id = id;
  script.type = 'application/ld+json';
  script.textContent = JSON.stringify(data);
  document.head.appendChild(script);
}

export function usePageSeo(options: PageSeoOptions | null) {
  useEffect(() => {
    if (!options) return;

    const previousTitle = document.title;
    document.title = options.title;

    const previousDescription =
      document.querySelector('meta[name="description"]')?.getAttribute('content') || DEFAULT_DESCRIPTION;

    if (options.description) {
      upsertMeta('name', 'description', options.description);
    }
    upsertMeta('property', 'og:title', options.title);
    if (options.description) {
      upsertMeta('property', 'og:description', options.description);
      upsertMeta('name', 'twitter:description', options.description);
    }
    upsertMeta('name', 'twitter:title', options.title);
    upsertMeta('property', 'og:type', options.ogType || 'website');
    if (options.canonicalUrl) {
      upsertMeta('property', 'og:url', options.canonicalUrl);
      upsertCanonical(options.canonicalUrl);
    }
    if (options.ogImage) {
      upsertMeta('property', 'og:image', options.ogImage);
      upsertMeta('name', 'twitter:image', options.ogImage);
    }
    upsertJsonLd(options.jsonLd);

    return () => {
      document.title = previousTitle || DEFAULT_TITLE;
      upsertMeta('name', 'description', previousDescription);
      upsertJsonLd(null);
    };
  }, [
    options?.title,
    options?.description,
    options?.canonicalUrl,
    options?.ogImage,
    options?.ogType,
    options?.jsonLd,
  ]);
}
