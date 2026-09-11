import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  lessonSourceNotes,
  lessonProgress,
  lessonStudioPriceLine,
  newLessonNoteTitle,
  normalizeGeneratedLesson,
  studySetNotePayload,
  parseLessonCommand,
  parseLessonNoteBody,
  quizItemsFromLesson,
  speakTextForPage,
  type LessonMode,
  type LessonSession,
  type TurnIntoTargetId,
} from '@lantern/shared';
import { AI_FEATURE_CREDIT_COST, formatCreditCost } from '@lantern/shared/utils/aiCredits';
import type { StudyNote } from '../../types';
import { Button } from '../ui';
import { FEATURE_INK_TEXT, FEATURE_TINT_BG } from '../ui/featureClasses';
import { TurnIntoMenu } from './TurnIntoMenu';
import { cancelSpeech, isSpeechSupported, speak } from '../narration/speechEngine';
import { useNotesStore } from '../../stores/notesStore';
import { useCompanionStore } from '../../stores/companionStore';
import { useToastStore } from '../../stores/toastStore';
import { useLectureRecordingStore } from '../../stores/lectureRecordingStore';
import { aiAskTutor, aiGenerateLesson, aiGenerateQuestions } from '../../services/ai';

interface LessonStudioProps {
  courseId: string;
  studySetId?: string;
  theme: 'light' | 'dark';
  notes: StudyNote[];
  selectedNote: StudyNote | null;
  turning?: boolean;
  onTurnInto: (target: TurnIntoTargetId) => void;
  onOpenQuiz: (items: ReturnType<typeof quizItemsFromLesson>) => void;
  onNoteReady: (noteId: string) => Promise<void>;
}

function sessionFromGenerated(
  generated: Awaited<ReturnType<typeof aiGenerateLesson>>,
  sourceNoteId: string,
  mode: LessonMode
): LessonSession {
  return normalizeGeneratedLesson(
    {
      topics: generated.plan.topics.map((topic) => ({
        title: topic.title,
        pages: generated.pages
          .filter((page) => page.topicId === topic.id)
          .map((page) => ({ title: page.title, body: page.body, check: page.check })),
      })),
    },
    { mode, sourceNoteId, sourceTitle: generated.sourceTitle }
  );
}

interface BrowserSpeechRecognition {
  lang: string;
  interimResults: boolean;
  start: () => void;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript?: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
}

