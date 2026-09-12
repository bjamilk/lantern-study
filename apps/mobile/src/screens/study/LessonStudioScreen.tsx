import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import * as Speech from 'expo-speech';
import {
  LESSON_MODES,
  applyLessonCommand,
  appendLessonTurn,
  buildLessonAsk,
  canOpenTopic,
  composeLessonNoteBody,
  currentLessonPage,
  currentLessonTopic,
  getNoteStudyContent,
  isLessonGeneratorMissing,
  isLessonNote,
  lessonFromMaterial,
  lessonProgress,
  lessonSourceNotes,
  lessonStudioPriceLine,
  studioMaterials,
  newLessonNoteTitle,
  normalizeGeneratedLesson,
  studySetNotePayload,
  parseLessonCommand,
  parseLessonNoteBody,
  quizItemsFromLesson,
  speakTextForPage,
  type LessonMode,
  type LessonSession,
} from '@lantern/shared';
import { AI_FEATURE_CREDIT_COST, formatCreditCost } from '@lantern/shared/utils/aiCredits';
import type { StudyStackParamList } from '../../navigation/types';
import { Button, ScreenHeader, T } from '../../components/ui';
import { useTabBarClearance } from '../../components/layout/BottomTabBar';
import { useNotesStore } from '../../stores/notesStore';
import { useToastStore } from '../../stores/toastStore';
import { useLectureRecordingStore } from '../../stores/lectureRecordingStore';
import { aiAskTutor, aiGenerateLesson, aiGenerateQuestions } from '../../services/ai';
import { recognizeOnce } from '../../services/liveSpeech';
// The tertiary-ink token, not a hex: the `placeholderTextColor` literals in
// these studios had drifted off the palette (one was still #94a3b8, which the
// UI-02 pass retired for failing AA on the warm page ground). The prop takes a
// colour and never a class, so the value comes from the theme hook rather than
// the light palette, which would pin the placeholder to light ink in dark mode.
import { useColors } from '../../theme';

type Props = NativeStackScreenProps<StudyStackParamList, 'LessonStudio'>;

