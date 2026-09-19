/**
 * The network and dismissal state behind "Sync with your class" on the phone.
 *
 * The web hook's twin (components/study/useSyncWithClass.ts). Kept out of
 * `CourseRoomScreen` (1700 lines already) and out of the card, which stays
 * presentational and therefore renderable in a test without a store.
 *
 * WHAT `visible` MEANS:
 *  - the server said the columns exist (`supported`). Before 20260918150000
 *    there is no card, rather than an upload that 503s after the wait;
 *  - the student has not skipped this set — on this phone or on any other
 *    device, since the decision rides on the account (`syncClassSkipped`);
 *  - the set has no syllabus yet — EXCEPT for the moment right after an
 *    upload, where `foundLabel` holds the card up so the student can read the
 *    answer to what they just did.
 * The "is the set empty" half is NOT here: the room already computes it, and
 * computing it twice from two places is how the two answers drift.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import {
  MAX_SYLLABUS_BYTES,
  type StudySetSyllabusResponse,
} from '@lantern/shared';
import {
  deleteStudySetSyllabus,
  fetchStudySetSyllabus,
  uploadStudySetSyllabus,
} from '../../services/api';
import { useAuthStore } from '../../stores/authStore';
import { useSyncClassSkipStore } from '../../stores/syncClassSkipStore';
import { useSettingsStore } from '../../stores/settingsStore';

/** The two mimes the picker offers, matching `SYLLABUS_ACCEPT` on web. */
const SYLLABUS_MIMES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];

export interface MobileSyncWithClassState {
  visible: boolean;
  syllabus: StudySetSyllabusResponse | null;
  uploading: boolean;
  foundLabel: string | null;
  error: string | null;
  pickAndUpload: () => void;
  undoSyllabus: () => void;
  skipForNow: () => void;
  /** Re-read after something else changed the set (an exam date save). */
  refresh: () => void;
}

export function useSyncWithClass(
  studySetId: string | null | undefined
): MobileSyncWithClassState {
  const userId = useAuthStore((s) => s.user?.id);
  const hydrate = useSyncClassSkipStore((s) => s.hydrate);
  const markSkipped = useSyncClassSkipStore((s) => s.markSkipped);
  // Subscribing to the MAP is what re-renders the room on a skip; the
  // `isSkipped` selector returns a stable function and would not.
  const skippedMap = useSyncClassSkipStore((s) => s.skipped);
  // And the account's own map, subscribed to rather than read once: a settings
  // load that lands after this screen mounted has to hide the card too.
  const accountSkipped = useSettingsStore((s) => s.settings.syncClassSkipped);
  const settingsOwner = useSettingsStore((s) => s.ownerUserId);

  const [syllabus, setSyllabus] = useState<StudySetSyllabusResponse | null>(null);
  const [uploading, setUploading] = useState(false);
  const [foundLabel, setFoundLabel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  // Guards a response arriving after the student has swiped to another set.
  const activeSetRef = useRef<string | null>(null);

  useEffect(() => {
    void hydrate(userId);
  }, [hydrate, userId]);

  useEffect(() => {
    activeSetRef.current = studySetId ?? null;
    setSyllabus(null);
    setError(null);
    if (!studySetId) return;
    let cancelled = false;
    void fetchStudySetSyllabus(studySetId)
      .then((data) => {
        if (cancelled || activeSetRef.current !== studySetId) return;
        setSyllabus({
          supported: Boolean(data?.supported),
          noteId: typeof data?.noteId === 'string' ? data.noteId : null,
          summary: data?.summary ?? null,
        });
      })
      // A card is an OFFER, and an offer that cannot be honoured because the
      // API is unreachable should not be on screen. The room's other doors are
      // all still there.
      .catch(() => {
        if (cancelled) return;
        setSyllabus({ supported: false, noteId: null, summary: null });
      });
    return () => {
      cancelled = true;
    };
  }, [studySetId, reloadKey]);

  const pickAndUpload = useCallback(() => {
    if (!studySetId) return;
    void (async () => {
      setError(null);
      const picked = await DocumentPicker.getDocumentAsync({
        type: [...SYLLABUS_MIMES],
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (picked.canceled) return;
      const asset = picked.assets?.[0];
      if (!asset) return;

      const name = asset.name || 'syllabus.pdf';
      const lower = name.toLowerCase();
      // Checked here as well as on the server. Android's picker honours the
      // mime filter loosely and will hand back a `.doc` or a `.txt`, and a
      // refusal a student reads BEFORE a 20 MB upload is a better refusal.
      if (!lower.endsWith('.pdf') && !lower.endsWith('.docx')) {
        setError('A syllabus must be a .pdf or .docx file.');
        return;
      }
      if ((asset.size ?? 0) > MAX_SYLLABUS_BYTES) {
        setError(`That file is over ${Math.floor(MAX_SYLLABUS_BYTES / (1024 * 1024))} MB.`);
        return;
      }

      setUploading(true);
      setFoundLabel(null);
      try {
        const base64Data = await FileSystem.readAsStringAsync(asset.uri, {
          encoding: 'base64',
        });
        const result = await uploadStudySetSyllabus(studySetId, { fileName: name, base64Data });
        if (activeSetRef.current !== studySetId) return;
        setSyllabus({ supported: true, noteId: result.noteId, summary: result.summary });
        setFoundLabel(result.foundLabel);
      } catch (err) {
        if (activeSetRef.current !== studySetId) return;
        // The server's own sentence, which names the actual problem. A generic
        // "Upload failed" throws away the one useful thing in the response.
        setError(err instanceof Error ? err.message : 'That syllabus could not be read.');
      } finally {
        setUploading(false);
      }
    })();
  }, [studySetId]);

  const undoSyllabus = useCallback(() => {
    if (!studySetId) return;
    void (async () => {
      setError(null);
      try {
        await deleteStudySetSyllabus(studySetId);
        if (activeSetRef.current !== studySetId) return;
        setSyllabus({ supported: true, noteId: null, summary: null });
        setFoundLabel(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'That could not be undone.');
      }
    })();
  }, [studySetId]);

  const skipForNow = useCallback(() => {
    markSkipped(userId, studySetId);
  }, [markSkipped, userId, studySetId]);

  const refresh = useCallback(() => setReloadKey((n) => n + 1), []);

  const skipped = Boolean(
    studySetId &&
      userId &&
      (skippedMap[userId]?.[studySetId] ||
        // Only when the cached settings belong to THIS student: a sign-in
        // whose load has not landed yet must not hide the last one's cards.
        ((!settingsOwner || settingsOwner === userId) &&
          accountSkipped?.[studySetId] !== undefined))
  );

  return {
    visible: Boolean(
      studySetId && syllabus?.supported && !skipped && (!syllabus.noteId || foundLabel)
    ),
    syllabus,
    uploading,
    foundLabel,
    error,
    pickAndUpload,
    undoSyllabus,
    skipForNow,
    refresh,
  };
}
