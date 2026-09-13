import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import * as Speech from 'expo-speech';
import {
  RECAP_LENGTHS,
  RECAP_STYLES,
  applyRecapCommand,
  appendRecapTurn,
  buildRecapAsk,
  composeRecapNoteBody,
  currentRecapSegment,
  getNoteStudyContent,
  isRecapGeneratorMissing,
  isRecapNote,
  studioMaterials,
  newRecapNoteTitle,
  normalizeGeneratedRecap,
  scopeNoun,
  studySetNotePayload,
  parseRecapNoteBody,
  recapFromMaterial,
  recapProgress,
  recapSourceNotes,
  recapStudioPriceLine,
  recapStyleLabel,
  speakTextForSegment,
  type RecapLength,
  type RecapSession,
  type RecapStyle,
} from '@lantern/shared';
import { AI_FEATURE_CREDIT_COST, formatCreditCost } from '@lantern/shared/utils/aiCredits';
import type { StudyStackParamList } from '../../navigation/types';
import {
  Button,
  ScreenHeader,
  StudioGate,
  studioGate,
  T,
  type StudioGateAction,
} from '../../components/ui';
import { useTabBarClearance } from '../../components/layout/BottomTabBar';
import { useNotesStore } from '../../stores/notesStore';
import { useToastStore } from '../../stores/toastStore';
import { aiAskTutor, aiGenerateRecap } from '../../services/ai';
// The tertiary-ink token, not a hex: the `placeholderTextColor` literals in
// these studios had drifted off the palette (one was still #94a3b8, which the
// UI-02 pass retired for failing AA on the warm page ground). The prop takes a
// colour and never a class, so the value comes from the theme hook rather than
// the light palette, which would pin the placeholder to light ink in dark mode.
import { useColors } from '../../theme';

type Props = NativeStackScreenProps<StudyStackParamList, 'RecapStudio'>;

