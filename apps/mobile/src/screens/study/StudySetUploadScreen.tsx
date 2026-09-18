/**
 * Add materials to one set — the seven doors web offers, on the phone.
 *
 * The phone had one: the import modal. YouTube and Anki both existed as
 * working flows elsewhere in the app and were simply unreachable from a set,
 * and nothing filed a YouTube note into the set it was added from.
 *
 * The recent list is scoped to THIS set. A tracked job does not carry a set id
 * once it has been saved, so belonging is decided two ways: the job's pending
 * save still names the set, or the artifact it produced is filed here.
 *
 * Route: `StudySetUpload` in the Study stack.
 * Main exports: `StudySetUploadScreen` and `jobBelongsToStudySet`, which the set
 * room reuses and which is kept pure so the filing rule is testable.
 * The chip row is `setUploadDoors.ts`, not a literal in this file: every chip
 * has to resolve to a picker, the recorder, a panel or the Anki sheet, and that
 * invariant is asserted by a node test (issue #137 was four chips that resolved
 * to a sheet with no picker behind them).
 *
 * Touches: notesStore, flashcardStore, jobsStore, toastStore, authStore;
 * services/notes `createNote`/`createNoteFromYoutube`/`updateNote`; the file and
 * camera pickers live inside ImportAndStudyModal and ImportCardsSheet, not here,
 * and a file chip opens that sheet with `autoPick` so the picker fires at once.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useFocusEffect } from '@react-navigation/native';
import { materialsForStudySet } from '@lantern/shared';
import type { StudyStackParamList } from '../../navigation/types';
import { Button, Card, ScreenHeader, T } from '../../components/ui';
import { AppIcon } from '../../components/ui/AppIcon';
import { useTabBarClearance } from '../../components/layout/BottomTabBar';
import ImportAndStudyModal from '../../components/ImportAndStudyModal';
import ImportCardsSheet from '../../components/flashcards/ImportCardsSheet';
import { useNotesStore } from '../../stores/notesStore';
import { useFlashcardStore } from '../../stores/flashcardStore';
import { useJobsStore } from '../../stores/jobsStore';
import { useToastStore } from '../../stores/toastStore';
import { useAuthStore } from '../../stores/authStore';
import { createNote, createNoteFromYoutube, updateNote } from '../../services/notes';
import type { TrackedJob } from '../../stores/jobsCore';
import type { ImportFileKind } from '../../utils/fileImportDoors';
import { SET_UPLOAD_CHIPS, type SetUploadChip } from './setUploadDoors';

type Props = NativeStackScreenProps<StudyStackParamList, 'StudySetUpload'>;

type Panel = 'youtube' | 'paste' | null;
type JobFilter = 'all' | 'processing' | 'done' | 'failed';

/**
 * Does this job belong to this set?
 *
 * Exported for the room and kept pure so the answer is testable: a job in
 * flight is claimed by the set its pending save names, and a finished job by
 * the artifact it left behind being filed here.
 */
export function jobBelongsToStudySet(
  job: TrackedJob,
  studySetId: string,
  filed: { noteIds: Set<string>; deckIds: Set<string> }
): boolean {
  const pendingSetId = (job.pendingSave as { studySetId?: string | null } | undefined)?.studySetId;
  if (pendingSetId && pendingSetId === studySetId) return true;
  const ref = job.savedRef ?? job.artifact;
  if (!ref) return false;
  if (ref.type === 'note') return filed.noteIds.has(ref.id);
  if (ref.type === 'deck') return filed.deckIds.has(ref.id);
  return false;
}

