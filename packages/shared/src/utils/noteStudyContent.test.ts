import {
  aggregatePhotoOcrStatus,
  assessPdfTextExtraction,
  getAttachmentExtractionStatus,
  getExtractionStatusMessage,
  getNoteStudyContent,
  getNoteStudyContentForSmartNotes,
  hasEnoughNoteStudyContent,
  isPlaceholderExtractedText,
  isThinOrUnusableStudyContent,
  MIN_NOTE_STUDY_CONTENT_CHARS,
  PDF_SCAN_MAX_CHARS_PER_PAGE,
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

  it('ignores OCR processing and scanned placeholders', () => {
    expect(isPlaceholderExtractedText('[Running OCR on scanned pages…]')).toBe(true);
    expect(isPlaceholderExtractedText('[Scanned PDF: chapter.pdf]')).toBe(true);
    expect(isPlaceholderExtractedText('[OCR failed: timeout]')).toBe(true);
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

describe('assessPdfTextExtraction', () => {
  it('marks empty / near-empty text as empty', () => {
    expect(assessPdfTextExtraction('', 10).status).toBe('empty');
    expect(assessPdfTextExtraction('page 1', 5).status).toBe('empty');
  });

  it('flags sparse multi-page PDFs as needs_ocr', () => {
    const sparse = 'header\n'.repeat(8); // ~56 chars across many pages
    const result = assessPdfTextExtraction(sparse, 10);
    expect(result.status).toBe('needs_ocr');
    expect(result.charsPerPage).toBeLessThan(PDF_SCAN_MAX_CHARS_PER_PAGE);
  });

  it('accepts dense digital PDFs as ok', () => {
    const dense = 'This is a real paragraph of lecture notes. '.repeat(20);
    expect(assessPdfTextExtraction(dense, 3).status).toBe('ok');
  });

  it('treats single-page short-but-usable text as ok when above empty threshold', () => {
    const text = 'x'.repeat(80);
    expect(assessPdfTextExtraction(text, 1).status).toBe('ok');
  });
});

describe('extraction status helpers', () => {
  it('reads extractionStatus from attachment metadata', () => {
    expect(
      getAttachmentExtractionStatus({
        metadata: { extractionStatus: 'needs_ocr' },
        extractedText: '[Scanned PDF: x.pdf]',
      })
    ).toBe('needs_ocr');
    expect(
      getAttachmentExtractionStatus({
        extractedText: '[PDF uploaded: x.pdf. Text extraction unavailable.]',
      })
    ).toBe('empty');
  });

  it('returns clear UX messages per status', () => {
    expect(getExtractionStatusMessage('needs_ocr', 'pdf')).toMatch(/Scanned PDF/i);
    expect(getExtractionStatusMessage('ocr_failed', 'pdf')).toMatch(/Local OCR/i);
    expect(getExtractionStatusMessage('ok')).toBeNull();
  });

  it('treats OCR-pending notes without body content as thin', () => {
    expect(
      isThinOrUnusableStudyContent({
        sourceType: 'pdf',
        body: '',
        attachments: [
          {
            extractedText: 'x'.repeat(60),
            metadata: { extractionStatus: 'needs_ocr' },
          },
        ],
      })
    ).toBe(true);
    expect(
      isThinOrUnusableStudyContent({
        sourceType: 'pdf',
        body: 'x'.repeat(60),
        attachments: [{ metadata: { extractionStatus: 'needs_ocr' } }],
      })
    ).toBe(false);
  });
});

/**
 * Photo notes were the one source type OCR never reached: the service had an
 * `image` branch but no route passed it, and extracted text on image
 * attachments was only consulted when the note body was empty.
 */
describe('photo note OCR', () => {
  const photo = (over: Record<string, unknown> = {}) => ({
    type: 'image',
    extractedText: 'Text read off the photograph, long enough to be usable study content.',
    metadata: { extractionStatus: 'ok' },
    ...over,
  });

  it('combines OCR text with the body instead of hiding it', () => {
    const content = getNoteStudyContent({
      sourceType: 'photos',
      body: 'My own annotation',
      attachments: [photo()],
    });
    expect(content).toContain('Text read off the photograph');
    expect(content).toContain('My own annotation');
  });

  it('still returns OCR text when the note has no body', () => {
    const content = getNoteStudyContent({ sourceType: 'photos', attachments: [photo()] });
    expect(content).toContain('Text read off the photograph');
  });

  it('ignores the OCR placeholder while a photo is still processing', () => {
    const content = getNoteStudyContent({
      sourceType: 'photos',
      body: 'My own annotation',
      attachments: [photo({ extractedText: '[Running OCR on scanned pages…]', metadata: { extractionStatus: 'ocr_processing' } })],
    });
    expect(content).toBe('My own annotation');
  });

  describe('aggregatePhotoOcrStatus', () => {
    it('is null when the note has no images', () => {
      expect(aggregatePhotoOcrStatus([])).toBeNull();
      expect(aggregatePhotoOcrStatus([{ type: 'pdf', metadata: { extractionStatus: 'ok' } }])).toBeNull();
    });

    it('reports processing while any photo is still running', () => {
      expect(
        aggregatePhotoOcrStatus([
          photo(),
          photo({ metadata: { extractionStatus: 'ocr_processing' } }),
        ])
      ).toBe('ocr_processing');
    });

    it('surfaces a failure once nothing is still running', () => {
      expect(
        aggregatePhotoOcrStatus([photo(), photo({ metadata: { extractionStatus: 'ocr_failed' } })])
      ).toBe('ocr_failed');
    });

    it('prefers processing over failure so the banner does not flap', () => {
      expect(
        aggregatePhotoOcrStatus([
          photo({ metadata: { extractionStatus: 'ocr_failed' } }),
          photo({ metadata: { extractionStatus: 'ocr_processing' } }),
        ])
      ).toBe('ocr_processing');
    });

    it('offers OCR when a photo has never been through it', () => {
      expect(aggregatePhotoOcrStatus([{ type: 'image' }])).toBe('needs_ocr');
      expect(aggregatePhotoOcrStatus([photo(), { type: 'image' }])).toBe('needs_ocr');
    });

    it('is ready only when every photo has been read', () => {
      expect(aggregatePhotoOcrStatus([photo(), photo()])).toBe('ok');
    });
  });
});
