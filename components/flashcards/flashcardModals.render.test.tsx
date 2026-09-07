/**
 * Render smoke tests for the two sheets.
 *
 * Static rendering only — no effects, no clicks — but enough to catch the
 * failures that matter most here: a sheet that throws on open, a price line
 * that stops saying what a run costs, and an import door that stops promising
 * it is free.
 */
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import GenerateFlashcardsModal from '../GenerateFlashcardsModal';
import { ImportCardsModal } from './ImportCardsModal';

function html(node: React.ReactElement): string {
  return renderToStaticMarkup(node);
}

describe('GenerateFlashcardsModal', () => {
  it('opens with the counts the server honours and one price', () => {
    const markup = html(
      <GenerateFlashcardsModal isOpen onClose={() => {}} onSubmit={() => {}} isGenerating={false} />
    );
    expect(markup).toContain('Generate flashcards');
    expect(markup).toContain('>10<');
    expect(markup).toContain('>20<');
    // 30 is on offer because the server clamps with the same shared ceiling.
    expect(markup).toContain('>30<');
    expect(markup).toContain('1 AI use');
    expect(markup).toContain('the same 1 AI use at every count');
  });

  it('shows a sample card before anything is pasted, and says it is free', () => {
    const markup = html(
      <GenerateFlashcardsModal isOpen onClose={() => {}} onSubmit={() => {}} isGenerating={false} />
    );
    expect(markup).toContain('What a card looks like');
    expect(markup).toContain('It costs nothing');
  });

  it('renders nothing when closed', () => {
    expect(
      html(<GenerateFlashcardsModal isOpen={false} onClose={() => {}} onSubmit={() => {}} isGenerating={false} />)
    ).toBe('');
  });
});

describe('ImportCardsModal', () => {
  it('opens as a free door with both ways in', () => {
    const markup = html(<ImportCardsModal isOpen onClose={() => {}} />);
    expect(markup).toContain('Import cards');
    expect(markup).toContain('no AI uses');
    expect(markup).toContain('Costs no AI uses.');
    expect(markup).toContain('Choose a file');
    expect(markup).toContain('Or paste the export');
    expect(markup).toContain('Paste your export, or choose a file.');
  });

  it('renders nothing when closed', () => {
    expect(html(<ImportCardsModal isOpen={false} onClose={() => {}} />)).toBe('');
  });
});
