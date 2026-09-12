import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { Headline } from './Headline';

describe('Headline', () => {
  it('sets the accent word in italic, in the feature ink, and nothing else', () => {
    const html = renderToStaticMarkup(
      <Headline accent="Games" feature="flashcards">
        Turn your files into Games
      </Headline>,
    );
    expect(html).toContain('italic');
    expect(html).toContain('text-lantern-feature-flashcards-ink');
    // The words around it keep the body ink and stay upright: the accent is a
    // span around ONE substring, not a class on the whole heading.
    const accent = html.match(/<span[^>]*headline-accent[^>]*>([^<]*)<\/span>/);
    expect(accent?.[1]).toBe('Games');
    expect(html).toContain('Turn your files into ');
  });

  it('carries the serif through the type step, never by naming a family', () => {
    const html = renderToStaticMarkup(<Headline accent="Games">Turn into Games</Headline>);
    // index.css maps `.text-display` / `.text-title` to --font-display. A call
    // site that reached for `font-display` directly would be a second source.
    expect(html).toContain('text-title');
    expect(html).not.toContain('font-display');
  });

  it('uses `display` for a screen name and `title` for a section', () => {
    expect(renderToStaticMarkup(<Headline size="display">Study</Headline>)).toContain(
      'text-display',
    );
    expect(renderToStaticMarkup(<Headline size="title">Study</Headline>)).toContain('text-title');
  });

  it('renders the heading whole when the accent is not in it', () => {
    // A headline is not worth a white screen, so a typo degrades to no accent.
    const html = renderToStaticMarkup(<Headline accent="Quizzes">Turn files into Games</Headline>);
    expect(html).toContain('Turn files into Games');
    expect(html).not.toContain('italic');
  });

  it('announces one sentence: the accent is a span, not an <em>', () => {
    const html = renderToStaticMarkup(
      <Headline accent="Games" as="h1">
        Turn your files into Games
      </Headline>,
    );
    expect(html).toMatch(/^<h1/);
    expect(html).not.toContain('<em');
    expect(html).not.toContain('<i>');
  });
});
