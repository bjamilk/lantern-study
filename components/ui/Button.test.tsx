import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { Button } from './Button';
import { lightTheme, darkTheme } from '@lantern/shared';

/**
 * The 2026-09-12 colour pivot: a primary button is the theme's INK, never
 * indigo. This suite guards the two halves of that fact that can drift apart —
 * the CLASSES the primitive emits, and the TOKEN VALUES those classes resolve
 * to — because either one alone can silently reintroduce the old brand hue.
 *
 * It asserts on the ink pair (`bg-lantern-ink` / `text-lantern-surface`) rather
 * than on a hex, because that pair is what makes the pill invert with the
 * theme from one set of classes. `--color-ink` and `--color-surface` swap
 * together, so a near-black pill with a white label in light becomes a
 * near-white pill with a near-black label in dark without a `dark:` override.
 */
const html = (node: React.ReactElement) => renderToStaticMarkup(node);

describe('Button primary variant', () => {
  it('renders the ink pill, not a brand-hue fill', () => {
    const markup = html(<Button>Start studying</Button>);
    expect(markup).toContain('bg-lantern-ink');
    expect(markup).toContain('text-lantern-surface');
  });

  it('is the default variant, so an unqualified button is an ink pill', () => {
    expect(html(<Button>Go</Button>)).toBe(html(<Button variant="primary">Go</Button>));
  });

  it('paints accent as flashcards lime, not the brown leftover', () => {
    const markup = html(<Button variant="accent">Study</Button>);
    expect(markup).toContain('bg-lantern-feature-flashcards-tint');
    expect(markup).toContain('text-lantern-feature-flashcards-ink');
    expect(markup).not.toContain('bg-lantern-accent');
    expect(markup).not.toContain('shadow-lantern');
  });

  it('carries no indigo anywhere in its markup', () => {
    for (const variant of ['primary', 'secondary', 'accent', 'ghost', 'danger'] as const) {
      const markup = html(<Button variant={variant}>Label</Button>);
      expect(markup).not.toMatch(/indigo|4f46e5|6366f1|818cf8|3730a3/i);
    }
  });

  it('focuses in the ink too, so the ring matches the pill', () => {
    expect(html(<Button>Go</Button>)).toContain('focus-visible:ring-lantern-ink');
  });
});

describe('the tokens the primary classes resolve to', () => {
  it('paints the primary fill in the ink of its own theme', () => {
    expect(lightTheme.primaryFill).toBe(lightTheme.ink);
    expect(darkTheme.primaryFill).toBe(darkTheme.ink);
  });

  it('inverts the ink between themes, so the pill is never a hole', () => {
    expect(lightTheme.ink).toBe('#191919');
    expect(darkTheme.ink).toBe('#f5f5f5');
  });

  it('sets primary text to the same ink, so a link matches a button', () => {
    expect(lightTheme.primaryText).toBe(lightTheme.ink);
    expect(darkTheme.primaryText).toBe(darkTheme.ink);
  });

  it('keeps no indigo in the primary family', () => {
    const indigo = /^#(4f46e5|6366f1|3730a3|818cf8|a5b4fc|eef2ff)/i;
    for (const theme of [lightTheme, darkTheme]) {
      for (const key of ['primary', 'primaryLight', 'primaryDark', 'primaryFill', 'primaryText', 'primaryBackground'] as const) {
        expect(theme[key]).not.toMatch(indigo);
      }
    }
  });

  it('leaves the semantic colours alone — only the brand hue moved', () => {
    expect(lightTheme.success).toBe('#047857');
    expect(lightTheme.error).toBe('#d42323');
    expect(lightTheme.warning).toBe('#b45309');
    expect(lightTheme.info).toBe('#0369a1');
  });
});
