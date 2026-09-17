import { verifyAccountExportSignature } from './accountExportSign';
import type { DataLayer } from './data';
import { getAccountLifecycle } from './accountLifecycle';
import { logger } from '../utils/logger';

const PRIVILEGED_IMPORT_KEYS = new Set([
  'is_banned',
  'account_status',
  'is_platform_admin',
  'ban_reason',
  'banned_at',
  'banned_by',
  'suspended_until',
  'moderation_flags',
  'deactivated_at',
  'deletion_scheduled_at',
]);

function stripPrivilegedFromSettings(settings: unknown): Record<string, unknown> {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(settings as Record<string, unknown>)) {
    if (!PRIVILEGED_IMPORT_KEYS.has(k)) out[k] = v;
  }
  return out;
}

function asArray<T = Record<string, unknown>>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function deckImportPayload(deckRow: Record<string, unknown>) {
  const flashcards = asArray(deckRow.flashcards).map((card) => ({
    type: card.type || 'BASIC',
    front: card.front,
    back: card.back,
    clozeText: card.cloze_text ?? card.clozeText,
    cloze_text: card.cloze_text ?? card.clozeText,
    imageUrl: card.image_url ?? card.imageUrl,
    image_url: card.image_url ?? card.imageUrl,
    occlusionData: card.occlusion_data ?? card.occlusionData,
    occlusion_data: card.occlusion_data ?? card.occlusionData,
  }));

  return {
    deck: {
      name: String(deckRow.name || 'Imported deck'),
      description: String(deckRow.description || ''),
    },
    flashcards,
  };
}

export interface ImportAccountResult {
  noteFolders: number;
  notes: number;
  decks: number;
  flashcards: number;
}

export async function importAccountArchive(
  layer: DataLayer,
  targetUserId: string,
  exportDoc: {
    format: string;
    sourceUserId: string;
    sourceEmail?: string | null;
    exportedAt: string;
    signature: string;
    data: Record<string, unknown>;
  },
  options?: { confirmEmailMismatch?: boolean }
): Promise<ImportAccountResult> {
  if (!verifyAccountExportSignature(exportDoc)) {
    throw new Error('Invalid or tampered backup file. Export a fresh backup from Settings.');
  }

  const archive = exportDoc.data;
  const profile = (archive.profile || {}) as Record<string, unknown>;
  const sourceEmail =
    (typeof exportDoc.sourceEmail === 'string' && exportDoc.sourceEmail) ||
    (typeof profile.email === 'string' ? profile.email : null);

  // TRANSITIONAL (M2d): `getAccountLifecycle` still takes the `SupabaseService` facade whole.
  const lifecycle = await getAccountLifecycle(layer.legacyService, targetUserId);
  const targetEmail = lifecycle?.email ?? null;

  if (
    sourceEmail &&
    targetEmail &&
    sourceEmail.toLowerCase() !== targetEmail.toLowerCase() &&
    !options?.confirmEmailMismatch
  ) {
    throw new Error(
      'Backup email does not match this account. Sign in with the original email or confirm import anyway.'
    );
  }

  const result: ImportAccountResult = {
    noteFolders: 0,
    notes: 0,
    decks: 0,
    flashcards: 0,
  };

  const folderIdMap = new Map<string, string>();
  for (const folder of asArray(archive.noteFolders)) {
    const created = await layer.notes.createNoteFolder(targetUserId, {
      name: String(folder.name || 'Imported folder'),
      color: typeof folder.color === 'string' ? folder.color : undefined,
    });
    if (folder.id) folderIdMap.set(String(folder.id), created.id);
    result.noteFolders += 1;
  }

  for (const note of asArray(archive.notes)) {
    const oldFolderId = note.folder_id ?? note.folderId;
    const folderId =
      oldFolderId != null ? folderIdMap.get(String(oldFolderId)) : undefined;

    await layer.notes.createNote(targetUserId, {
      title: String(note.title || 'Imported note'),
      body: String(note.body || ''),
      summary: typeof note.summary === 'string' ? note.summary : undefined,
      folderId,
      sourceType:
        typeof (note.source_type ?? note.sourceType) === 'string'
          ? String(note.source_type ?? note.sourceType)
          : undefined,
      youtubeUrl:
        typeof (note.youtube_url ?? note.youtubeUrl) === 'string'
          ? String(note.youtube_url ?? note.youtubeUrl)
          : undefined,
      youtubeVideoId:
        typeof (note.youtube_video_id ?? note.youtubeVideoId) === 'string'
          ? String(note.youtube_video_id ?? note.youtubeVideoId)
          : undefined,
    });
    result.notes += 1;
  }

  for (const deckRow of asArray(archive.decks)) {
    const payload = deckImportPayload(deckRow);
    const imported = await layer.decks.importDeck(payload, targetUserId);
    result.decks += 1;
    result.flashcards += payload.flashcards.length;
    void imported;
  }

  const safeSettings = stripPrivilegedFromSettings(profile.settings);
  if (Object.keys(safeSettings).length > 0) {
    const { data: targetProfile } = await layer
      .getClient()
      .from('profiles')
      .select('settings')
      .eq('id', targetUserId)
      .maybeSingle();

    const merged = {
      ...((targetProfile?.settings as Record<string, unknown>) || {}),
      ...safeSettings,
    };
    delete merged.test_presets;
    await layer.users.updateUser(targetUserId, { settings: merged });
  }

  logger.info('Account backup imported', {
    targetUserId,
    sourceUserId: exportDoc.sourceUserId,
    ...result,
  });

  return result;
}
