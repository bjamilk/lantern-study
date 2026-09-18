/**
 * The three Word-import strings web and mobile both depend on.
 *
 * They are here rather than beside either client because the point of moving
 * them into shared was that the two platforms cannot drift: the phone's
 * document picker asks for `DOCX_MIME`, the web dropzone's `accept` contains
 * it, and both note bodies carry the same truncation sentence.
 */
import {
  DOCX_MIME,
  assertDocumentFileName,
  buildImportedDocumentBody,
} from './noteUpload';

describe('DOCX_MIME', () => {
  it('is the OOXML wordprocessing mime, exactly', () => {
    // A typo here is a picker that shows no files at all, on a device where
    // there is no console to find out why.
    expect(DOCX_MIME).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    );
  });
});

describe('assertDocumentFileName', () => {
  it('accepts .docx in any case', () => {
    expect(() => assertDocumentFileName('Lecture 4.docx')).not.toThrow();
    expect(() => assertDocumentFileName('LECTURE.DOCX')).not.toThrow();
  });

  it('refuses a legacy .doc with the re-save instruction', () => {
    expect(() => assertDocumentFileName('old-notes.doc')).toThrow(/save as \.docx/i);
  });

  it('refuses anything else', () => {
    expect(() => assertDocumentFileName('slides.pptx')).toThrow(/must be a \.docx/i);
    expect(() => assertDocumentFileName('notes')).toThrow(/must be a \.docx/i);
  });

  it('does not mistake a .doc inside the name for the extension', () => {
    expect(() => assertDocumentFileName('my.doc.backup.docx')).not.toThrow();
  });
});

describe('buildImportedDocumentBody', () => {
  it('returns the text untouched when nothing was cut', () => {
    expect(buildImportedDocumentBody('Body text', 'Essay.docx', false)).toBe('Body text');
  });

  it('puts the truncation notice IN the note, naming the file', () => {
    const body = buildImportedDocumentBody('Body text', 'Essay.docx', true);
    expect(body.startsWith('Body text')).toBe(true);
    expect(body).toContain('longer than Lantern reads in one note');
    expect(body).toContain('Essay.docx');
  });
});
