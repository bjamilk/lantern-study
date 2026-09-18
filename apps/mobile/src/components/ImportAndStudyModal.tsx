import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { appAlert } from './ui/appDialog';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { getNoteStudyContent } from '@lantern/shared';
import { defaultPhotoNoteTitle } from '@lantern/shared/utils/photoNoteTitle';
import { formatMaxNoteUploadLabel } from '@lantern/shared/utils/noteUpload';
import {
  emptyImportRunState,
  type ImportGeneratedArtifact,
  type ImportKind,
  type ImportRunState,
  uploadStageOf,
  type ImportStageId,
} from '@lantern/shared/utils/importStages';
import { ImportStages, WhereNextFork } from './study/ImportProgress';
import { readTextFile } from '../utils/textImport';
import { HANDWRITING_OCR_OFF_MESSAGE } from '@lantern/shared/utils/handwritingOcr';
import * as notesApi from '../services/notes';
import { fetchAiHealth } from '../services/api';
import { aiGenerateFlashcards } from '../services/ai';
import { normalizeFlashcardCount } from '@lantern/shared/utils';
import {
  WORD_DOOR_LABEL,
  importWordDocument,
  wordDoorState,
} from '../utils/wordImport';
import { pickImportFile, type ImportFileKind } from '../utils/fileImportDoors';
import { useSyncStatus } from '../hooks/useSync';
import { useAuthStore } from '../stores/authStore';
import { useNotesStore } from '../stores/notesStore';
import { useStudyGoalsStore } from '../stores/studyGoalsStore';
import { useJobsStore } from '../stores/jobsStore';
import { saveGeneratedDeck } from '../services/jobArtifacts';
import { brand, useTheme } from '../theme';
import { Button, SheetShell, T } from './ui';
import { AppIcon } from './ui/AppIcon';

export interface ImportAndStudyResult {
  noteId: string;
  noteTitle: string;
  /**
   * Study materials are being generated in the background (jobsStore) and are
   * not part of this result. Counts arrive with the completion notification.
   */
  generating?: boolean;
  flashcardCount?: number;
  /** Name of the deck the generated cards were saved into. */
  deckName?: string;
  quizQuestionCount?: number;
}

interface ImportAndStudyModalProps {
  visible: boolean;
  onClose: () => void;
  onComplete?: (result: ImportAndStudyResult) => void;
  onOpenNote: (noteId: string) => void;
  onTurnIntoStudyProduct?: (result: ImportAndStudyResult) => void;
  courseId?: string | null;
  studySetId?: string | null;
  /**
   * The second card of the "where next" fork. Passed ONLY when this set really
   * has a study plan — a card that opens nothing, at the one moment the student
   * is being asked to choose, is worse than no card.
   */
  onViewStudyPlan?: () => void;
  /** The fork's fallback second card, for a set with no plan yet. */
  onOpenSetHome?: () => void;
  /**
   * Fire one file picker the moment the sheet opens.
   *
   * The set room's PDF / PPT / Word chips set this. A chip names a file type,
   * so pressing it has to show a file browser — landing on a sheet and hunting
   * for the matching row is the "door with nothing behind it" of issue #137.
   * The doors stay drawn in the sheet, so backing out of the picker leaves the
   * student somewhere they can act rather than nowhere.
   */
  autoPick?: ImportFileKind | null;
}

type Step = 'input' | 'processing' | 'done';

