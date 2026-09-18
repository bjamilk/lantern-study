import {
  HEIC_MIMES,
  NOTE_UPLOAD_ACCEPT,
  TEXT_PICKER_MIMES,
  assertImportedTextBody,
  buildImportedTextTitle,
  isHeicFileName,
  isHeicMime,
  isPlainTextFileName,
} from './noteUpload';

describe('the accept list', () => {
  it('covers .txt and .md, by extension and by mime', () => {
    expect(NOTE_UPLOAD_ACCEPT).toContain('.txt');
    expect(NOTE_UPLOAD_ACCEPT).toContain('.md');
    expect(NOTE_UPLOAD_ACCEPT).toContain('.markdown');
    expect(NOTE_UPLOAD_ACCEPT).toContain('text/plain');
    expect(NOTE_UPLOAD_ACCEPT).toContain('text/markdown');
  });

  it('covers iPhone photographs', () => {
    expect(NOTE_UPLOAD_ACCEPT).toContain('.heic');
    expect(NOTE_UPLOAD_ACCEPT).toContain('.heif');
    for (const mime of HEIC_MIMES) expect(NOTE_UPLOAD_ACCEPT).toContain(mime);
  });

  it('keeps the doors the pipeline already has', () => {
    for (const fragment of ['.pdf', '.pptx', '.ppt', '.docx', 'image/*']) {
      expect(NOTE_UPLOAD_ACCEPT).toContain(fragment);
    }
  });

  it('still refuses what nothing in the stack can read', () => {
    // A bare `.doc` would be accepted and then refused after a 25 MB upload;
    // audio and video have no file-transcription path at all.
    expect(NOTE_UPLOAD_ACCEPT).not.toMatch(/(^|,)\.doc(,|$)/);
    for (const fragment of ['.mp3', '.mp4', '.m4a', '.mov', 'audio/', 'video/']) {
      expect(NOTE_UPLOAD_ACCEPT).not.toContain(fragment);
    }
  });

  it('asks the phone picker for both text mimes', () => {
    expect(TEXT_PICKER_MIMES).toEqual(['text/plain', 'text/markdown']);
  });
});

describe('isPlainTextFileName', () => {
  it.each(['notes.txt', 'NOTES.TXT', 'readme.md', 'chapter.markdown'])('accepts %s', (name) => {
    expect(isPlainTextFileName(name)).toBe(true);
  });

  it.each(['slides.pptx', 'paper.pdf', 'essay.docx', 'txt', 'photo.heic'])(
    'refuses %s',
    (name) => {
      expect(isPlainTextFileName(name)).toBe(false);
    }
  );
});

describe('buildImportedTextTitle', () => {
  it('uses the file name without its extension', () => {
    expect(buildImportedTextTitle('Week 3 — enzymes.md')).toBe('Week 3 — enzymes');
    expect(buildImportedTextTitle('/tmp/lecture.txt')).toBe('lecture');
  });

  it('falls back rather than making a nameless note', () => {
    expect(buildImportedTextTitle('.md')).toBe('Imported notes');
    expect(buildImportedTextTitle('')).toBe('Imported notes');
  });
});

describe('assertImportedTextBody', () => {
  it('passes real text through', () => {
    expect(() => assertImportedTextBody('Mitochondria', 'a.txt')).not.toThrow();
  });

  it('refuses an empty file by name, before a blank note exists', () => {
    expect(() => assertImportedTextBody('   \n\t ', 'empty.txt')).toThrow(/empty\.txt/);
  });
});

describe('heic detection', () => {
  it('matches by name, which is the only signal Chrome gives', () => {
    expect(isHeicFileName('IMG_0042.HEIC')).toBe(true);
    expect(isHeicFileName('IMG_0042.heif')).toBe(true);
    expect(isHeicFileName('IMG_0042.jpg')).toBe(false);
  });

  it('matches the mime Safari gives', () => {
    expect(isHeicMime('image/heic')).toBe(true);
    expect(isHeicMime('IMAGE/HEIF')).toBe(true);
    expect(isHeicMime('')).toBe(false);
    expect(isHeicMime(undefined)).toBe(false);
    expect(isHeicMime('image/jpeg')).toBe(false);
  });
});
