import { Response } from 'express';
import { AuthenticatedRequest } from '../types';
import {
  initializeAuthorizeResource,
  requireNoteAccess,
  requireNoteEdit,
  requireNoteOwner,
} from './authorizeResource';
import { SupabaseService } from '../services/supabase';

jest.mock('../utils/platformAdminAuth', () => ({
  isLivePlatformAdmin: jest.fn(),
}));

import { isLivePlatformAdmin } from '../utils/platformAdminAuth';

const mockIsLivePlatformAdmin = isLivePlatformAdmin as jest.MockedFunction<
  typeof isLivePlatformAdmin
>;

function mockRes(): Response {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
  return res as unknown as Response;
}

function runMiddleware(
  middleware: ReturnType<typeof requireNoteAccess>,
  req: AuthenticatedRequest
): Promise<{ res: Response; nextCalled: boolean }> {
  return new Promise((resolve) => {
    const res = mockRes();
    const originalJson = res.json.bind(res);
    (res as Response & { json: typeof res.json }).json = ((payload: unknown) => {
      originalJson(payload);
      resolve({ res, nextCalled: false });
      return res;
    }) as typeof res.json;
    void middleware(req, res, () => {
      resolve({ res, nextCalled: true });
    });
  });
}

describe('note access authorization middleware', () => {
  const resolveNoteAccess = jest.fn();
  const canEditNote = jest.fn();
  const isNoteOwner = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    mockIsLivePlatformAdmin.mockResolvedValue(false);
    initializeAuthorizeResource({
      resolveNoteAccess,
      canEditNote,
      isNoteOwner,
    } as unknown as SupabaseService);
  });

  it('requireNoteAccess denies outsiders', async () => {
    resolveNoteAccess.mockResolvedValue(null);
    const req = {
      user: { id: 'outsider', permissions: [], credentialType: 'jwt' },
      params: { noteId: 'note-1' },
    } as unknown as AuthenticatedRequest;

    const { res, nextCalled } = await runMiddleware(requireNoteAccess(), req);
    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(403);
  });

  it('requireNoteAccess allows viewers', async () => {
    resolveNoteAccess.mockResolvedValue({
      noteId: 'note-1',
      ownerId: 'owner-1',
      accessRole: 'viewer',
      canEdit: false,
      isOwner: false,
    });
    const req = {
      user: { id: 'viewer-1', permissions: [], credentialType: 'jwt' },
      params: { noteId: 'note-1' },
    } as unknown as AuthenticatedRequest;

    const { nextCalled } = await runMiddleware(requireNoteAccess(), req);
    expect(nextCalled).toBe(true);
  });

  it('requireNoteEdit denies viewers', async () => {
    canEditNote.mockResolvedValue(false);
    const req = {
      user: { id: 'viewer-1', permissions: [], credentialType: 'jwt' },
      params: { noteId: 'note-1' },
    } as unknown as AuthenticatedRequest;

    const { res, nextCalled } = await runMiddleware(requireNoteEdit(), req);
    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(403);
  });

  it('requireNoteEdit allows editors', async () => {
    canEditNote.mockResolvedValue(true);
    const req = {
      user: { id: 'editor-1', permissions: [], credentialType: 'jwt' },
      params: { noteId: 'note-1' },
    } as unknown as AuthenticatedRequest;

    const { nextCalled } = await runMiddleware(requireNoteEdit(), req);
    expect(nextCalled).toBe(true);
  });

  it('requireNoteOwner denies editors', async () => {
    isNoteOwner.mockResolvedValue(false);
    const req = {
      user: { id: 'editor-1', permissions: [], credentialType: 'jwt' },
      params: { noteId: 'note-1' },
    } as unknown as AuthenticatedRequest;

    const { res, nextCalled } = await runMiddleware(requireNoteOwner(), req);
    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(403);
  });

  it('requireNoteOwner allows owners', async () => {
    isNoteOwner.mockResolvedValue(true);
    const req = {
      user: { id: 'owner-1', permissions: [], credentialType: 'jwt' },
      params: { noteId: 'note-1' },
    } as unknown as AuthenticatedRequest;

    const { nextCalled } = await runMiddleware(requireNoteOwner(), req);
    expect(nextCalled).toBe(true);
  });
});
