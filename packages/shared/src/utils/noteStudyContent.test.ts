import {
  getNoteStudyContent,
  getNoteStudyContentForSmartNotes,
  hasEnoughNoteStudyContent,
  isPlaceholderExtractedText,
  MIN_NOTE_STUDY_CONTENT_CHARS,
} from './noteStudyContent';
import { upsertSmartNotesSection } from './smartNotes';

describe('getNoteStudyContent', () => {
  it('prefers body for typed notes', () => {
    expect(
      getNoteStudyContent({
        sourceType: 'typed',
        body: 'My notes',
        attachments: [{ extractedText: 'hidden' }],
      })
    ).toBe('My notes');
  });

  it('prefers attachment extracted text for pdf notes', () => {
    expect(
      getNoteStudyContent({
        sourceType: 'pdf',
        body: 'user annotation',
        attachments: [{ extractedText: 'full pdf text' }],
      })
    ).toBe('full pdf text\n\nuser annotation');
  });

  it('prefers attachment extracted text for presentation notes', () => {
    expect(
      getNoteStudyContent({
        sourceType: 'presentation',
        body: '',
        attachments: [{ extractedText: 'slide bullets' }],
        summary: 'old summary',
      })
    ).toBe('slide bullets\n\nold summary');
  });

  it('combines youtube transcript attachment with body and summary', () => {
    expect(
      getNoteStudyContent({
        sourceType: 'youtube',
        body: 'my notes',
        attachments: [{ extractedText: 'video transcript' }],
        summary: 'summary',
      })
    ).toBe('video transcript\n\nmy notes\n\nsummary');
  });

  it('falls back to summary when document note has no extraction', () => {
    expect(
      getNoteStudyContent({
        sourceType: 'pdf',
        body: '',
        attachments: [],
        summary: 'cached summary',
      })
    ).toBe('cached summary');
  });

  it('ignores presentation extraction placeholders', () => {
    expect(
      getNoteStudyContent({
        sourceType: 'presentation',
        body: '',
        attachments: [{ extractedText: '[Extracting text from slides…]' }],
        summary: 'cached summary',
      })
    ).toBe('cached summary');
  });

  it('ignores ascii presentation extraction placeholders', () => {
    expect(
      getNoteStudyContent({
        sourceType: 'presentation',
        body: '',
        attachments: [{ extractedText: '[Extracting text from slides...]' }],
        summary: 'cached summary',
      })
    ).toBe('cached summary');
  });

  it('detects placeholder extracted text', () => {
    expect(isPlaceholderExtractedText('[Extracting text from slides…]')).toBe(true);
    expect(isPlaceholderExtractedText('[Extracting text from slides...]')).toBe(true);
    expect(
      isPlaceholderExtractedText('[Presentation uploaded: deck.pptx. Text extraction unavailable.]')
    ).toBe(true);
    expect(
      isPlaceholderExtractedText('[PDF uploaded: chapter1.pdf. Text extraction unavailable.]')
    ).toBe(true);
    expect(isPlaceholderExtractedText('real slide bullets')).toBe(false);
  });

  it('requires minimum study content length', () => {
    expect(MIN_NOTE_STUDY_CONTENT_CHARS).toBe(50);
    expect(
      hasEnoughNoteStudyContent({
        sourceType: 'typed',
        body: 'x'.repeat(49),
      })
    ).toBe(false);
    expect(
      hasEnoughNoteStudyContent({
        sourceType: 'typed',
        body: 'x'.repeat(50),
      })
    ).toBe(true);
  });

  it('excludes prior summary and Smart Notes section for regeneration input', () => {
    const body = upsertSmartNotesSection('my notes', 'Old thin Core Idea');
    expect(
      getNoteStudyContentForSmartNotes({
        sourceType: 'youtube',
        body,
        attachments: [{ extractedText: 'full transcript text here' }],
        summary: 'Old thin Core Idea',
      })
    ).toBe('full transcript text here\n\nmy notes');
  });

  it('can omit summary via options while keeping body smart notes for other tools', () => {
    const body = upsertSmartNotesSection('annotation', 'Generated notes');
    expect(
      getNoteStudyContent(
        {
          sourceType: 'pdf',
          body,
          attachments: [{ extractedText: 'pdf text' }],
          summary: 'dup',
        },
        { includeSummary: false }
      )
    ).toContain('Generated notes');
    expect(
      getNoteStudyContent(
        {
          sourceType: 'pdf',
          body,
          attachments: [{ extractedText: 'pdf text' }],
          summary: 'dup',
        },
        { includeSummary: false }
      )
    ).not.toContain('dup');
  });
});
