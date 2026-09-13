/**
 * The wire shape is the thing under test.
 *
 * A cover upload that quietly became multipart would still "work" in the
 * simulator and fail on an Android device, because RN's FormData file part
 * resolves a content:// URI the picker has already released. So: assert the
 * body is plain JSON fields, assert no FormData is constructed, and assert
 * the on-device path never reaches the server.
 */
import * as ImagePicker from 'expo-image-picker';
import { api } from './api';
import { prepareImageBase64ForUpload } from '../utils/prepareImage';
import { clearCover, pickCoverImage, uploadCover } from './coverUpload';

jest.mock('expo-image-picker', () => ({
  requestCameraPermissionsAsync: jest.fn(),
  requestMediaLibraryPermissionsAsync: jest.fn(),
  launchCameraAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(),
}));

jest.mock('./api', () => ({
  api: {
    uploadDeckCover: jest.fn(),
    uploadNoteCover: jest.fn(),
    clearDeckCover: jest.fn(),
    clearNoteCover: jest.fn(),
    uploadStudySetCover: jest.fn(),
    clearStudySetCover: jest.fn(),
  },
}));

jest.mock('../utils/prepareImage', () => ({
  prepareImageBase64ForUpload: jest.fn(),
}));

jest.mock('../components/ui/appDialog', () => ({ appAlert: jest.fn() }));

const picker = ImagePicker as jest.Mocked<typeof ImagePicker>;
const prepare = prepareImageBase64ForUpload as jest.MockedFunction<
  typeof prepareImageBase64ForUpload
>;
const mockApi = api as unknown as {
  uploadDeckCover: jest.Mock;
  uploadNoteCover: jest.Mock;
  clearDeckCover: jest.Mock;
  clearNoteCover: jest.Mock;
  uploadStudySetCover: jest.Mock;
  clearStudySetCover: jest.Mock;
};

const RESULT = {
  coverPath: 'cover-images/u1/deck-1.jpg',
  coverUrl: 'https://signed/original',
  coverThumbUrl: 'https://signed/thumb',
};

beforeEach(() => {
  jest.clearAllMocks();
  mockApi.uploadDeckCover.mockResolvedValue(RESULT);
  mockApi.uploadNoteCover.mockResolvedValue(RESULT);
  mockApi.clearDeckCover.mockResolvedValue({ coverPath: null });
  mockApi.clearNoteCover.mockResolvedValue({ coverPath: null });
  mockApi.uploadStudySetCover.mockResolvedValue(RESULT);
  mockApi.clearStudySetCover.mockResolvedValue({ coverPath: null });
});

describe('uploadCover', () => {
  const payload = { base64Data: 'AAAA', fileName: 'cover.jpg', contentType: 'image/jpeg' };

  it('sends the three JSON fields and nothing else', async () => {
    await uploadCover({ kind: 'deck', id: 'deck-1' }, payload);
    expect(mockApi.uploadDeckCover).toHaveBeenCalledWith('deck-1', payload);
    const [, body] = mockApi.uploadDeckCover.mock.calls[0];
    expect(Object.keys(body).sort()).toEqual(['base64Data', 'contentType', 'fileName']);
  });

  it('never builds a FormData', async () => {
    await uploadCover({ kind: 'deck', id: 'deck-1' }, payload);
    const [, body] = mockApi.uploadDeckCover.mock.calls[0];
    expect(typeof FormData === 'undefined' || !(body instanceof FormData)).toBe(true);
    expect(JSON.parse(JSON.stringify(body))).toEqual(payload);
  });

  it('strips the on-device URI a pick carries — a file:// path is not wire data', async () => {
    await uploadCover({ kind: 'note', id: 'note-7' }, {
      ...payload,
      localUri: 'file:///data/user/0/cache/pick.jpg',
    } as never);
    const [, body] = mockApi.uploadNoteCover.mock.calls[0];
    expect(body).not.toHaveProperty('localUri');
  });

  it('routes a note to the note endpoint', async () => {
    await uploadCover({ kind: 'note', id: 'note-7' }, payload);
    expect(mockApi.uploadNoteCover).toHaveBeenCalledWith('note-7', payload);
    expect(mockApi.uploadDeckCover).not.toHaveBeenCalled();
  });
});

describe('clearCover', () => {
  it('DELETEs the matching route', async () => {
    await clearCover({ kind: 'deck', id: 'deck-1' });
    expect(mockApi.clearDeckCover).toHaveBeenCalledWith('deck-1');
    await clearCover({ kind: 'note', id: 'note-7' });
    expect(mockApi.clearNoteCover).toHaveBeenCalledWith('note-7');
  });
});

