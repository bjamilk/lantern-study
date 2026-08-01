import {
  assertPresentationFileName,
  assertUserOwnedNoteStoragePath,
  assertValidOfficeZip,
  buildPdfStudyText,
  buildPresentationStudyText,
  isThinExtractedStudyText,
  mergeExtractionTexts,
  presentationContentType,
} from './noteFiles';
import { assessPdfTextExtraction } from '@lantern/shared/utils/noteStudyContent';

describe('noteFiles presentation helpers', () => {
  it('accepts ppt and pptx extensions', () => {
    expect(() => assertPresentationFileName('lecture.pptx')).not.toThrow();
    expect(() => assertPresentationFileName('lecture.ppt')).not.toThrow();
  });

  it('rejects non-presentation extensions', () => {
    expect(() => assertPresentationFileName('lecture.pdf')).toThrow(/ppt or .pptx/);
  });

  it('maps mime types by extension', () => {
    expect(presentationContentType('deck.pptx')).toBe(
      'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    );
    expect(presentationContentType('deck.ppt')).toBe('application/vnd.ms-powerpoint');
  });

  it('rejects truncated zip uploads', () => {
    const truncated = Buffer.alloc(100, 0);
    truncated.writeUInt32LE(0x04034b50, 0);
    expect(() => assertValidOfficeZip(truncated, 'deck.pptx')).toThrow(/truncated/i);
  });

  it('skips zip validation for legacy .ppt files', () => {
    const notZip = Buffer.from('not a zip');
    expect(() => assertValidOfficeZip(notZip, 'deck.ppt')).not.toThrow();
  });

  it('accepts storage paths under the user folder only', () => {
    const userId = 'user-123';
    expect(() =>
      assertUserOwnedNoteStoragePath(`${userId}/123-deck.pptx`, userId)
    ).not.toThrow();
    // Filenames may contain consecutive dots without being path traversal
    expect(() =>
      assertUserOwnedNoteStoragePath(`${userId}/123-Lecture_1..pdf`, userId)
    ).not.toThrow();
    expect(() => assertUserOwnedNoteStoragePath('other-user/deck.pptx', userId)).toThrow(
      /invalid storage path/i
    );
    expect(() => assertUserOwnedNoteStoragePath('../etc/passwd', userId)).toThrow(
      /invalid storage path/i
    );
    expect(() =>
      assertUserOwnedNoteStoragePath(`${userId}/../other/deck.pptx`, userId)
    ).toThrow(/invalid storage path/i);
  });
});

describe('noteFiles extraction status builders', () => {
  it('marks sparse multi-page PDFs as needs_ocr', () => {
    const text = 'pg\n'.repeat(12);
    const assessment = assessPdfTextExtraction(text, 8);
    const built = buildPdfStudyText('scan.pdf', {
      text,
      pageCount: 8,
      assessment,
    });
    expect(built.extractionStatus).toBe('needs_ocr');
  });

  it('marks empty PDF extraction as empty with placeholder', () => {
    const assessment = assessPdfTextExtraction('', 3);
    const built = buildPdfStudyText('blank.pdf', {
      text: '',
      pageCount: 3,
      assessment,
    });
    expect(built.extractionStatus).toBe('empty');
    expect(built.studyText).toMatch(/Text extraction unavailable/);
  });

  it('builds presentation placeholders when text is missing', () => {
    const built = buildPresentationStudyText('deck.pptx', '');
    expect(built.extractionStatus).toBe('empty');
    expect(isThinExtractedStudyText(built.studyText)).toBe(true);
  });

  it('merges preview PDF text when shape text is thin', () => {
    const merged = mergeExtractionTexts(
      '[Presentation uploaded: deck.pptx. Text extraction unavailable.]',
      'Slide 1: photosynthesis overview with details'
    );
    expect(merged).toContain('photosynthesis');
  });
});
