import { useCallback, useEffect, useRef, useState } from 'react';
import type { StudySetSyllabusResponse } from '@lantern/shared';
import {
  deleteStudySetSyllabus,
  fetchStudySetSyllabus,
  uploadStudySetSyllabus,
} from '../../services/academic';
import { useAuthStore } from '../../stores/authStore';
import { useStudySetStore } from '../../stores/studySetStore';
import { useUIStore } from '../../stores/uiStore';
import { recordSyncClassSkip } from '../../utils/syncClassSkipped';

/**
 * The network and dismissal state behind "Sync with your class".
 *
 * Kept out of `CourseWorkspace` (3200 lines already) and out of
 * `SyncWithClassCard` (which stays presentational and therefore testable
 * without a store). The card renders what this returns; this owns everything
 * that can fail.
 *
 * WHAT `visible` MEANS, and why it is three conditions and not one:
 *  - the server said the columns exist (`supported`). Before 20260918150000 is
 *    hand-applied there is no card at all, rather than an upload button that
 *    answers 503;
 *  - the student has not skipped this set;
 *  - the set has no syllabus yet. Once one is read, the card's job is done and
 *    the set's own exam/syllabus footer carries it from then on.
 * The "is the set empty" half is NOT here — `StudySetHome` already computes
 * `hasMaterials` and gates on it, and computing it twice from two places is
 * how the two answers drift.
 *
 * FAILURE POSTURE. A fetch that fails answers `supported: false`, which hides
 * the card. That is deliberate: the card is an OFFER, and an offer that cannot
 * be honoured (because the API is unreachable) should not be on screen. The
 * student's own-way grid and every other door are still there.
 */
export interface SyncWithClassState {
  visible: boolean;
  syllabus: StudySetSyllabusResponse | null;
  uploading: boolean;
  /** The line shown after an upload, until the student navigates away. */
  foundLabel: string | null;
  error: string | null;
  uploadSyllabus: (file: File) => Promise<void>;
  undoSyllabus: () => Promise<void>;
  skipForNow: () => void;
}

/** Strip the `data:…;base64,` prefix a FileReader result carries. */
function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('That file could not be read.'));
    reader.onload = () => {
      const result = String(reader.result || '');
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.readAsDataURL(file);
  });
}

export function useSyncWithClass(studySetId: string | null | undefined): SyncWithClassState {
  const userId = useAuthStore((s) => s.currentUser?.id);
  // Subscribing to the map itself is what makes `Skip for now` re-render the
  // page; the selector above returns a stable function and would not.
  const skippedMap = useUIStore((s) => s.syncClassSkipped);
  const loadSets = useStudySetStore((s) => s.loadSets);

  const [syllabus, setSyllabus] = useState<StudySetSyllabusResponse | null>(null);
  const [uploading, setUploading] = useState(false);
  const [foundLabel, setFoundLabel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Guards a response from a set the student has already navigated away from
  // landing on the new set's card.
  const activeSetRef = useRef<string | null>(null);

  useEffect(() => {
    activeSetRef.current = studySetId ?? null;
    setSyllabus(null);
    setFoundLabel(null);
    setError(null);
    if (!studySetId) return;
    let cancelled = false;
    void fetchStudySetSyllabus(studySetId).then((data) => {
      if (cancelled || activeSetRef.current !== studySetId) return;
      setSyllabus(data);
    });
    return () => {
      cancelled = true;
    };
  }, [studySetId]);

  const uploadSyllabus = useCallback(
    async (file: File) => {
      if (!studySetId) return;
      setUploading(true);
      setError(null);
      setFoundLabel(null);
      try {
        const base64Data = await toBase64(file);
        const result = await uploadStudySetSyllabus(studySetId, {
          fileName: file.name,
          base64Data,
        });
        if (activeSetRef.current !== studySetId) return;
        setSyllabus({ supported: true, noteId: result.noteId, summary: result.summary });
        setFoundLabel(result.foundLabel);
        // The set row now carries a new exam date and a syllabus note, and the
        // header countdown and the materials list both read the store. Forced
        // because the row changed server-side, not locally.
        await loadSets({ force: true }).catch(() => undefined);
      } catch (err) {
        if (activeSetRef.current !== studySetId) return;
        // The server's own sentence, which names the actual problem ("Legacy
        // .doc files are not supported…", "…if it is a scan…"). A generic
        // "Upload failed" here would throw away the one useful thing in the
        // response.
        setError(err instanceof Error ? err.message : 'That syllabus could not be read.');
      } finally {
        setUploading(false);
      }
    },
    [studySetId, loadSets]
  );

  const undoSyllabus = useCallback(async () => {
    if (!studySetId) return;
    setError(null);
    try {
      await deleteStudySetSyllabus(studySetId);
      if (activeSetRef.current !== studySetId) return;
      setSyllabus({ supported: true, noteId: null, summary: null });
      setFoundLabel(null);
      await loadSets({ force: true }).catch(() => undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That could not be undone.');
    }
  }, [studySetId, loadSets]);

  // Local cache first, then the account: the skip is a DECISION about this set
  // and follows the student to their phone (#142). The card is gone the moment
  // this returns — the write is fire-and-forget.
  const skipForNow = useCallback(() => {
    if (!studySetId) return;
    recordSyncClassSkip(userId, studySetId);
  }, [userId, studySetId]);

  const skipped = Boolean(studySetId && userId && skippedMap[userId]?.[studySetId]);

  return {
    // `foundLabel` keeps the card up through the one moment it must not
    // vanish: the upload just landed, and "Found 12 weeks · 2 exam dates" plus
    // its Undo is the ANSWER to what the student just did. Without it the
    // card's own success would unmount it and the result would never be read.
    visible: Boolean(
      studySetId && syllabus?.supported && !skipped && (!syllabus.noteId || foundLabel)
    ),
    syllabus,
    uploading,
    foundLabel,
    error,
    uploadSyllabus,
    undoSyllabus,
    skipForNow,
  };
}