describe('pickCoverImage', () => {
  it('returns null and never opens the picker when access is declined', async () => {
    picker.requestMediaLibraryPermissionsAsync.mockResolvedValue({
      status: 'denied',
    } as never);
    await expect(pickCoverImage('library')).resolves.toBeNull();
    expect(picker.launchImageLibraryAsync).not.toHaveBeenCalled();
  });

  it('returns null on a cancelled picker', async () => {
    picker.requestMediaLibraryPermissionsAsync.mockResolvedValue({
      status: 'granted',
    } as never);
    picker.launchImageLibraryAsync.mockResolvedValue({ canceled: true, assets: null } as never);
    await expect(pickCoverImage('library')).resolves.toBeNull();
  });

  it('refuses an oversized pick locally, without reading it', async () => {
    picker.requestMediaLibraryPermissionsAsync.mockResolvedValue({
      status: 'granted',
    } as never);
    picker.launchImageLibraryAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///big.jpg', mimeType: 'image/jpeg', fileSize: 40 * 1024 * 1024 }],
    } as never);
    await expect(pickCoverImage('library')).resolves.toBeNull();
    expect(prepare).not.toHaveBeenCalled();
  });

  it('re-encodes to the 1600px budget and hands back base64 plus the local URI', async () => {
    picker.requestCameraPermissionsAsync.mockResolvedValue({ status: 'granted' } as never);
    picker.launchCameraAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///shot.jpg', mimeType: 'image/jpeg', fileSize: 2000 }],
    } as never);
    prepare.mockResolvedValue({
      uri: 'file:///resized.jpg',
      fileName: 'cover.jpg',
      contentType: 'image/jpeg',
      base64Data: 'BBBB',
      byteLength: 4,
      passthrough: false,
    });

    await expect(pickCoverImage('camera')).resolves.toEqual({
      localUri: 'file:///resized.jpg',
      fileName: 'cover.jpg',
      contentType: 'image/jpeg',
      base64Data: 'BBBB',
    });
    expect(prepare).toHaveBeenCalledWith('file:///shot.jpg', 'marketplace', expect.anything());
  });
});

/**
 * The empty-id regression.
 *
 * On a device this posted `/api/v1/notes//cover` and `/api/v1/decks//cover`:
 * the list screens read the target from the row sheet's state, which
 * `ActionSheet` clears on close before the pressed handler runs. The screens
 * now latch the row; this is the belt that stops a URL with `//` ever leaving
 * the phone again.
 */
describe('cover target id', () => {
  const PAYLOAD = { base64Data: 'AAA', fileName: 'c.jpg', contentType: 'image/jpeg' };

  it.each(['deck', 'note', 'study-set'] as const)('refuses an empty %s id', async (kind) => {
    await expect(uploadCover({ kind, id: '' }, PAYLOAD)).rejects.toThrow(/no .* id/i);
    await expect(clearCover({ kind, id: '   ' })).rejects.toThrow(/no .* id/i);
    expect(mockApi.uploadDeckCover).not.toHaveBeenCalled();
    expect(mockApi.uploadNoteCover).not.toHaveBeenCalled();
    expect(mockApi.uploadStudySetCover).not.toHaveBeenCalled();
    expect(mockApi.clearDeckCover).not.toHaveBeenCalled();
    expect(mockApi.clearNoteCover).not.toHaveBeenCalled();
    expect(mockApi.clearStudySetCover).not.toHaveBeenCalled();
  });

  it('sends the id to the route for each kind', async () => {
    await uploadCover({ kind: 'deck', id: 'deck-1' }, PAYLOAD);
    await uploadCover({ kind: 'note', id: 'note-7' }, PAYLOAD);
    await uploadCover({ kind: 'study-set', id: 'set-3' }, PAYLOAD);
    expect(mockApi.uploadDeckCover).toHaveBeenCalledWith('deck-1', PAYLOAD);
    expect(mockApi.uploadNoteCover).toHaveBeenCalledWith('note-7', PAYLOAD);
    expect(mockApi.uploadStudySetCover).toHaveBeenCalledWith('set-3', PAYLOAD);

    await clearCover({ kind: 'study-set', id: 'set-3' });
    expect(mockApi.clearStudySetCover).toHaveBeenCalledWith('set-3');
  });
});
