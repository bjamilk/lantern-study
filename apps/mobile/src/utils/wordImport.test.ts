/**
 * The phone's Word door, proved where it can be: the picker call, the two
 * refusals that happen before any bytes move, the offline state, and the note
 * the extracted text becomes.
 */
import {
  WORD_DOOR_LABEL,
  WORD_DOOR_OFFLINE_HINT,
  wordPickerOptions,
  importWordDocument,
  pickWordDocument,
  wordDoorState,
} from './wordImport';

const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

describe('the door itself', () => {
  it('is labelled for Word and asks the picker for the docx mime only', () => {
    expect(WORD_DOOR_LABEL).toContain('Word');
    expect(wordPickerOptions().type).toEqual([DOCX_MIME]);
    // copyToCacheDirectory is what makes asset.uri readable by FileSystem.
    expect(wordPickerOptions().copyToCacheDirectory).toBe(true);
    expect(wordPickerOptions().multiple).toBe(false);
  });

  it('is disabled offline, and says why rather than failing silently', () => {
    expect(wordDoorState(false)).toEqual({
      disabled: true,
      hint: WORD_DOOR_OFFLINE_HINT,
    });
    expect(WORD_DOOR_OFFLINE_HINT).toMatch(/offline/i);
  });

  it('is live online, with the size cap on the hint', () => {
    const state = wordDoorState(true);
    expect(state.disabled).toBe(false);
    expect(state.hint).toMatch(/25 MB/);
  });
});

describe('pickWordDocument', () => {
  const picked = (asset: Record<string, unknown>) =>
    jest.fn().mockResolvedValue({ canceled: false, assets: [asset] });

  it('passes the docx mime to the picker', async () => {
    const getDocumentAsync = picked({ uri: 'file:///a.docx', name: 'a.docx', size: 10 });
    await pickWordDocument(getDocumentAsync);
    expect(getDocumentAsync).toHaveBeenCalledWith(
      expect.objectContaining({ type: [DOCX_MIME] })
    );
  });

  it('returns null when the student backs out', async () => {
    const getDocumentAsync = jest.fn().mockResolvedValue({ canceled: true });
    await expect(pickWordDocument(getDocumentAsync)).resolves.toBeNull();
  });

  it('refuses a legacy .doc by name, before anything is uploaded', async () => {
    const getDocumentAsync = picked({ uri: 'file:///old.doc', name: 'old.doc', size: 10 });
    await expect(pickWordDocument(getDocumentAsync)).rejects.toThrow(/save as \.docx/i);
  });

  it('refuses a file over the 25 MB cap before it is read', async () => {
    const getDocumentAsync = picked({
      uri: 'file:///big.docx',
      name: 'big.docx',
      size: 26 * 1024 * 1024,
    });
    await expect(pickWordDocument(getDocumentAsync)).rejects.toThrow(/too large/i);
  });

  it('accepts a .docx whose size the provider did not report', async () => {
    const getDocumentAsync = picked({ uri: 'file:///a.docx', name: 'a.docx', size: null });
    await expect(pickWordDocument(getDocumentAsync)).resolves.toEqual({
      uri: 'file:///a.docx',
      name: 'a.docx',
      size: 0,
    });
  });
});

describe('importWordDocument', () => {
  it('creates a note from the extracted text through the paste path', async () => {
    const createNote = jest.fn().mockResolvedValue({ id: 'note-1' });
    const note = await importWordDocument({
      file: { uri: 'file:///Lecture 4.docx', name: 'Lecture 4.docx' },
      extractDocumentText: jest
        .fn()
        .mockResolvedValue({ title: 'Lecture 4', text: 'Mitosis has four phases.', truncated: false }),
      createNote,
    });

    expect(note).toEqual({ id: 'note-1' });
    expect(createNote).toHaveBeenCalledWith({
      title: 'Lecture 4',
      body: 'Mitosis has four phases.',
      sourceType: 'typed',
    });
  });

  it('writes the truncation line INTO the note when the server truncated', async () => {
    const createNote = jest.fn().mockResolvedValue({ id: 'note-2' });
    await importWordDocument({
      file: { uri: 'file:///Thesis.docx', name: 'Thesis.docx' },
      extractDocumentText: jest
        .fn()
        .mockResolvedValue({ title: 'Thesis', text: 'Chapter one…', truncated: true }),
      createNote,
    });

    const body = createNote.mock.calls[0][0].body as string;
    expect(body.startsWith('Chapter one…')).toBe(true);
    expect(body).toContain('longer than Lantern reads in one note');
    expect(body).toContain('Thesis.docx');
  });

  it('falls back to the file name when the server sends no title', async () => {
    const createNote = jest.fn().mockResolvedValue({ id: 'note-3' });
    await importWordDocument({
      file: { uri: 'file:///Week 2.docx', name: 'Week 2.docx' },
      extractDocumentText: jest.fn().mockResolvedValue({ title: '', text: 'Text', truncated: false }),
      createNote,
    });
    expect(createNote.mock.calls[0][0].title).toBe('Week 2');
  });
});
