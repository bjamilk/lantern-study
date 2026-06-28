import {
  getNoteStudyContent,
  hasEnoughNoteStudyContent,
  isPlaceholderExtractedText,
  MIN_NOTE_STUDY_CONTENT_CHARS,
} from './noteStudyContent';

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
});
