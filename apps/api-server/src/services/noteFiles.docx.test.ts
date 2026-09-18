/**
 * Word (.docx) text extraction and its gates.
 *
 * The fixture is BUILT HERE with adm-zip (already a dependency) rather than
 * checked in: a real .docx is a ZIP of XML, so the test can make one in a
 * dozen lines, and a binary fixture in the tree is a thing nobody can read in
 * a diff or verify is what it claims to be.
 *
 * What is pinned is the honesty of the gates, not officeparser's cleverness:
 * a legacy `.doc` is refused by NAME with an instruction, a truncated or
 * non-ZIP upload is refused before the parser sees it, a document with too
 * little text is reported as thin rather than dressed up as content, and the
 * text cap actually truncates.
 */
import AdmZip from 'adm-zip';

import {
  assertDocumentFileName,
  assertDocumentSize,
  assertValidOfficeZip,
  buildDocumentStudyText,
  documentContentType,
  extractDocumentTextFromBuffer,
} from './noteFiles';

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

const RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

function documentXml(paragraphs: string[]): string {
  const body = paragraphs
    .map((text) => `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`)
    .join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`;
}

/** A real, minimal .docx — under 2 KB, and openable by Word. */
function makeDocx(paragraphs: string[]): Buffer {
  const zip = new AdmZip();
  zip.addFile('[Content_Types].xml', Buffer.from(CONTENT_TYPES, 'utf8'));
  zip.addFile('_rels/.rels', Buffer.from(RELS, 'utf8'));
  zip.addFile('word/document.xml', Buffer.from(documentXml(paragraphs), 'utf8'));
  return zip.toBuffer();
}

describe('the .docx name gate', () => {
  it('accepts a .docx', () => {
    expect(() => assertDocumentFileName('Lecture 4.docx')).not.toThrow();
    expect(() => assertDocumentFileName('LECTURE.DOCX')).not.toThrow();
  });

  it('refuses legacy binary .doc with the fix, not a parser error', () => {
    expect(() => assertDocumentFileName('old-notes.doc')).toThrow(/save as \.docx/i);
  });

  it('refuses anything else', () => {
    expect(() => assertDocumentFileName('slides.pptx')).toThrow(/must be a \.docx/i);
    expect(() => assertDocumentFileName('scan.pdf')).toThrow(/must be a \.docx/i);
  });

  it('names the one mime the route accepts', () => {
    expect(documentContentType()).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    );
  });
});

describe('the .docx byte gates', () => {
  it('accepts a real docx zip', () => {
    const buffer = makeDocx(['Hello.']);
    expect(buffer.length).toBeLessThan(5 * 1024);
    expect(() => assertValidOfficeZip(buffer, 'notes.docx')).not.toThrow();
    expect(() => assertDocumentSize(buffer)).not.toThrow();
  });

  it('refuses a file that is not a ZIP at all', () => {
    expect(() => assertValidOfficeZip(Buffer.from('not a zip'), 'notes.docx')).toThrow(
      /not a valid Office file/i
    );
  });

  it('refuses a truncated upload', () => {
    const truncated = makeDocx(['Hello.']).subarray(0, 60);
    expect(() => assertValidOfficeZip(truncated, 'notes.docx')).toThrow(/truncated/i);
  });

  it('refuses a document over the 25 MB cap', () => {
    expect(() => assertDocumentSize(Buffer.alloc(26 * 1024 * 1024))).toThrow(/exceeds maximum/i);
  });
});

describe('extractDocumentTextFromBuffer', () => {
  it('reads the prose out of a real docx', async () => {
    const buffer = makeDocx([
      'Photosynthesis converts light energy into chemical energy.',
      'The light-dependent reactions occur in the thylakoid membrane.',
    ]);
    const result = await extractDocumentTextFromBuffer(buffer, 'biology.docx');
    expect(result.truncated).toBe(false);
    expect(result.text).toContain('Photosynthesis converts light energy');
    expect(result.text).toContain('thylakoid membrane');
  });

  it('truncates at the character cap and says so', async () => {
    const buffer = makeDocx(['A'.repeat(5000)]);
    const result = await extractDocumentTextFromBuffer(buffer, 'long.docx', { maxChars: 100 });
    expect(result.truncated).toBe(true);
    expect(result.text.length).toBe(100);
  });

  it('never throws on a document it cannot read', async () => {
    const result = await extractDocumentTextFromBuffer(
      Buffer.from('definitely not a document'),
      'broken.docx'
    );
    expect(result).toEqual({ text: '', truncated: false });
  });
});

describe('buildDocumentStudyText', () => {
  it('reports a real document as ok', () => {
    const text = 'Photosynthesis converts light energy into chemical energy. '.repeat(10);
    expect(buildDocumentStudyText('bio.docx', text).extractionStatus).toBe('ok');
  });

  it('reports a document with almost no text as thin, not as content', () => {
    const built = buildDocumentStudyText('bio.docx', 'Hi.');
    expect(built.extractionStatus).toBe('needs_ocr');
    expect(built.studyText).toBe('Hi.');
  });

  it('never passes a placeholder off as content', () => {
    const built = buildDocumentStudyText('bio.docx', '');
    expect(built.extractionStatus).toBe('empty');
    expect(built.studyText).toContain('Text extraction unavailable');
  });
});