export function StudySetUploadScreen({ navigation, route }: Props) {
  const { studySetId, courseId, courseLabel } = route.params;
  const tabBarClearance = useTabBarClearance(16);
  const showToast = useToastStore((s) => s.showToast);
  const userId = useAuthStore((s) => s.user?.id);
  const notes = useNotesStore((s) => s.notes);
  const decks = useFlashcardStore((s) => s.decks);
  const jobs = useJobsStore((s) => s.jobs);

  const [importOpen, setImportOpen] = useState(false);
  const [autoPick, setAutoPick] = useState<ImportFileKind | null>(null);
  const [ankiOpen, setAnkiOpen] = useState(false);
  const [panel, setPanel] = useState<Panel>(null);
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [pasteTitle, setPasteTitle] = useState('');
  const [pasteBody, setPasteBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<JobFilter>('all');

  useFocusEffect(
    useCallback(() => {
      void useNotesStore.getState().loadNotes().catch(() => undefined);
      if (userId) void useFlashcardStore.getState().fetchDecks(userId).catch(() => undefined);
    }, [userId])
  );

  const filed = useMemo(
    () => ({
      noteIds: new Set(materialsForStudySet(notes, studySetId).map((row) => row.id)),
      deckIds: new Set(materialsForStudySet(decks, studySetId).map((row) => row.id)),
    }),
    [notes, decks, studySetId]
  );

  const recent = useMemo(() => {
    return jobs
      .filter((job) => jobBelongsToStudySet(job, studySetId, filed))
      .filter((job) => {
        if (filter === 'processing') return job.status === 'queued' || job.status === 'running';
        if (filter === 'done') return job.status === 'done';
        if (filter === 'failed') return job.status === 'failed' || job.status === 'lost';
        return true;
      })
      .slice(0, 8);
  }, [jobs, studySetId, filed, filter]);

  const refreshNotes = () => {
    void useNotesStore.getState().loadNotes().catch(() => undefined);
  };

  const run = async (work: () => Promise<void>, success: string) => {
    setBusy(true);
    try {
      await work();
      showToast(success, 'success');
      setPanel(null);
      setYoutubeUrl('');
      setPasteTitle('');
      setPasteBody('');
      refreshNotes();
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : 'Could not add that material.',
        'error'
      );
    } finally {
      setBusy(false);
    }
  };

  const addYoutube = async () => {
    const result = await createNoteFromYoutube(youtubeUrl.trim());
    // The endpoint knows nothing about sets, so the note is filed immediately
    // after. Without this the video landed loose in Notes and the set that
    // asked for it never saw it.
    await updateNote(result.note.id, {
      studySetId,
      ...(courseId ? { courseId } : {}),
    }).catch(() => undefined);
    if (result.status === 'failed') {
      throw new Error(result.transcriptError || 'The transcript could not be read for that video.');
    }
  };

  const addPaste = async () => {
    await createNote({
      title: pasteTitle.trim() || 'Pasted notes',
      body: pasteBody.trim(),
      studySetId,
      ...(courseId ? { courseId } : {}),
    });
  };

  /**
   * FIXED (#137): every chip now opens something real.
   *
   * A chip that names a file type opens that file browser — the import sheet is
   * still what carries the upload, the filing and the flashcard/quiz job, so it
   * opens underneath with the picker already firing, and backing out of the
   * picker leaves the student on a sheet whose doors are all real. Audio and
   * Video are gone: no file-transcription path exists on any platform, and the
   * recorder is the honest door for a lecture.
   */
  const openChip = (chip: SetUploadChip) => {
    switch (chip.action.kind) {
      case 'panel':
        setPanel(chip.action.panel);
        return;
      case 'anki':
        setAnkiOpen(true);
        return;
      case 'recorder':
        navigation.navigate('LectureStudio', {
          courseId: courseId || undefined,
          courseLabel: courseLabel || undefined,
          studySetId,
        });
        return;
      case 'picker':
        setAutoPick(chip.action.file);
        setImportOpen(true);
        return;
    }
  };

  const openImportSheet = () => {
    setAutoPick(null);
    setImportOpen(true);
  };

  const closeImportSheet = () => {
    setImportOpen(false);
    setAutoPick(null);
  };

  return (
    <SafeAreaView className="flex-1 bg-lantern-background" edges={['top']}>
      <ScrollView
        className="flex-1"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: tabBarClearance, paddingHorizontal: 16, paddingTop: 8 }}
      >
        <ScreenHeader
          title="Add materials"
          subtitle="PDF, slides, Word, a recorded lecture, YouTube or pasted text — filed in this set."
          onBack={() => navigation.goBack()}
        />

        <Pressable
          onPress={openImportSheet}
          accessibilityRole="button"
          accessibilityLabel="Choose a file to import into this set"
          className="rounded-2xl border border-dashed border-lantern-border bg-lantern-surface px-4 py-8 items-center mb-4"
        >
          <AppIcon name="cloud-upload" size={28} />
          <T.Body className="mt-3">Choose files</T.Body>
          <T.Caption tone="secondary" className="mt-1">
            A PDF, slides, a Word document, or a photo of your pages
          </T.Caption>
        </Pressable>

        <View className="flex-row flex-wrap gap-2 mb-4">
          {SET_UPLOAD_CHIPS.map((chip) => (
            <Pressable
              key={chip.id}
              onPress={() => openChip(chip)}
              accessibilityRole="button"
              accessibilityLabel={`${chip.id}. ${chip.hint}`}
              className="px-3 py-2 rounded-full border border-lantern-border flex-row items-center gap-1.5"
            >
              <T.Caption>{chip.id}</T.Caption>
            </Pressable>
          ))}
        </View>

        {panel === 'youtube' ? (
          <Card className="mb-4">
            <T.Body>YouTube</T.Body>
            <T.Caption tone="secondary" className="mt-1 mb-3">
              Paste a video URL. The transcript is filed as a note in this set.
            </T.Caption>
            <TextInput
              value={youtubeUrl}
              onChangeText={setYoutubeUrl}
              placeholder="https://www.youtube.com/watch?v="
              placeholderTextColor="#94a3b8"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              accessibilityLabel="YouTube video URL"
              className="border border-lantern-border rounded-xl px-3 py-2.5 text-lantern-text bg-lantern-surface"
            />
            <View className="flex-row gap-2 mt-3">
              <Button variant="ghost" onPress={() => setPanel(null)}>
                Cancel
              </Button>
              <Button
                disabled={busy || !youtubeUrl.trim()}
                onPress={() => void run(addYoutube, 'YouTube note filed in this set.')}
              >
                {busy ? 'Adding…' : 'Add video'}
              </Button>
            </View>
          </Card>
        ) : null}

        {panel === 'paste' ? (
          <Card className="mb-4">
            <T.Body>Paste notes</T.Body>
            <TextInput
              value={pasteTitle}
              onChangeText={setPasteTitle}
              placeholder="Note title"
              placeholderTextColor="#94a3b8"
              accessibilityLabel="Note title"
              className="mt-3 border border-lantern-border rounded-xl px-3 py-2.5 text-lantern-text bg-lantern-surface"
            />
            <TextInput
              value={pasteBody}
              onChangeText={setPasteBody}
              placeholder="Paste lecture notes or reading"
              placeholderTextColor="#94a3b8"
              multiline
              accessibilityLabel="Note text"
              className="mt-2 border border-lantern-border rounded-xl px-3 py-2.5 text-lantern-text bg-lantern-surface min-h-[140px]"
              style={{ textAlignVertical: 'top' }}
            />
            <View className="flex-row gap-2 mt-3">
              <Button variant="ghost" onPress={() => setPanel(null)}>
                Cancel
              </Button>
              <Button
                disabled={busy || !pasteBody.trim()}
                onPress={() => void run(addPaste, 'Note filed in this set.')}
              >
                {busy ? 'Saving…' : 'Save note'}
              </Button>
            </View>
          </Card>
        ) : null}

        <View className="flex-row items-center justify-between mb-2">
          <T.Caption tone="secondary">Recent uploads</T.Caption>
          <View className="flex-row gap-1">
            {(['all', 'processing', 'done', 'failed'] as const).map((id) => (
              <Pressable
                key={id}
                onPress={() => setFilter(id)}
                accessibilityRole="button"
                accessibilityState={{ selected: filter === id }}
                className={`px-2.5 py-1.5 rounded-full border ${
                  filter === id
                    ? 'border-lantern-primary bg-lantern-primary-background'
                    : 'border-lantern-border'
                }`}
              >
                <T.Caption>{id}</T.Caption>
              </Pressable>
            ))}
          </View>
        </View>

        <Card className="mb-3">
          {recent.length === 0 ? (
            <T.Body tone="secondary">
              {filter === 'all'
                ? 'Nothing added to this set yet.'
                : 'Nothing in this set matches that filter.'}
            </T.Body>
          ) : (
            recent.map((job, index) => (
              <View
                key={job.id}
                className={`py-3 ${index > 0 ? 'border-t border-lantern-border' : ''}`}
              >
                <T.Body numberOfLines={1}>{job.sourceTitle || 'Untitled'}</T.Body>
                <T.Caption tone="secondary">
                  {job.status === 'done'
                    ? 'Done'
                    : job.status === 'failed'
                      ? job.error || 'Failed'
                      : job.status === 'lost'
                        ? 'Lost — start it again'
                        : job.stage || job.serverStage || 'Processing'}
                </T.Caption>
              </View>
            ))
          )}
        </Card>
      </ScrollView>

      <ImportAndStudyModal
        visible={importOpen}
        courseId={courseId || undefined}
        studySetId={studySetId}
        autoPick={autoPick}
        onClose={closeImportSheet}
        onOpenNote={(noteId) => {
          closeImportSheet();
          navigation.navigate('NotesStudio', {
            courseId,
            courseLabel,
            noteId,
            studySetId,
          });
        }}
        onComplete={() => {
          refreshNotes();
          if (userId) void useFlashcardStore.getState().fetchDecks(userId).catch(() => undefined);
        }}
      />

      <ImportCardsSheet
        visible={ankiOpen}
        onClose={() => setAnkiOpen(false)}
        onImported={({ deckId, deckName }) => {
          setAnkiOpen(false);
          if (userId) void useFlashcardStore.getState().fetchDecks(userId).catch(() => undefined);
          // Said plainly rather than implied: the import writes a deck, and
          // filing a deck into a set is not something this flow can do yet.
          showToast(`${deckName} imported into your decks — not filed in this set.`, 'info');
          navigation.navigate('DeckDetail', { deckId, deckName });
        }}
      />
    </SafeAreaView>
  );
}

export default StudySetUploadScreen;