export function LessonStudioScreen({ navigation, route }: Props) {
  const colors = useColors();
  const { courseId, courseLabel, noteId, studySetId } = route.params;
  const tabBarClearance = useTabBarClearance(16);
  const notes = useNotesStore((s) => s.notes);
  const selectedNote = useNotesStore((s) => s.selectedNote);
  const createNote = useNotesStore((s) => s.createNote);
  const saveNote = useNotesStore((s) => s.saveNote);
  const loadNote = useNotesStore((s) => s.loadNote);
  const showToast = useToastStore((s) => s.showToast);

  const courseNotes = useMemo(
    () => studioMaterials(notes, { studySetId, courseId }),
    [notes, courseId, studySetId]
  );
  const lessons = useMemo(() => courseNotes.filter(isLessonNote), [courseNotes]);
  const sources = useMemo(() => lessonSourceNotes(courseNotes), [courseNotes]);

  const [mode, setMode] = useState<LessonMode>('explore');
  const [sourceId, setSourceId] = useState(noteId || sources[0]?.id || '');
  const [session, setSession] = useState<LessonSession | null>(null);
  const [lessonNoteId, setLessonNoteId] = useState<string | null>(null);
  const [askDraft, setAskDraft] = useState('');
  const [starting, setStarting] = useState(false);
  const [sending, setSending] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [listening, setListening] = useState(false);
  const [commandDraft, setCommandDraft] = useState('');
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoSpokeRef = useRef<string | null>(null);
  const lectureStatus = useLectureRecordingStore((s) => s.status);

  useEffect(() => {
    const open = selectedNote && selectedNote.id === noteId ? selectedNote : lessons.find((row) => row.id === noteId);
    if (!open || !isLessonNote(open)) return;
    const parsed = parseLessonNoteBody(open.body);
    if (!parsed) return;
    setSession(parsed);
    setLessonNoteId(open.id);
    setMode(parsed.mode);
    if (autoSpokeRef.current !== open.id && parsed.status !== 'ended') {
      autoSpokeRef.current = open.id;
      Speech.stop();
      const page = currentLessonPage(parsed);
      if (page) {
        Speech.speak(speakTextForPage(page), {
          rate: parsed.speechRate,
          onDone: () => setSpeaking(false),
          onStopped: () => setSpeaking(false),
          onError: () => setSpeaking(false),
        });
        setSpeaking(true);
      }
    }
  }, [lessons, noteId, selectedNote]);

  const persist = useCallback(
    (next: LessonSession, id: string | null) => {
      if (!id) return;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        void saveNote(id, { body: composeLessonNoteBody(next) }).catch(() => undefined);
      }, 600);
    },
    [saveNote]
  );

  const updateSession = (recipe: (current: LessonSession) => LessonSession) => {
    setSession((current) => {
      if (!current) return current;
      const next = recipe(current);
      persist(next, lessonNoteId);
      return next;
    });
  };

  const stopSpeech = () => {
    Speech.stop();
    setSpeaking(false);
  };

  const speakPage = (next: LessonSession) => {
    const page = currentLessonPage(next);
    if (!page || next.status === 'ended') return;
    stopSpeech();
    setSpeaking(true);
    Speech.speak(speakTextForPage(page), {
      rate: next.speechRate,
      onDone: () => setSpeaking(false),
      onStopped: () => setSpeaking(false),
      onError: () => setSpeaking(false),
    });
  };

  useEffect(() => () => {
    Speech.stop();
    if (saveTimer.current) clearTimeout(saveTimer.current);
  }, []);

  const startFromNote = async (chosen: LessonMode) => {
    const note = courseNotes.find((row) => row.id === sourceId) || sources[0];
    if (!note) {
      showToast('Pick a note with enough study content.', 'info');
      return;
    }
    const text = getNoteStudyContent(note);
    setStarting(true);
    try {
      let next: LessonSession;
      try {
        const generated = await aiGenerateLesson(text, {
          mode: chosen,
          sourceTitle: note.title || 'Untitled note',
        });
        next = normalizeGeneratedLesson(
          {
            topics: generated.plan.topics.map((topic) => ({
              title: topic.title,
              pages: generated.pages
                .filter((page) => page.topicId === topic.id)
                .map((page) => ({ title: page.title, body: page.body, check: page.check })),
            })),
          },
          { mode: chosen, sourceNoteId: note.id, sourceTitle: generated.sourceTitle }
        );
      } catch (error) {
        if (!isLessonGeneratorMissing(error)) throw error;
        let questions: unknown[] | undefined;
        try {
          const generated = await aiGenerateQuestions(text, { count: 8, subject: note.title });
          questions = generated.questions;
        } catch {
          questions = undefined;
        }
        next = lessonFromMaterial({
          mode: chosen,
          sourceNoteId: note.id,
          sourceTitle: note.title || 'Untitled note',
          notes: text,
          questions,
        });
      }
      if (next.pages.length === 0) {
        showToast('Could not build a lesson from that note.', 'error');
        return;
      }
      const created = await createNote({
        title: newLessonNoteTitle(chosen, note.title || 'Untitled note'),
        body: composeLessonNoteBody(next),
        ...studySetNotePayload({ courseId, studySetId }),
      });
      setLessonNoteId(created.id);
      setSession(next);
      autoSpokeRef.current = created.id;
      await loadNote(created.id);
      speakPage(next);
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not start the lesson.', 'error');
    } finally {
      setStarting(false);
    }
  };

  const sendChat = async (raw: string) => {
    const text = raw.trim();
    const page = session ? currentLessonPage(session) : null;
    if (!text || !page || !session) return;
    setSending(true);
    setAskDraft('');
    const withStudent = appendLessonTurn(session, { role: 'student', text });
    setSession(withStudent);
    persist(withStudent, lessonNoteId);
    try {
      const reply = await aiAskTutor(
        buildLessonAsk({ question: text, page, sourceTitle: session.sourceTitle }),
        { subject: session.sourceTitle, recentTopics: [page.title] }
      );
      const withTutor = appendLessonTurn(withStudent, { role: 'tutor', text: reply.answer });
      setSession(withTutor);
      persist(withTutor, lessonNoteId);
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not ask that.', 'error');
    } finally {
      setSending(false);
    }
  };

  const runCommand = (raw: string) => {
    const command = parseLessonCommand(raw);
    if (command.type === 'chat') {
      if (command.text) void sendChat(command.text);
      return;
    }
    if (command.type === 'pause') {
      stopSpeech();
      return;
    }
    setSession((current) => {
      if (!current) return current;
      const next = applyLessonCommand(current, command);
      persist(next, lessonNoteId);
      if (command.type === 'next' || command.type === 'prev' || command.type === 'jump') {
        speakPage(next);
      }
      return next;
    });
  };

  const listenForCommand = async () => {
    if (listening) return;
    if (lectureStatus !== 'idle') {
      showToast('A lecture is using the microphone.', 'info');
      return;
    }
    setListening(true);
    try {
      const live = await recognizeOnce();
      if (live) {
        setCommandDraft(live);
        runCommand(live);
        return;
      }
      showToast('Type next, quiz me, slower, or faster if this phone cannot hear commands.', 'info');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not hear that command.', 'error');
    } finally {
      setListening(false);
    }
  };

  const page = session ? currentLessonPage(session) : null;
  const topic = session ? currentLessonTopic(session) : null;
  const progress = session ? lessonProgress(session) : { done: 0, total: 0, percent: 0 };
  const check = page?.check;
  const quizItems = session ? quizItemsFromLesson(session) : [];

  return (
    <SafeAreaView className="flex-1 bg-lantern-background" edges={['top']}>
      <ScreenHeader title={courseLabel || 'Lesson'} onBack={() => navigation.goBack()} />
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ padding: 16, paddingBottom: tabBarClearance, gap: 12 }}
        keyboardShouldPersistTaps="handled"
      >
        {!session ? (
          <View className="gap-3">
            <T.Heading>Lesson</T.Heading>
            <T.Body tone="secondary">{lessonStudioPriceLine()}</T.Body>
            {lessons.length > 0 ? (
              <View className="gap-2">
                <T.Label tone="secondary">RESUME</T.Label>
                {lessons.map((note) => (
                  <Pressable
                    key={note.id}
                    onPress={() => {
                      void loadNote(note.id);
                      const parsed = parseLessonNoteBody(note.body);
                      if (parsed) {
                        setSession(parsed);
                        setLessonNoteId(note.id);
                        autoSpokeRef.current = note.id;
                        speakPage(parsed);
                      }
                    }}
                    className="min-h-[44px] rounded-xl border border-lantern-border px-3 py-2"
                  >
                    <T.Body>{note.title || 'Lesson'}</T.Body>
                  </Pressable>
                ))}
              </View>
            ) : null}
            {sources.length === 0 ? (
              <T.Body tone="secondary">
                Import or write a note in this course first. The lesson is built from that material.
              </T.Body>
            ) : (
              <View className="gap-2">
                <T.Label tone="secondary">NEW LESSON</T.Label>
                {sources.map((note) => (
                  <Pressable
                    key={note.id}
                    onPress={() => setSourceId(note.id)}
                    className={`min-h-[44px] rounded-xl border px-3 py-2 ${
                      sourceId === note.id
                        ? 'border-lantern-feature-ai-ink bg-lantern-feature-ai-tint'
                        : 'border-lantern-border'
                    }`}
                  >
                    <T.Body>{note.title || 'Untitled note'}</T.Body>
                  </Pressable>
                ))}
                {LESSON_MODES.map((item) => (
                  <Pressable
                    key={item.id}
                    onPress={() => setMode(item.id)}
                    className={`min-h-[44px] rounded-xl border px-3 py-2 ${
                      mode === item.id
                        ? 'border-lantern-feature-ai-ink bg-lantern-feature-ai-tint'
                        : 'border-lantern-border'
                    }`}
                  >
                    <T.Body>
                      {item.label} · {item.promise}
                    </T.Body>
                  </Pressable>
                ))}
                <Button disabled={starting} onPress={() => void startFromNote(mode)}>
                  {starting ? 'Building the lesson…' : `Start · ${formatCreditCost(AI_FEATURE_CREDIT_COST)}`}
                </Button>
              </View>
            )}
          </View>
        ) : (
          <View className="gap-3">
            <T.Caption tone="secondary">
              {session.mode === 'mastery' ? 'Mastery' : 'Explore'} · {progress.done} of {progress.total} topics
            </T.Caption>
            <T.Caption tone="secondary">{topic?.title}</T.Caption>
            <T.Heading>{page?.title || 'Lesson'}</T.Heading>
            <T.Body>{page?.body}</T.Body>
            {session.checkOpen && check ? (
              <View className="rounded-xl border border-lantern-border bg-lantern-background p-3 gap-1">
                <T.Label tone="secondary">CHECK</T.Label>
                <T.Body>{check.stem}</T.Body>
                <T.Caption tone="tertiary">Answer: {check.correctAnswer}</T.Caption>
              </View>
            ) : null}
            <View className="flex-row flex-wrap gap-2">
              <Button
                size="sm"
                variant="secondary"
                onPress={() => {
                  stopSpeech();
                  updateSession((current) => applyLessonCommand(current, { type: 'prev' }));
                }}
              >
                Back
              </Button>
              <Button
                size="sm"
                onPress={() => {
                  stopSpeech();
                  setSession((current) => {
                    if (!current) return current;
                    const next = applyLessonCommand(current, { type: 'next' });
                    persist(next, lessonNoteId);
                    speakPage(next);
                    return next;
                  });
                }}
              >
                Next
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onPress={() => updateSession((current) => applyLessonCommand(current, { type: 'complete' }))}
              >
                Mark complete
              </Button>
              {check ? (
                <Button
                  size="sm"
                  variant="secondary"
                  onPress={() => updateSession((current) => applyLessonCommand(current, { type: 'quiz_me' }))}
                >
                  Quiz me
                </Button>
              ) : null}
            </View>
            <T.Label tone="secondary">PLAN</T.Label>
            {session.plan.topics.map((row, index) => {
              const locked = !canOpenTopic(session, row.id);
              const current = row.id === topic?.id;
              const done = session.completedTopicIds.includes(row.id);
              return (
                <Pressable
                  key={row.id}
                  disabled={locked}
                  onPress={() => {
                    stopSpeech();
                    setSession((currentSession) => {
                      if (!currentSession) return currentSession;
                      const next = applyLessonCommand(currentSession, {
                        type: 'jump',
                        topicNumber: index + 1,
                      });
                      persist(next, lessonNoteId);
                      speakPage(next);
                      return next;
                    });
                  }}
                  className={`min-h-[44px] rounded-xl px-3 py-2 ${
                    current ? 'bg-lantern-feature-ai-tint' : ''
                  } ${locked ? 'opacity-50' : ''}`}
                >
                  <T.Body>
                    {done ? '✓ ' : `${index + 1}. `}
                    {row.title}
                  </T.Body>
                </Pressable>
              );
            })}
            <View className="flex-row flex-wrap gap-2">
              <Button
                size="sm"
                variant="secondary"
                onPress={() => {
                  if (speaking) stopSpeech();
                  else if (session) speakPage(session);
                }}
              >
                {speaking ? 'Pause voice' : 'Speak'}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onPress={() => updateSession((current) => applyLessonCommand(current, { type: 'slower' }))}
              >
                Slower
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onPress={() => updateSession((current) => applyLessonCommand(current, { type: 'faster' }))}
              >
                Faster
              </Button>
              {quizItems.length > 0 ? (
                <Button
                  size="sm"
                  variant="secondary"
                  onPress={() =>
                    navigation.navigate('AdaptiveQuiz', {
                      courseId,
                      courseLabel,
                      noteId: session.sourceNoteId,
                      seedItems: quizItems,
                    })
                  }
                >
                  Turn into quiz
                </Button>
              ) : null}
              <Button
                size="sm"
                variant="secondary"
                onPress={() => {
                  stopSpeech();
                  updateSession((current) => applyLessonCommand(current, { type: 'end' }));
                }}
              >
                End
              </Button>
            </View>
            {session.transcript.slice(-6).map((turn, index) => (
              <T.Caption key={`${turn.role}-${index}`}>
                {turn.role === 'student' ? 'You' : 'Tutor'}: {turn.text}
              </T.Caption>
            ))}
            <T.Caption tone="secondary">Say next, quiz me, slower, faster, or pause.</T.Caption>
            <TextInput
              value={commandDraft}
              onChangeText={setCommandDraft}
              placeholder="Voice command"
              className="min-h-[44px] rounded-xl border border-lantern-border px-3 text-body text-lantern-text"
              placeholderTextColor={colors.textTertiary}
            />
            <View className="flex-row flex-wrap gap-2">
              <Button
                size="sm"
                variant="secondary"
                disabled={listening}
                onPress={() => void listenForCommand()}
              >
                {listening ? 'Listening…' : 'Listen'}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={!commandDraft.trim()}
                onPress={() => {
                  const text = commandDraft.trim();
                  setCommandDraft('');
                  runCommand(text);
                }}
              >
                Run command
              </Button>
            </View>
            <TextInput
              value={askDraft}
              onChangeText={setAskDraft}
              placeholder="Ask about this page"
              className="min-h-[44px] rounded-xl border border-lantern-border px-3 text-body text-lantern-text"
              placeholderTextColor={colors.textTertiary}
            />
            <Button disabled={sending || !askDraft.trim()} onPress={() => void sendChat(askDraft)}>
              {sending ? 'Asking…' : `Ask · ${formatCreditCost(AI_FEATURE_CREDIT_COST)}`}
            </Button>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
