import { getNoteStudyContent } from './noteStudyContent';

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
});