function SpeechRecognitionCtor(): (new () => BrowserSpeechRecognition) | null {
  if (typeof window === 'undefined') return null;
  const w = window as Window & {
    SpeechRecognition?: new () => BrowserSpeechRecognition;
    webkitSpeechRecognition?: new () => BrowserSpeechRecognition;
  };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

export const LessonStudio: React.FC<LessonStudioProps> = ({
  courseId,
  studySetId,
  notes,
  selectedNote,
  turning,
  onTurnInto,
  onOpenQuiz,
  onNoteReady,
}) => {
  const createNote = useNotesStore((s) => s.createNote);
  const saveNote = useNotesStore((s) => s.saveNote);
  const openWithMessage = useCompanionStore((s) => s.openWithMessage);
  const showToast = useToastStore((s) => s.showToast);
  const lectureStatus = useLectureRecordingStore((s) => s.status);

  const lessons = useMemo(() => notes.filter(isLessonNote), [notes]);
  const sources = useMemo(() => lessonSourceNotes(notes), [notes]);

  const resumed =
    selectedNote && isLessonNote(selectedNote) ? parseLessonNoteBody(selectedNote.body) : null;
  const [mode, setMode] = useState<LessonMode>(resumed?.mode || 'explore');
  const [sourceId, setSourceId] = useState<string>(sources[0]?.id || '');
  const [session, setSession] = useState<LessonSession | null>(resumed);
  const [lessonNoteId, setLessonNoteId] = useState<string | null>(
    resumed && selectedNote ? selectedNote.id : null
  );
  const [askDraft, setAskDraft] = useState('');
  const [starting, setStarting] = useState(false);
  const [sending, setSending] = useState(false);
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const resumeBody = selectedNote && isLessonNote(selectedNote) ? selectedNote.body : '';
  useEffect(() => {
    if (sourceId && sources.some((note) => note.id === sourceId)) return;
    setSourceId(sources[0]?.id || '');
  }, [sourceId, sources]);
  useEffect(() => {
    if (!selectedNote || !isLessonNote(selectedNote)) return;
    const parsed = parseLessonNoteBody(selectedNote.body);
    if (!parsed) return;
    setSession(parsed);
    setLessonNoteId(selectedNote.id);
    setMode(parsed.mode);
  }, [selectedNote?.id, resumeBody]);

  const persist = useCallback(
    (next: LessonSession, noteId: string | null) => {
      if (!noteId) return;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        void saveNote(noteId, { body: composeLessonNoteBody(next) }).catch(() => undefined);
      }, 600);
    },
    [saveNote]
  );

  const updateSession = useCallback(
    (recipe: (current: LessonSession) => LessonSession) => {
      setSession((current) => {
        if (!current) return current;
        const next = recipe(current);
        persist(next, lessonNoteId);
        return next;
      });
    },
    [lessonNoteId, persist]
  );

  const page = session ? currentLessonPage(session) : null;
  const topic = session ? currentLessonTopic(session) : null;
  const progress = session ? lessonProgress(session) : { done: 0, total: 0, percent: 0 };

  useEffect(() => {
    if (!page || !session || session.status === 'ended') {
      cancelSpeech();
      setSpeaking(false);
      return;
    }
    if (!isSpeechSupported()) return;
    setSpeaking(true);
    const stop = speak({
      text: speakTextForPage(page),
      rate: session.speechRate,
      onEnd: () => setSpeaking(false),
      onError: () => setSpeaking(false),
    });
    return () => {
      stop();
      setSpeaking(false);
    };
  }, [page?.id, session?.speechRate, session?.status]);

  useEffect(() => () => {
    cancelSpeech();
    if (saveTimer.current) clearTimeout(saveTimer.current);
  }, []);

  const startFromNote = async (note: StudyNote, chosen: LessonMode) => {
    const text = getNoteStudyContent(note);
    if (text.trim().length < 50) {
      showToast('Pick a note with enough study content.', 'info');
      return;
    }
    setStarting(true);
    try {
      let next: LessonSession;
      try {
        const generated = await aiGenerateLesson(text, {
          mode: chosen,
          sourceTitle: note.title || 'Untitled note',
        });
        next = sessionFromGenerated(generated, note.id, chosen);
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
      await onNoteReady(created.id);
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not start the lesson.', 'error');
    } finally {
      setStarting(false);
    }
  };

  const sendChat = async (raw: string) => {
    const text = raw.trim();
    if (!text || !page || !session) return;
    setSending(true);
    setAskDraft('');
    const withStudent = appendLessonTurn(session, { role: 'student', text });
    setSession(withStudent);
    persist(withStudent, lessonNoteId);
    try {
      const reply = await aiAskTutor(buildLessonAsk({ question: text, page, sourceTitle: session.sourceTitle }), {
        subject: session.sourceTitle,
        recentTopics: [page.title],
      });
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
      void sendChat(command.text || raw);
      return;
    }
    if (command.type === 'pause') {
      cancelSpeech();
      setSpeaking(false);
      return;
    }
    updateSession((current) => applyLessonCommand(current, command));
  };

  const startListening = () => {
    const Ctor = SpeechRecognitionCtor();
    if (!Ctor) {
      showToast('Voice commands need Chrome speech on this browser.', 'info');
      return;
    }
    if (lectureStatus !== 'idle') {
      showToast('A lecture is using the microphone.', 'info');
      return;
    }
    const rec = new Ctor();
    rec.lang = 'en-US';
    rec.interimResults = false;
    rec.onresult = (event) => {
      const text = Array.from(event.results)
        .map((result) => result[0]?.transcript || '')
        .join(' ')
        .trim();
      if (text) runCommand(text);
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    setListening(true);
    rec.start();
  };

  if (!session) {
    const source = sources.find((note) => note.id === sourceId) || sources[0];
    return (
      <div className="flex-1 min-h-0 overflow-y-auto rounded-lantern-xl border border-lantern-border bg-lantern-surface p-4 space-y-4">
        <div>
          <h2 className="text-heading">Lesson</h2>
          <p className="text-body text-lantern-text-secondary mt-1">{lessonStudioPriceLine()}</p>
        </div>
        {lessons.length > 0 ? (
          <div className="space-y-2">
            <h3 className="text-label uppercase text-lantern-text-secondary">Resume</h3>
            {lessons.map((note) => (
              <button
                key={note.id}
                type="button"
                onClick={() => void onNoteReady(note.id)}
                className="w-full text-left rounded-xl border border-lantern-border px-3 py-2 min-h-[44px] hover:bg-lantern-background-secondary"
              >
                <span className="text-body font-semibold">{note.title || 'Lesson'}</span>
              </button>
            ))}
          </div>
        ) : null}
        <div className="space-y-2">
          <h3 className="text-label uppercase text-lantern-text-secondary">New lesson</h3>
          {sources.length === 0 ? (
            <p className="text-body text-lantern-text-secondary">
              Import or write a note in this course first. The lesson is built from that material.
            </p>
          ) : (
            <>
              <label className="block text-caption text-lantern-text-secondary" htmlFor="lesson-source">
                From this note
              </label>
              <select
                id="lesson-source"
                value={source?.id || ''}
                onChange={(event) => setSourceId(event.target.value)}
                className="w-full min-h-[44px] rounded-xl border border-lantern-border bg-lantern-surface px-3 text-body"
              >
                {sources.map((note) => (
                  <option key={note.id} value={note.id}>
                    {note.title || 'Untitled note'}
                  </option>
                ))}
              </select>
              <div className="flex flex-wrap gap-2">
                {LESSON_MODES.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setMode(item.id)}
                    aria-pressed={mode === item.id}
                    className={`min-h-[44px] rounded-full border px-3 text-caption font-medium ${
                      mode === item.id
                        ? `${FEATURE_TINT_BG.ai} ${FEATURE_INK_TEXT.ai} border-transparent`
                        : 'border-lantern-border text-lantern-text-secondary'
                    }`}
                  >
                    {item.label}
                    <span className="ml-1 font-normal">· {item.promise}</span>
                  </button>
                ))}
              </div>
              <Button
                disabled={!source || starting}
                onClick={() => source && void startFromNote(source, mode)}
              >
                {starting ? 'Building the lesson…' : `Start · ${formatCreditCost(AI_FEATURE_CREDIT_COST)}`}
              </Button>
            </>
          )}
        </div>
      </div>
    );
  }

  const check = page?.check;
  const quizItems = quizItemsFromLesson(session);

  return (
    <div className="flex-1 min-h-0 flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`text-label uppercase ${FEATURE_INK_TEXT.ai}`}>
          {session.mode === 'mastery' ? 'Mastery' : 'Explore'}
        </span>
        <span className="text-caption text-lantern-text-secondary">
          {progress.done} of {progress.total} topics · {progress.percent}%
        </span>
        <div className="ml-auto flex flex-wrap gap-2">
          {quizItems.length > 0 ? (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => onOpenQuiz(quizItems)}
            >
              Turn into quiz
            </Button>
          ) : null}
          <TurnIntoMenu disabled={turning} onSelect={onTurnInto} />
          <Button
            size="sm"
            variant="secondary"
            onClick={() => updateSession((current) => applyLessonCommand(current, { type: 'end' }))}
          >
            End
          </Button>
        </div>
      </div>
      <div className="flex-1 min-h-0 grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_16rem] gap-3">
        <section className="min-h-0 overflow-y-auto rounded-lantern-xl border border-lantern-border bg-lantern-surface p-4 space-y-3">
          <p className="text-caption text-lantern-text-secondary">{topic?.title}</p>
          <h2 className="text-heading">{page?.title || 'Lesson'}</h2>
          <p className="text-body whitespace-pre-wrap">{page?.body}</p>
          {session.checkOpen && check ? (
            <div className="rounded-xl border border-lantern-border bg-lantern-background p-3 space-y-2">
              <h3 className="text-label uppercase text-lantern-text-secondary">Check</h3>
              <p className="text-body font-semibold">{check.stem}</p>
              {check.options?.map((option) => (
                <p key={option} className="text-body text-lantern-text-secondary">
                  {option}
                </p>
              ))}
              <p className="text-caption text-lantern-text-tertiary">
                Answer: {check.correctAnswer}
                {check.explanation ? ` · ${check.explanation}` : ''}
              </p>
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => updateSession((current) => applyLessonCommand(current, { type: 'prev' }))}
            >
              Back
            </Button>
            <Button
              size="sm"
              onClick={() => updateSession((current) => applyLessonCommand(current, { type: 'next' }))}
            >
              Next
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => updateSession((current) => applyLessonCommand(current, { type: 'complete' }))}
            >
              Mark complete
            </Button>
            {check ? (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => updateSession((current) => applyLessonCommand(current, { type: 'quiz_me' }))}
              >
                Quiz me
              </Button>
            ) : null}
          </div>
        </section>
        <aside className="min-h-0 flex flex-col rounded-lantern-xl border border-lantern-border bg-lantern-surface p-3 gap-3">
          <h3 className="text-label uppercase text-lantern-text-secondary">Plan</h3>
          <ol className="space-y-1 overflow-y-auto min-h-0 flex-1">
            {session.plan.topics.map((row, index) => {
              const done = session.completedTopicIds.includes(row.id);
              const current = row.id === topic?.id;
              const locked = !canOpenTopic(session, row.id);
              return (
                <li key={row.id}>
                  <button
                    type="button"
                    disabled={locked}
                    onClick={() =>
                      updateSession((currentSession) =>
                        applyLessonCommand(currentSession, { type: 'jump', topicNumber: index + 1 })
                      )
                    }
                    className={`w-full text-left rounded-lg px-2 py-1.5 min-h-[44px] text-body disabled:opacity-50 ${
                      current ? `${FEATURE_TINT_BG.ai} ${FEATURE_INK_TEXT.ai}` : 'text-lantern-text'
                    }`}
                  >
                    {done ? '✓ ' : `${index + 1}. `}
                    {row.title}
                  </button>
                </li>
              );
            })}
          </ol>
          <div className="space-y-2 border-t border-lantern-border pt-3">
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  if (speaking) {
                    cancelSpeech();
                    setSpeaking(false);
                  } else if (page && isSpeechSupported()) {
                    setSpeaking(true);
                    speak({
                      text: speakTextForPage(page),
                      rate: session.speechRate,
                      onEnd: () => setSpeaking(false),
                      onError: () => setSpeaking(false),
                    });
                  }
                }}
              >
                {speaking ? 'Pause voice' : 'Speak'}
              </Button>
              <Button size="sm" variant="secondary" onClick={startListening} disabled={listening}>
                {listening ? 'Listening…' : 'Mic'}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => updateSession((current) => applyLessonCommand(current, { type: 'slower' }))}
              >
                Slower
              </Button>
            </div>
            <div className="max-h-32 overflow-y-auto space-y-1">
              {session.transcript.slice(-6).map((turn, index) => (
                <p key={`${turn.role}-${index}`} className="text-caption">
                  <span className="font-semibold">{turn.role === 'student' ? 'You' : 'Tutor'}: </span>
                  {turn.text}
                </p>
              ))}
            </div>
            <form
              className="flex gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                void sendChat(askDraft);
              }}
            >
              <input
                value={askDraft}
                onChange={(event) => setAskDraft(event.target.value)}
                placeholder="Ask about this page"
                className="flex-1 min-h-[44px] rounded-xl border border-lantern-border px-3 text-body"
              />
              <Button type="submit" size="sm" disabled={sending || !askDraft.trim()}>
                {sending ? '…' : `Ask · ${formatCreditCost(AI_FEATURE_CREDIT_COST)}`}
              </Button>
            </form>
            <button
              type="button"
              className="text-caption text-lantern-primary-text hover:underline"
              onClick={() =>
                page &&
                openWithMessage(
                  buildLessonAsk({ page, sourceTitle: session.sourceTitle }),
                  { id: lessonNoteId || session.sourceNoteId, title: session.sourceTitle }
                )
              }
            >
              Open in Lantern AI
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
};