export default function ImportAndStudyModal({
  visible,
  onClose,
  onComplete,
  onOpenNote,
  onTurnIntoStudyProduct,
  courseId,
  studySetId,
  onViewStudyPlan,
  onOpenSetHome,
  autoPick,
}: ImportAndStudyModalProps) {
  const { colors } = useTheme();
  const [step, setStep] = useState<Step>('input');
  const [textContent, setTextContent] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportAndStudyResult | null>(null);
  const [generateCards, setGenerateCards] = useState(true);
  const [generateQuiz, setGenerateQuiz] = useState(true);
  const [handwritingOcrOff, setHandwritingOcrOff] = useState(false);
  const { isOnline } = useSyncStatus();
  const wordDoor = wordDoorState(isOnline);
  /**
   * The staged progress the sheet draws instead of one spinner. A description
   * of what the pipeline has REPORTED, never a timer — see
   * `@lantern/shared/utils/importStages`.
   */
  const [run, setRun] = useState<ImportRunState | null>(null);
  /** What the failed card's Retry re-runs: only a closure still has the file. */
  const retryRef = useRef<(() => void) | null>(null);

  const generates = useMemo<ImportGeneratedArtifact[]>(() => {
    const list: ImportGeneratedArtifact[] = [];
    if (generateCards) list.push('flashcards');
    if (generateQuiz) list.push('quiz');
    return list;
  }, [generateCards, generateQuiz]);

  const beginRun = useCallback(
    (kind: ImportKind, hasUpload: boolean, retry: () => void) => {
      retryRef.current = retry;
      setRun(emptyImportRunState(kind, generates, hasUpload));
      setStep('processing');
      setError(null);
    },
    [generates]
  );

  const patchRun = useCallback((patch: Partial<ImportRunState>) => {
    setRun((prev) => (prev ? { ...prev, ...patch } : prev));
  }, []);

  /**
   * Land a failure ON the stage that produced it, keeping the message the
   * server or the network gave: "check your connection" and "no text could be
   * read out of this PDF" are different problems with different fixes.
   */
  const failRun = useCallback((stage: ImportStageId, message: string) => {
    setError(message);
    setRun((prev) => (prev ? { ...prev, failure: { stage, message } } : prev));
  }, []);

  useEffect(() => {
    if (!visible) return;
    void fetchAiHealth()
      .then((h) => setHandwritingOcrOff(h.handwritingOcr === 'off' || h.gemini === 'off'))
      .catch(() => setHandwritingOcrOff(false));
  }, [visible]);

  const reset = () => {
    setStep('input');
    setTextContent('');
    setError(null);
    setResult(null);
    setRun(null);
    retryRef.current = null;
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  /**
   * Wave G: the note is saved here and now, and the AI enrichment is handed to
   * the jobs store.
   *
   * The import used to sit on a blocking spinner through two AI calls — the
   * exact shape of the delivery failure this wave exists to beat. Now the note
   * lands immediately, the student can leave, and the flashcards and quiz
   * arrive with a notification and a deep link.
   *
   * The job is started UNWATCHED: this component is itself a Modal, and the
   * progress sheet is another one. The done panel below carries the promise,
   * and the Home card is where the sheet can be opened.
   */
  const enrichNote = useCallback(
    (note: {
      id: string;
      title: string;
      body?: string;
      sourceType?: string;
      summary?: string;
      attachments?: Array<{ extractedText?: string | null; metadata?: Record<string, unknown> | null }>;
    }) => {
      const studyText = getNoteStudyContent(note);
      const wanted = (generateCards || generateQuiz) && studyText.length >= 50;

      const res: ImportAndStudyResult = {
        noteId: note.id,
        noteTitle: note.title,
        generating: wanted,
      };
      // The note exists, so the middle card is done. The third card stays
      // ACTIVE while the generation job runs in the background — on the phone
      // the student is deliberately let go at this point, and the "where next"
      // fork below says so rather than holding them on a spinner.
      setRun((prev) =>
        prev ? { ...prev, materialReady: true, generationDone: !wanted } : prev
      );
      setResult(res);
      setStep('done');
      onComplete?.(res);
      if (!wanted) return;

      const content = studyText.slice(0, 8000);
      const wantCards = generateCards;
      const wantQuiz = generateQuiz;

      useJobsStore.getState().startJob({
        kind: 'import',
        sourceTitle: note.title,
        watch: false,
        run: async ({ jobId, onServerJob, onStage }) => {
          let flashcardCount = 0;
          let quizQuestionCount = 0;

          if (wantCards) {
            const { flashcards } = await aiGenerateFlashcards(content, {
              count: normalizeFlashcardCount(),
              onJobUpdate: (p) => {
                if (p.jobId) onServerJob(p.jobId);
              },
            });
            // Persist into a deck the same way the note editor's flashcard path
            // does — generating without saving spends AI credits and reports a
            // count of cards that exist nowhere. One shared save path
            // (services/jobArtifacts.ts) creates the deck only once the cards
            // exist, counts only the ones the server took, and rolls the deck
            // back rather than leaving an empty one in the library.
            const userId = useAuthStore.getState().user?.id;
            if (flashcards?.length && userId) {
              onStage('Saving to your library');
              const { saved } = await saveGeneratedDeck({
                jobId,
                userId,
                cards: flashcards,
                deckName: `From: ${note.title}`,
                description: `Generated from note: ${note.title}`,
                courseId: courseId ?? undefined,
                studySetId: studySetId ?? undefined,
              });
              flashcardCount = saved;
            }
          }

          if (wantQuiz) {
            // Same daily-quiz store path as the note editor's Quiz button: the
            // session is kept (and shown on the dashboard) instead of being
            // generated server-side and dropped. Uses the store's real studyGoal.
            await useStudyGoalsStore
              .getState()
              .startDailyQuizFromContent(content, note.id, note.title);
            quizQuestionCount =
              useStudyGoalsStore.getState().dailyQuiz?.questions.length ?? 0;
          }

          return {
            // The note is the artefact the student asked for; the deck and quiz
            // hang off it, and the note route is the one that always exists.
            artifact: { type: 'note', id: note.id, name: note.title },
            resultCount: flashcardCount + quizQuestionCount,
          };
        },
      });
    },
    [generateCards, generateQuiz, onComplete, courseId, studySetId]
  );

  const fileNote = async (noteId: string) => {
    if (!courseId && !studySetId) return;
    try {
      const updated = await notesApi.updateNote(noteId, {
        ...(courseId ? { courseId } : {}),
        ...(studySetId ? { studySetId } : {}),
      });
      useNotesStore.getState().upsertNote(updated);
    } catch {
      // The note still exists; filing can be fixed from the note.
    }
  };

  const processText = async () => {
    if (!textContent.trim()) return;
    beginRun('text', false, () => void processText());
    try {
      const note = await useNotesStore.getState().createNote({
        title: 'Imported Notes',
        body: textContent.trim(),
        sourceType: 'typed',
        ...(courseId ? { courseId } : {}),
        ...(studySetId ? { studySetId } : {}),
      });
      enrichNote(note);
    } catch (e: unknown) {
      failRun('processing', e instanceof Error ? e.message : 'Import failed');
    }
  };

  /**
   * The file doors: PDF, PowerPoint, Word (.docx) and plain text.
   *
   * Word goes through `createNote` — the SAME path the paste box below uses —
   * because the server hands back text rather than a stored file: a Word
   * document has no page model and no preview, so there is nothing to attach.
   * A PDF and a deck ARE stored, because they have pages a student reads and a
   * preview the room renders, so those two go through the upload routes the
   * Notes import sheet has always used and are filed into the set afterwards,
   * exactly as the photo path above does.
   *
   * Either way the note ends up in `enrichNote`, so the flashcard + quiz job is
   * the same one every other door in this sheet starts.
   */
  const handlePickFile = async (kind: ImportFileKind) => {
    let picked;
    try {
      picked = await pickImportFile(kind, DocumentPicker.getDocumentAsync);
    } catch (e: unknown) {
      // A legacy .doc or an oversized file, refused before anything uploaded.
      setError(e instanceof Error ? e.message : 'That file cannot be imported.');
      return;
    }
    if (!picked) return;

    const kindForStages: ImportKind =
      kind === 'pdf' ? 'pdf' : kind === 'presentation' ? 'presentation' : kind === 'text' ? 'text' : 'document';
    // A `.txt` is read on the device; the other three send bytes.
    beginRun(kindForStages, kind !== 'text', () => void handlePickFile(kind));
    try {
      if (kind === 'text') {
        const { title, body } = await readTextFile(picked.uri, picked.name);
        const note = await useNotesStore.getState().createNote({
          title,
          body,
          sourceType: 'import',
          ...(courseId ? { courseId } : {}),
          ...(studySetId ? { studySetId } : {}),
        });
        enrichNote(note);
        return;
      }

      if (kind === 'document') {
        const note = await importWordDocument({
          file: picked,
          extractDocumentText: notesApi.extractDocumentTextViaApi,
          createNote: (payload) =>
            useNotesStore.getState().createNote({
              ...payload,
              ...(courseId ? { courseId } : {}),
              ...(studySetId ? { studySetId } : {}),
            }),
        });
        enrichNote(note);
        return;
      }

      const uploaded =
        kind === 'pdf'
          ? await notesApi.uploadNotePdfViaApi(picked.uri, picked.name)
          : await notesApi.uploadPresentationViaApi(picked.uri, picked.name);
      const attachments = uploaded.attachment ? [uploaded.attachment] : [];
      useNotesStore.getState().upsertNote({ ...uploaded.note, attachments });
      // The bytes are in: the sheet's own upload card can only be told this
      // much, because the phone's upload helpers take no progress callback.
      patchRun({ upload: { phase: 'complete', percent: 100 } });
      enrichNote({ ...uploaded.note, attachments });
      await fileNote(uploaded.note.id);
    } catch (e: unknown) {
      failRun(uploadStageOf(e), e instanceof Error ? e.message : 'Import failed');
    }
  };

  /**
   * A chip that names a file type opens that file browser, not this sheet.
   *
   * Guarded by a ref rather than by state so a re-render (the sync hook ticks,
   * a toggle moves) cannot open a second picker on top of the first; it is
   * cleared when the sheet closes, so the same chip works again next time.
   */
  const autoPickedRef = useRef<ImportFileKind | null>(null);
  useEffect(() => {
    if (!visible) {
      autoPickedRef.current = null;
      return;
    }
    if (!autoPick || autoPickedRef.current === autoPick) return;
    autoPickedRef.current = autoPick;
    void handlePickFile(autoPick);
    // handlePickFile is re-created every render; the ref above is what makes
    // this run once per open, so it is deliberately not a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, autoPick]);

  const importPhotos = async (assets: ImagePicker.ImagePickerAsset[]) => {
    if (!assets.length) return;
    beginRun('photos', true, () => void importPhotos(assets));
    try {
      const uploaded = await notesApi.uploadNoteImagesViaApi(
        assets.map((asset, index) => ({
          uri: asset.uri,
          fileName: asset.fileName || `photo-${index + 1}.jpg`,
          mimeType: asset.mimeType,
          size: asset.fileSize ?? 0,
        })),
        undefined,
        defaultPhotoNoteTitle()
      );
      useNotesStore.getState().upsertNote({
        ...uploaded.note,
        attachments: uploaded.attachments,
      });
      patchRun({ upload: { phase: 'complete', percent: 100 } });
      enrichNote({
        ...uploaded.note,
        attachments: uploaded.attachments,
      });
      await fileNote(uploaded.note.id);
    } catch (e: unknown) {
      failRun(uploadStageOf(e), e instanceof Error ? e.message : 'Photo import failed');
    }
  };

  const handlePickPhotosFromLibrary = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      setError('Photo library permission is required.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: true,
      quality: 0.85,
      exif: false,
    });
    if (result.canceled || !result.assets.length) return;
    await importPhotos(result.assets);
  };

  const handleTakePhoto = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      setError('Camera permission is required.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ quality: 0.85, exif: false });
    if (result.canceled || !result.assets[0]) return;
    await importPhotos(result.assets);
  };

  const handlePickPhotos = () => {
    appAlert('Photograph pages', 'Choose a source', [
      { text: 'Photo library', onPress: () => void handlePickPhotosFromLibrary() },
      { text: 'Camera', onPress: () => void handleTakePhoto() },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  /** Is there anywhere for the completion fork to send them? */
  const canFork = Boolean(onOpenSetHome || onViewStudyPlan);

  return (
    // The shared sheet shell (components/ui/SheetShell.tsx). This panel was a
    // centred white card with a 15.75 sp sans heading and no grabber — the one
    // sheet in the app that had never been given the contract, which is exactly
    // what build 185's device pass found. The shell also owns the keyboard
    // handling this file used to do by hand, and adds the half it was missing:
    // `keyboardShouldPersistTaps`, without which the first tap on the confirm
    // button is swallowed to dismiss the IME.
    <SheetShell
      visible={visible}
      onClose={handleClose}
      title="Import & Study"
      headerRight={
        <Pressable
          onPress={handleClose}
          className="p-1"
          accessibilityRole="button"
          accessibilityLabel="Close"
        >
          <AppIcon name="close" size={22} color={colors.textSecondary} />
        </Pressable>
      }
      // Pinned below the scroll area, never inside it. On build 186 this
      // button sat at the end of the body and went off the bottom of the
      // window with the toggles clipped above it; with the keyboard up it was
      // a 14 px sliver. A sheet's primary action is chrome, not content.
      // The button is ALWAYS drawn on the input step, disabled until there is
      // text — build 187 hid it entirely while the box was empty, so the sheet
      // opened with no visible action and the student had to guess that typing
      // would summon one. A disabled control teaches what the step wants; an
      // absent one teaches nothing.
      footer={
        step === 'input' ? (
          <Button fullWidth disabled={!textContent.trim()} onPress={() => void processText()}>
            Import text
          </Button>
        ) : null
      }
    >
      <View>
            {step === 'input' ? (
              <>
                <Text className="text-sm text-lantern-text-secondary mb-3">
                  Photograph handwritten pages, bring in a PDF, slides or a Word document, or
                  paste lecture notes, to create study materials.
                </Text>
                <Text className="text-xs text-lantern-text-secondary mb-3">
                  {formatMaxNoteUploadLabel()}
                </Text>
                {handwritingOcrOff ? (
                  <Text className="text-xs text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 rounded-lg px-3 py-2 mb-3">
                    {HANDWRITING_OCR_OFF_MESSAGE}
                  </Text>
                ) : null}

                <Pressable
                  onPress={handlePickPhotos}
                  className="flex-row items-center gap-3 border-2 border-dashed border-lantern-border rounded-xl px-3 py-3 mb-3"
                >
                  <AppIcon name="camera" size={22} color={brand.text} />
                  <View className="flex-1">
                    <Text className="text-sm font-semibold text-lantern-text">Photograph pages</Text>
                    <Text className="text-xs text-lantern-text-secondary">
                      Camera or library — text is read off the photo
                    </Text>
                  </View>
                </Pressable>

                {/* The PDF and slides doors. They were reachable only from the
                    Notes import sheet, so a set room's PDF and PPT chips opened
                    this sheet and found nothing (issue #137). The upload routes
                    are the ones Notes has always called; the note is filed into
                    the course/set straight after. */}
                <Pressable
                  onPress={() => void handlePickFile('pdf')}
                  accessibilityRole="button"
                  accessibilityLabel="Import PDF"
                  accessibilityHint="Text is read out of the PDF"
                  className="flex-row items-center gap-3 border-2 border-dashed border-lantern-border rounded-xl px-3 py-3 mb-3"
                >
                  <AppIcon name="document-text" size={22} color={brand.text} />
                  <View className="flex-1">
                    {/* `T` rather than a raw `text-sm`: the type-scale gate
                        freezes this file's backlog, and a new door is not a
                        reason to raise it. */}
                    <T.Body className="font-semibold">Import PDF</T.Body>
                    <T.Caption tone="secondary">Text is read out of the PDF</T.Caption>
                  </View>
                </Pressable>

                <Pressable
                  onPress={() => void handlePickFile('presentation')}
                  accessibilityRole="button"
                  accessibilityLabel="Import PowerPoint"
                  accessibilityHint="Text is read off the slides"
                  className="flex-row items-center gap-3 border-2 border-dashed border-lantern-border rounded-xl px-3 py-3 mb-3"
                >
                  <AppIcon name="easel" size={22} color={brand.text} />
                  <View className="flex-1">
                    <T.Body className="font-semibold">Import PowerPoint</T.Body>
                    <T.Caption tone="secondary">Text is read off the slides</T.Caption>
                  </View>
                </Pressable>

                {/* The Word door. Disabled — visibly, with the reason under it
                    — when there is no connection, because the document is
                    parsed on the server: offline the picker would open, the
                    student would wait through the read, and the request would
                    die with a generic network message after the work. */}
                <Pressable
                  onPress={() => {
                    if (wordDoor.disabled) return;
                    void handlePickFile('document');
                  }}
                  disabled={wordDoor.disabled}
                  accessibilityRole="button"
                  accessibilityLabel={WORD_DOOR_LABEL}
                  accessibilityHint={wordDoor.hint}
                  accessibilityState={{ disabled: wordDoor.disabled }}
                  className={`flex-row items-center gap-3 border-2 border-dashed border-lantern-border rounded-xl px-3 py-3 mb-3 ${
                    wordDoor.disabled ? 'opacity-50' : ''
                  }`}
                >
                  <AppIcon name="document" size={22} color={brand.text} />
                  <View className="flex-1">
                    <Text className="text-sm font-semibold text-lantern-text">
                      {WORD_DOOR_LABEL}
                    </Text>
                    <Text className="text-xs text-lantern-text-secondary">{wordDoor.hint}</Text>
                  </View>
                </Pressable>

                {/* Plain text and Markdown. The cheapest door there is: the
                    file IS the note's body, read on the device, so nothing is
                    uploaded and no credit is spent reading it. */}
                <Pressable
                  onPress={() => void handlePickFile('text')}
                  accessibilityRole="button"
                  accessibilityLabel="Import a text file"
                  accessibilityHint="A .txt or .md file becomes a note"
                  className="flex-row items-center gap-3 border-2 border-dashed border-lantern-border rounded-xl px-3 py-3 mb-3"
                >
                  <AppIcon name="document-text" size={22} color={brand.text} />
                  <View className="flex-1">
                    <T.Body className="font-semibold">Text file (.txt, .md)</T.Body>
                    <T.Caption tone="secondary">Read on your phone — nothing is uploaded</T.Caption>
                  </View>
                </Pressable>

                <TextInput
                  value={textContent}
                  onChangeText={setTextContent}
                  placeholder="Or paste lecture notes / text..."
                  placeholderTextColor="#94a3b8"
                  multiline
                  textAlignVertical="top"
                  className="min-h-[100px] border border-lantern-border rounded-xl px-3 py-2 text-sm text-lantern-text bg-lantern-background mb-3"
                />

                <View className="flex-row gap-4 mb-3">
                  <View className="flex-row items-center gap-2">
                    <Switch value={generateCards} onValueChange={setGenerateCards} />
                    <Text className="text-sm text-lantern-text-secondary">Flashcards</Text>
                  </View>
                  <View className="flex-row items-center gap-2">
                    <Switch value={generateQuiz} onValueChange={setGenerateQuiz} />
                    <Text className="text-sm text-lantern-text-secondary">Quiz</Text>
                  </View>
                </View>

                {error ? <Text className="text-sm text-red-500 mt-2">{error}</Text> : null}
              </>
            ) : null}

            {step === 'processing' && run ? (
              <ImportStages
                state={run}
                onRetry={() => {
                  const again = retryRef.current;
                  if (again) again();
                }}
              />
            ) : null}

            {step === 'processing' && !run ? (
              <View className="items-center py-8">
                <ActivityIndicator size="large" color={brand.text} />
                <Text className="font-medium text-lantern-text mt-4">
                  Saving your note...
                </Text>
              </View>
            ) : null}

            {step === 'done' && result ? (
              <View className="items-center py-4 gap-3">
                <AppIcon name="checkmark-circle" size={48} color="#22c55e" />
                <Text className="font-semibold text-lantern-text">{result.noteTitle} saved</Text>
                {result.generating ? (
                  <Text className="text-caption text-lantern-text-secondary text-center">
                    Your study materials are being made. Keep working — we'll tell you when
                    they're ready, and they'll show up on Home.
                  </Text>
                ) : null}
                {/* The fork, when there is somewhere to fork TO. The Notes
                    screen's own Import door has no set, and a card that opened
                    nothing would be the dead door #135 removed from the upload
                    page — so that case keeps the single button. */}
                {canFork ? (
                  <View className="w-full">
                    <WhereNextFork
                      onViewMaterial={() => {
                        onOpenNote(result.noteId);
                        handleClose();
                      }}
                      onViewPlan={
                        onViewStudyPlan
                          ? () => {
                              onViewStudyPlan();
                              handleClose();
                            }
                          : undefined
                      }
                      onOpenSetHome={() => {
                        onOpenSetHome?.();
                        handleClose();
                      }}
                    />
                  </View>
                ) : (
                  <Button
                    fullWidth
                    onPress={() => {
                      onOpenNote(result.noteId);
                      handleClose();
                    }}
                  >
                    Open note
                  </Button>
                )}
                {onTurnIntoStudyProduct ? (
                  <Button
                    fullWidth
                    variant="secondary"
                    onPress={() => {
                      onTurnIntoStudyProduct(result);
                      handleClose();
                    }}
                  >
                    Turn this into a Study Product
                  </Button>
                ) : null}
              </View>
            ) : null}
      </View>
    </SheetShell>
  );
}