export function RecapStudioScreen({ navigation, route }: Props) {
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
  const recaps = useMemo(() => courseNotes.filter(isRecapNote), [courseNotes]);
  const sources = useMemo(() => recapSourceNotes(courseNotes), [courseNotes]);

  const [style, setStyle] = useState<RecapStyle>('podcast');
  const [length, setLength] = useState<RecapLength>('medium');
  const [sourceId, setSourceId] = useState(noteId || sources[0]?.id || '');
  const [session, setSession] = useState<RecapSession | null>(null);
  const [recapNoteId, setRecapNoteId] = useState<string | null>(null);
  const [askDraft, setAskDraft] = useState('');
  const [starting, setStarting] = useState(false);
  const [sending, setSending] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [pausedForAsk, setPausedForAsk] = useState(false);
  const [citeOpen, setCiteOpen] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recapNoteIdRef = useRef<string | null>(null);
  const playGen = useRef(0);
  recapNoteIdRef.current = recapNoteId;

  useEffect(() => {
    const open =
      selectedNote && selectedNote.id === noteId
        ? selectedNote
        : recaps.find((row) => row.id === noteId);
    if (!open || !isRecapNote(open)) return;
    const parsed = parseRecapNoteBody(open.body);
    if (!parsed) return;
    setSession(parsed);
    setRecapNoteId(open.id);
    setStyle(parsed.style);
    setLength(parsed.length);
  }, [noteId, recaps, selectedNote]);

  const persist = useCallback(
    (next: RecapSession, id: string | null) => {
      if (!id) return;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        void saveNote(id, { body: composeRecapNoteBody(next) }).catch(() => undefined);
      }, 600);
    },
    [saveNote]
  );

  const stopSpeech = () => {
    playGen.current += 1;
    Speech.stop();
    setSpeaking(false);
  };

  const speakSegment = (next: RecapSession) => {
    const beat = currentRecapSegment(next);
    if (!beat || next.status === 'ended') return;
    const gen = ++playGen.current;
    Speech.stop();
    setSpeaking(true);
    Speech.speak(speakTextForSegment(beat), {
      rate: next.speechRate,
      onDone: () => {
        if (gen !== playGen.current) return;
        setSpeaking(false);
        setSession((current) => {
          if (!current) return current;
          const advanced = applyRecapCommand(current, { type: 'next' });
          if (advanced.segmentIndex === current.segmentIndex) return current;
          persist(advanced, recapNoteIdRef.current);
          speakSegment(advanced);
          return advanced;
        });
      },
      onStopped: () => {
        if (gen !== playGen.current) return;
        setSpeaking(false);
      },
      onError: () => {
        if (gen !== playGen.current) return;
        setSpeaking(false);
      },
    });
  };

  useEffect(
    () => () => {
      Speech.stop();
      if (saveTimer.current) clearTimeout(saveTimer.current);
    },
    []
  );

  const updateSession = (recipe: (current: RecapSession) => RecapSession) => {
    setSession((current) => {
      if (!current) return current;
      const next = recipe(current);
      persist(next, recapNoteId);
      return next;
    });
  };

  const startFromNote = async (chosen: RecapStyle, chosenLength: RecapLength) => {
    const note = courseNotes.find((row) => row.id === sourceId) || sources[0];
    if (!note) {
      showToast('Pick a note with enough study content.', 'info');
      return;
    }
    const text = getNoteStudyContent(note);
    setStarting(true);
    try {
      let next: RecapSession;
      try {
        const generated = await aiGenerateRecap(text, {
          style: chosen,
          length: chosenLength,
          sourceTitle: note.title || 'Untitled note',
        });
        next = normalizeGeneratedRecap(
          { segments: generated.segments },
          {
            style: chosen,
            length: chosenLength,
            sourceNoteId: note.id,
            sourceTitle: generated.sourceTitle,
          }
        );
      } catch (error) {
        if (!isRecapGeneratorMissing(error)) throw error;
        next = recapFromMaterial({
          style: chosen,
          length: chosenLength,
          sourceNoteId: note.id,
          sourceTitle: note.title || 'Untitled note',
          notes: text,
        });
      }
      if (next.segments.length === 0) {
        showToast('Could not build a recap from that note.', 'error');
        return;
      }
      const created = await createNote({
        title: newRecapNoteTitle(chosen, note.title || 'Untitled note'),
        body: composeRecapNoteBody(next),
        ...studySetNotePayload({ courseId, studySetId }),
      });
      setRecapNoteId(created.id);
      recapNoteIdRef.current = created.id;
      setSession(next);
      setPausedForAsk(false);
      await loadNote(created.id);
      speakSegment(next);
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not start the recap.', 'error');
    } finally {
      setStarting(false);
    }
  };

  const sendAsk = async (raw: string) => {
    const text = raw.trim();
    const beat = session ? currentRecapSegment(session) : null;
    if (!text || !beat || !session) return;
    stopSpeech();
    setPausedForAsk(true);
    setSending(true);
    setAskDraft('');
    const withStudent = appendRecapTurn(session, { role: 'student', text });
    setSession(withStudent);
    persist(withStudent, recapNoteId);
    try {
      const reply = await aiAskTutor(
        buildRecapAsk({ question: text, segment: beat, sourceTitle: session.sourceTitle }),
        { subject: session.sourceTitle, recentTopics: [beat.title] }
      );
      const withTutor = appendRecapTurn(withStudent, { role: 'tutor', text: reply.answer });
      setSession(withTutor);
      persist(withTutor, recapNoteId);
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not ask that.', 'error');
    } finally {
      setSending(false);
    }
  };

  const segment = session ? currentRecapSegment(session) : null;
  const progress = session ? recapProgress(session) : { current: 0, total: 0, percent: 0 };

  /**
   * Where a gate button lands. Every target stays INSIDE the container the
   * studio was opened on, so the student comes back to a studio that now
   * works rather than to the global library they walked away from.
   */
  const runGateAction = (action: StudioGateAction) => {
    if (action.id === 'import_materials') {
      if (studySetId) {
        navigation.navigate('StudySetUpload', { studySetId, courseId, courseLabel });
      } else {
        navigation.navigate('Library', { tab: 'notes' });
      }
      return;
    }
    if (action.id === 'create_note') {
      void (async () => {
        try {
          const created = await createNote({
            title: 'Untitled note',
            body: '',
            ...studySetNotePayload({ courseId, studySetId }),
          });
          navigation.navigate('NoteEditor', { noteId: created.id });
        } catch {
          showToast('Could not create a note. Check your connection and try again.', 'error');
        }
      })();
      return;
    }
    if (studySetId) {
      navigation.navigate('StudySetLibrary', { studySetId, courseId, courseLabel, kind: 'notes' });
    } else {
      navigation.navigate('Library', { tab: 'notes' });
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-lantern-background" edges={['top']}>
      <ScreenHeader title={courseLabel || 'Recap'} onBack={() => navigation.goBack()} />
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ padding: 16, paddingBottom: tabBarClearance, gap: 12 }}
        keyboardShouldPersistTaps="handled"
      >
        {!session ? (
          <View className="gap-3">
            <T.Heading>Recap</T.Heading>
            <T.Body tone="secondary">{recapStudioPriceLine()}</T.Body>
            <T.Caption tone="tertiary">
              A listen-through of the material. Narration still reads the page itself.
            </T.Caption>
            {recaps.length > 0 ? (
              <View className="gap-2">
                <T.Label tone="secondary">RESUME</T.Label>
                {recaps.map((note) => (
                  <Pressable
                    key={note.id}
                    onPress={() => {
                      void loadNote(note.id);
                      const parsed = parseRecapNoteBody(note.body);
                      if (parsed) {
                        setSession(parsed);
                        setRecapNoteId(note.id);
                      }
                    }}
                    className="min-h-[44px] rounded-xl border border-lantern-border px-3 py-2"
                  >
                    <T.Body>{note.title || 'Recap'}</T.Body>
                  </Pressable>
                ))}
              </View>
            ) : null}
            {sources.length === 0 ? (
              // Was one grey sentence on bare ground (SF2 evidence §4.2): the
              // studio named its blocker and offered nothing to press. Same
              // sentence, now with the two ways out of it and an honest price
              // for the step it leads to.
              <StudioGate
                feature="ai"
                icon="headphones"
                content={studioGate({
                  studio: 'recap',
                  reason: 'no_material',
                  body: `Import or write a note in this ${scopeNoun(studySetId, courseId)} first. The recap is built from that material.`,
                  cost: formatCreditCost(AI_FEATURE_CREDIT_COST),
                  costVerb: 'Building a recap',
                })}
                onAction={runGateAction}
              />
            ) : (
              <View className="gap-2">
                <T.Label tone="secondary">NEW RECAP</T.Label>
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
                {RECAP_STYLES.map((item) => (
                  <Pressable
                    key={item.id}
                    onPress={() => setStyle(item.id)}
                    className={`min-h-[44px] rounded-xl border px-3 py-2 ${
                      style === item.id
                        ? 'border-lantern-feature-ai-ink bg-lantern-feature-ai-tint'
                        : 'border-lantern-border'
                    }`}
                  >
                    <T.Body>
                      {item.label} · {item.promise}
                    </T.Body>
                  </Pressable>
                ))}
                {RECAP_LENGTHS.map((item) => (
                  <Pressable
                    key={item.id}
                    onPress={() => setLength(item.id)}
                    className={`min-h-[44px] rounded-xl border px-3 py-2 ${
                      length === item.id
                        ? 'border-lantern-feature-ai-ink bg-lantern-feature-ai-tint'
                        : 'border-lantern-border'
                    }`}
                  >
                    <T.Body>
                      {item.label} · {item.promise}
                    </T.Body>
                  </Pressable>
                ))}
                <Button disabled={starting} onPress={() => void startFromNote(style, length)}>
                  {starting ? 'Building the recap…' : `Start · ${formatCreditCost(AI_FEATURE_CREDIT_COST)}`}
                </Button>
              </View>
            )}
          </View>
        ) : (
          <View className="gap-3">
            <T.Caption tone="secondary">
              {recapStyleLabel(session.style)} · {progress.current} of {progress.total} ·{' '}
              {session.length.toUpperCase()}
            </T.Caption>
            <T.Caption tone="secondary">{session.sourceTitle}</T.Caption>
            <T.Heading>{segment?.title || 'Recap'}</T.Heading>
            <T.Body>{segment?.spoken}</T.Body>
            {segment?.sourceCite ? (
              <Pressable onPress={() => setCiteOpen((open) => !open)} className="min-h-[44px]">
                <T.Caption tone="secondary">From the notes</T.Caption>
                {citeOpen ? <T.Caption>“{segment.sourceCite}”</T.Caption> : null}
              </Pressable>
            ) : null}
            {pausedForAsk ? (
              <T.Caption tone="secondary">Paused to answer. Resume when you are ready.</T.Caption>
            ) : null}
            <View className="flex-row flex-wrap gap-2">
              <Button
                size="sm"
                onPress={() => {
                  if (speaking) stopSpeech();
                  else if (session) {
                    setPausedForAsk(false);
                    speakSegment(session);
                  }
                }}
              >
                {speaking ? 'Pause' : 'Play'}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onPress={() => {
                  stopSpeech();
                  setSession((current) => {
                    if (!current) return current;
                    const next = applyRecapCommand(current, { type: 'next' });
                    persist(next, recapNoteId);
                    if (!pausedForAsk) speakSegment(next);
                    return next;
                  });
                }}
              >
                Skip
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onPress={() => updateSession((current) => applyRecapCommand(current, { type: 'slower' }))}
              >
                Slower
              </Button>
              {pausedForAsk ? (
                <Button
                  size="sm"
                  variant="secondary"
                  onPress={() => {
                    setPausedForAsk(false);
                    if (session) speakSegment(session);
                  }}
                >
                  Resume
                </Button>
              ) : null}
              <Button
                size="sm"
                variant="secondary"
                onPress={() => {
                  stopSpeech();
                  updateSession((current) => applyRecapCommand(current, { type: 'end' }));
                }}
              >
                End
              </Button>
            </View>
            <T.Label tone="secondary">TRANSCRIPT</T.Label>
            {session.segments.map((row, index) => {
              const current = row.id === segment?.id;
              return (
                <Pressable
                  key={row.id}
                  onPress={() => {
                    setCiteOpen(false);
                    stopSpeech();
                    setSession((currentSession) => {
                      if (!currentSession) return currentSession;
                      const next = applyRecapCommand(currentSession, {
                        type: 'jump',
                        segmentNumber: index + 1,
                      });
                      persist(next, recapNoteId);
                      return next;
                    });
                  }}
                  className={`min-h-[44px] rounded-xl px-3 py-2 ${
                    current ? 'bg-lantern-feature-ai-tint' : ''
                  }`}
                >
                  <T.Body>
                    {index + 1}. {row.title}
                  </T.Body>
                </Pressable>
              );
            })}
            {session.transcript.slice(-6).map((turn, index) => (
              <T.Caption key={`${turn.role}-${index}`}>
                {turn.role === 'student' ? 'You' : 'Tutor'}: {turn.text}
              </T.Caption>
            ))}
            <TextInput
              value={askDraft}
              onChangeText={setAskDraft}
              placeholder="Ask while listening"
              className="min-h-[44px] rounded-xl border border-lantern-border px-3 text-body text-lantern-text"
              placeholderTextColor={colors.textTertiary}
            />
            <Button disabled={sending || !askDraft.trim()} onPress={() => void sendAsk(askDraft)}>
              {sending ? 'Asking…' : `Ask · ${formatCreditCost(AI_FEATURE_CREDIT_COST)}`}
            </Button>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
