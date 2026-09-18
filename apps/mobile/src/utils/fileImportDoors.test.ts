/**
 * The file doors ask for the right mimes, and refuse before the bytes move.
 *
 * Read `pickImportFile` asks the picker for the PDF mime first: a drifted mime
 * is a file browser that shows nothing at all, which on a phone looks like the
 * feature is broken rather than like a filter is wrong.
 */
import {
  PDF_MIME,
  PRESENTATION_MIMES,
  defaultImportFileName,
  importFilePickerOptions,
  pickImportFile,
} from './fileImportDoors';
import { DOCX_MIME } from '@lantern/shared/utils/noteUpload';

const asset = (over: Record<string, unknown> = {}) => ({
  canceled: false,
  assets: [{ uri: 'file:///tmp/x', name: 'lecture.pdf', size: 1024, ...over }],
});

describe('importFilePickerOptions', () => {
  it('asks for the PDF mime alone', () => {
    expect(importFilePickerOptions('pdf')).toEqual({
      type: [PDF_MIME],
      copyToCacheDirectory: true,
      multiple: false,
    });
  });

  it('asks for both PowerPoint mimes — a legacy .ppt is still readable', () => {
    expect(importFilePickerOptions('presentation').type).toEqual(PRESENTATION_MIMES);
  });

  it('asks for the docx mime for the Word door', () => {
    expect(importFilePickerOptions('document').type).toEqual([DOCX_MIME]);
  });

  it('hands the native module a fresh array every call', () => {
    const a = importFilePickerOptions('presentation');
    const b = importFilePickerOptions('presentation');
    expect(a.type).not.toBe(b.type);
  });
});

describe('pickImportFile', () => {
  it('opens the picker with the PDF mime and returns the file', async () => {
    const getDocumentAsync = jest.fn().mockResolvedValue(asset());
    const picked = await pickImportFile('pdf', getDocumentAsync);
    expect(getDocumentAsync).toHaveBeenCalledWith(
      expect.objectContaining({ type: [PDF_MIME] })
    );
    expect(picked).toEqual({ uri: 'file:///tmp/x', name: 'lecture.pdf', size: 1024 });
  });

  it('opens the picker with the PowerPoint mimes', async () => {
    const getDocumentAsync = jest
      .fn()
      .mockResolvedValue(asset({ name: 'week3.pptx' }));
    await pickImportFile('presentation', getDocumentAsync);
    expect(getDocumentAsync).toHaveBeenCalledWith(
      expect.objectContaining({ type: PRESENTATION_MIMES })
    );
  });

  it('routes the Word door through the docx picker and its .doc refusal', async () => {
    const getDocumentAsync = jest
      .fn()
      .mockResolvedValue(asset({ name: 'essay.doc' }));
    await expect(pickImportFile('document', getDocumentAsync)).rejects.toThrow(
      /save as \.docx/i
    );
    expect(getDocumentAsync).toHaveBeenCalledWith(
      expect.objectContaining({ type: [DOCX_MIME] })
    );
  });

  it('returns null when the student backs out', async () => {
    const getDocumentAsync = jest.fn().mockResolvedValue({ canceled: true });
    await expect(pickImportFile('pdf', getDocumentAsync)).resolves.toBeNull();
  });

  it('returns null when the provider hands back no asset', async () => {
    const getDocumentAsync = jest.fn().mockResolvedValue({ canceled: false, assets: [] });
    await expect(pickImportFile('presentation', getDocumentAsync)).resolves.toBeNull();
  });

  it('refuses an oversized file at the picker, before anything is read', async () => {
    const getDocumentAsync = jest
      .fn()
      .mockResolvedValue(asset({ size: 26 * 1024 * 1024 }));
    await expect(pickImportFile('pdf', getDocumentAsync)).rejects.toThrow(/too large/i);
  });

  it('names an unnamed file after its door', async () => {
    const getDocumentAsync = jest.fn().mockResolvedValue(asset({ name: null }));
    await expect(pickImportFile('presentation', getDocumentAsync)).resolves.toEqual(
      expect.objectContaining({ name: defaultImportFileName('presentation') })
    );
  });

  it('asks the picker for both text mimes at the text door', async () => {
    const getDocumentAsync = jest
      .fn()
      .mockResolvedValue(asset({ name: 'week-3.md' }));
    await pickImportFile('text', getDocumentAsync);
    expect(getDocumentAsync).toHaveBeenCalledWith(
      expect.objectContaining({ type: ['text/plain', 'text/markdown'] })
    );
  });

  it('refuses a file the text door cannot read, by name', async () => {
    // Android's picker honours a mime filter loosely and hands back whatever
    // was long-pressed; read as UTF-8, a PDF would become a note of mojibake.
    const getDocumentAsync = jest.fn().mockResolvedValue(asset({ name: 'paper.pdf' }));
    await expect(pickImportFile('text', getDocumentAsync)).rejects.toThrow(
      /not a \.txt or \.md file/i
    );
  });

  it('accepts .txt, .md and .markdown at the text door', async () => {
    for (const name of ['notes.txt', 'week-3.md', 'chapter.markdown']) {
      const getDocumentAsync = jest.fn().mockResolvedValue(asset({ name }));
      await expect(pickImportFile('text', getDocumentAsync)).resolves.toEqual(
        expect.objectContaining({ name })
      );
    }
  });
});
