import {
  NoteAttachmentUrlError,
  describeAttachmentUrlError,
  fetchNoteAttachmentUrl,
} from './noteAttachmentUrl';
import { refreshNoteAttachmentUrl } from './notes';
import { supabase } from './supabase';

jest.mock('./notes', () => ({ refreshNoteAttachmentUrl: jest.fn() }));
jest.mock('./supabase', () => ({
  resetAuthRefreshBackoff: jest.fn(),
  supabase: { auth: { refreshSession: jest.fn(async () => ({ data: {}, error: null })) } },
}));

const refresh = refreshNoteAttachmentUrl as jest.MockedFunction<typeof refreshNoteAttachmentUrl>;
const refreshSession = supabase.auth.refreshSession as jest.Mock;

const httpError = (status: number, message: string) => {
  const error = new Error(message) as Error & { status?: number };
  error.status = status;
  return error;
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  (console.warn as jest.Mock).mockRestore?.();
});

describe('fetchNoteAttachmentUrl', () => {
  it('returns the signed URL on the happy path without touching the session', async () => {
    refresh.mockResolvedValue({ url: 'https://signed.test/a.m4a', expiresIn: 86400 });
    await expect(fetchNoteAttachmentUrl('note-1', 'att-1')).resolves.toBe(
      'https://signed.test/a.m4a'
    );
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(refreshSession).not.toHaveBeenCalled();
  });

  it('re-signs exactly once on a 401 and succeeds', async () => {
    refresh
      .mockRejectedValueOnce(httpError(401, 'Missing or invalid token.'))
      .mockResolvedValueOnce({ url: 'https://signed.test/fresh.m4a', expiresIn: 86400 });
    await expect(fetchNoteAttachmentUrl('note-1', 'att-1')).resolves.toBe(
      'https://signed.test/fresh.m4a'
    );
    expect(refreshSession).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('re-signs once on a 403 and reports the second refusal, not a third try', async () => {
    refresh.mockRejectedValue(httpError(403, 'You cannot read this note.'));
    await expect(fetchNoteAttachmentUrl('note-1', 'att-1')).rejects.toMatchObject({
      message: 'You cannot read this note.',
      status: 403,
    });
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('does not retry a 400 — a row with no storage path will never sign', async () => {
    refresh.mockRejectedValue(
      httpError(400, 'This file cannot be opened. This attachment was saved without a stored file.')
    );
    await expect(fetchNoteAttachmentUrl('note-1', 'att-1')).rejects.toBeInstanceOf(
      NoteAttachmentUrlError
    );
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(refreshSession).not.toHaveBeenCalled();
  });

  it('treats an empty URL as a failure rather than handing the player a blank source', async () => {
    refresh.mockResolvedValue({ url: '', expiresIn: 86400 });
    await expect(fetchNoteAttachmentUrl('note-1', 'att-1')).rejects.toMatchObject({
      message: 'The server returned no URL for this file.',
    });
  });
});

describe('describeAttachmentUrlError', () => {
  it('keeps the server sentence and stamps the status', () => {
    expect(
      describeAttachmentUrlError(new NoteAttachmentUrlError('Attachment not found.', 'sign', 404), 'x')
    ).toBe('Attachment not found. (404)');
  });

  it('falls back only when there is nothing to say', () => {
    expect(describeAttachmentUrlError(new Error(''), 'Could not load it.')).toBe(
      'Could not load it.'
    );
  });
});
