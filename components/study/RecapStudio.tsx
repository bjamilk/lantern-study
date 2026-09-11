import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  newRecapNoteTitle,
  normalizeGeneratedRecap,
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
  type TurnIntoTargetId,
  studySetNotePayload,
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
import { aiAskTutor, aiGenerateRecap } from '../../services/ai';

interface RecapStudioProps {
  courseId: string;
  studySetId?: string;
  theme: 'light' | 'dark';
  notes: StudyNote[];
  selectedNote: StudyNote | null;
  turning?: boolean;
  onTurnInto: (target: TurnIntoTargetId) => void;
  onNoteReady: (noteId: string) => Promise<void>;
}

function sessionFromGenerated(
  generated: Awaited<ReturnType<typeof aiGenerateRecap>>,
  sourceNoteId: string,
  style: RecapStyle,
  length: RecapLength
): RecapSession {
  return normalizeGeneratedRecap(
    { segments: generated.segments },
    { style, length, sourceNoteId, sourceTitle: generated.sourceTitle }
  );
}

export const RecapStudio: React.FC<RecapStudioProps> = ({
  courseId,
  studySetId,
  notes,
  selectedNote,
  turning,
  onTurnInto,
  onNoteReady,
}) => {
  const createNote = useNotesStore((s) => s.createNote);
  const saveNote = useNotesStore((s) => s.saveNote);
  const openWithMessage = useCompanionStore((s) => s.openWithMessage);
  const showToast = useToastStore((s) => s.showToast);

  const recaps = useMemo(() => notes.filter(isRecapNote), [notes]);
  const sources = useMemo(() => recapSourceNotes(notes), [notes]);

  const resumed =
    selectedNote && isRecapNote(selectedNote) ? parseRecapNoteBody(selectedNote.body) : null;
  const [style, setStyle] = useState<RecapStyle>(resumed?.style || 'podcast');
  const [length, setLength] = useState<RecapLength>(resumed?.length || 'medium');
  const [sourceId, setSourceId] = useState<string>(
    selectedNote && sources.some((note) => note.id === selectedNote.id)
      ? selectedNote.id
      : sources[0]?.id || ''
  );
  const [session, setSession] = useState<RecapSession | null>(resumed);
  const [recapNoteId, setRecapNoteId] = useState<string | null>(
    resumed && selectedNote ? selectedNote.id : null
  );
  const [askDraft, setAskDraft] = useState('');
  const [starting, setStarting] = useState(false);
  const [sending, setSending] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [wantPlay, setWantPlay] = useState(false);
  const [pausedForAsk, setPausedForAsk] = useState(false);
  const [citeOpen, setCiteOpen] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recapNoteIdRef = useRef(recapNoteId);
  recapNoteIdRef.current = recapNoteId;

  const resumeBody = selectedNote && isRecapNote(selectedNote) ? selectedNote.body : '';
  useEffect(() => {
    if (sourceId && sources.some((note) => note.id === sourceId)) return;
    setSourceId(sources[0]?.id || '');
  }, [sourceId, sources]);
  useEffect(() => {
    if (!selectedNote || !isRecapNote(selectedNote)) return;
    const parsed = parseRecapNoteBody(selectedNote.body);
    if (!parsed) return;
    setSession(parsed);
    setRecapNoteId(selectedNote.id);
    setStyle(parsed.style);
    setLength(parsed.length);
    setWantPlay(false);
    setPausedForAsk(false);
  }, [selectedNote?.id, resumeBody]);

  const persist = useCallback(
    (next: RecapSession, noteId: string | null) => {
      if (!noteId) return;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        void saveNote(noteId, { body: composeRecapNoteBody(next) }).catch(() => undefined);
      }, 600);
    },
    [saveNote]
  );

  const updateSession = useCallback(
    (recipe: (current: RecapSession) => RecapSession) => {
      setSession((current) => {
        if (!current) return current;
        const next = recipe(current);
        persist(next, recapNoteIdRef.current);
        return next;
      });
    },
    [persist]
  );

  const segment = session ? currentRecapSegment(session) : null;
  const progress = session ? recapProgress(session) : { current: 0, total: 0, percent: 0 };

  useEffect(() => {
    if (!segment || !session || session.status === 'ended' || !wantPlay || pausedForAsk) {
      cancelSpeech();
      setSpeaking(false);
      return;
    }
    if (!isSpeechSupported()) return;
    setSpeaking(true);
    const stop = speak({
      text: speakTextForSegment(segment),
      rate: session.speechRate,
      onEnd: () => {
        setSpeaking(false);
        setSession((current) => {
          if (!current || current.status === 'ended') return current;
          const next = applyRecapCommand(current, { type: 'next' });
          if (next.segmentIndex === current.segmentIndex) {
            setWantPlay(false);
            return current;
          }
          persist(next, recapNoteIdRef.current);
          return next;
        });
      },
      onError: () => setSpeaking(false),
    });
    return () => {
      stop();
      setSpeaking(false);
    };
  }, [pausedForAsk, segment?.id, session?.speechRate, session?.status, wantPlay]);

  useEffect(
    () => () => {
      cancelSpeech();
      if (saveTimer.current) clearTimeout(saveTimer.current);
    },
    []
  );

  const startFromNote = async (note: StudyNote, chosen: RecapStyle, chosenLength: RecapLength) => {
    const text = getNoteStudyContent(note);
    if (text.trim().length < 50) {
      showToast('Pick a note with enough study content.', 'info');
      return;
    }
    setStarting(true);
    try {
      let next: RecapSession;
      try {
        const generated = await aiGenerateRecap(text, {
          style: chosen,
          length: chosenLength,
          sourceTitle: note.title || 'Untitled note',
        });
        next = sessionFromGenerated(generated, note.id, chosen, chosenLength);
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
      setSession(next);
      setPausedForAsk(false);
      setWantPlay(true);
      await onNoteReady(created.id);
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not start the recap.', 'error');
    } finally {
      setStarting(false);
    }
  };

  const sendAsk = async (raw: string) => {
    const text = raw.trim();
    if (!text || !segment || !session) return;
    cancelSpeech();
    setWantPlay(false);
    setPausedForAsk(true);
    setSpeaking(false);
    setSending(true);
    setAskDraft('');
    const withStudent = appendRecapTurn(session, { role: 'student', text });
    setSession(withStudent);
    persist(withStudent, recapNoteId);
    try {
      const reply = await aiAskTutor(
        buildRecapAsk({ question: text, segment, sourceTitle: session.sourceTitle }),
        { subject: session.sourceTitle, recentTopics: [segment.title] }
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

  if (!session) {
    const source = sources.find((note) => note.id === sourceId) || sources[0];
    return (
      <div className="flex-1 min-h-0 overflow-y-auto rounded-lantern-xl border border-lantern-border bg-lantern-surface p-4 space-y-4">
        <div>
          <h2 className="text-heading">Recap</h2>
          <p className="text-body text-lantern-text-secondary mt-1">{recapStudioPriceLine()}</p>
          <p className="text-caption text-lantern-text-tertiary mt-1">
            A listen-through of the material. Narration still reads the page itself.
          </p>
        </div>
        {recaps.length > 0 ? (
          <div className="space-y-2">
            <h3 className="text-label uppercase text-lantern-text-secondary">Resume</h3>
            {recaps.map((note) => (
              <button
                key={note.id}
                type="button"
                onClick={() => void onNoteReady(note.id)}
                className="w-full text-left rounded-xl border border-lantern-border px-3 py-2 min-h-[44px] hover:bg-lantern-background-secondary"
              >
                <span className="text-body font-semibold">{note.title || 'Recap'}</span>
              </button>
            ))}
          </div>
        ) : null}
        <div className="space-y-2">
          <h3 className="text-label uppercase text-lantern-text-secondary">New recap</h3>
          {sources.length === 0 ? (
            <p className="text-body text-lantern-text-secondary">
              Import or write a note in this course first. The recap is built from that material.
            </p>
          ) : (
            <>
              <label className="block text-caption text-lantern-text-secondary" htmlFor="recap-source">
                From this note
              </label>
              <select
                id="recap-source"
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
                {RECAP_STYLES.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setStyle(item.id)}
                    aria-pressed={style === item.id}
                    className={`min-h-[44px] rounded-full border px-3 text-caption font-medium ${
                      style === item.id
                        ? `${FEATURE_TINT_BG.ai} ${FEATURE_INK_TEXT.ai} border-transparent`
                        : 'border-lantern-border text-lantern-text-secondary'
                    }`}
                  >
                    {item.label}
                    <span className="ml-1 font-normal">· {item.promise}</span>
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap gap-2">
                {RECAP_LENGTHS.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setLength(item.id)}
                    aria-pressed={length === item.id}
                    className={`min-h-[44px] min-w-[44px] rounded-full border px-3 text-caption font-medium ${
                      length === item.id
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
                onClick={() => source && void startFromNote(source, style, length)}
              >
                {starting ? 'Building the recap…' : `Start · ${formatCreditCost(AI_FEATURE_CREDIT_COST)}`}
              </Button>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`text-label uppercase ${FEATURE_INK_TEXT.ai}`}>
          {recapStyleLabel(session.style)}
        </span>
        <span className="text-caption text-lantern-text-secondary">
          {progress.current} of {progress.total} · {session.length.toUpperCase()}
        </span>
        <div className="ml-auto flex flex-wrap gap-2">
          <TurnIntoMenu disabled={turning} onSelect={onTurnInto} />
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              setWantPlay(false);
              cancelSpeech();
              updateSession((current) => applyRecapCommand(current, { type: 'end' }));
            }}
          >
            End
          </Button>
        </div>
      </div>
      <div className="flex-1 min-h-0 grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_16rem] gap-3">
        <section className="min-h-0 overflow-y-auto rounded-lantern-xl border border-lantern-border bg-lantern-surface p-4 space-y-3">
          <p className="text-caption text-lantern-text-secondary">{session.sourceTitle}</p>
          <h2 className="text-heading">{segment?.title || 'Recap'}</h2>
          <p className="text-body whitespace-pre-wrap">{segment?.spoken}</p>
          {segment?.sourceCite ? (
            <div>
              <button
                type="button"
                title={segment.sourceCite}
                onClick={() => setCiteOpen((open) => !open)}
                className="text-caption text-lantern-primary-text hover:underline min-h-[44px]"
              >
                From the notes
              </button>
              {citeOpen ? (
                <p className="text-caption text-lantern-text-secondary mt-1" title={segment.sourceCite}>
                  “{segment.sourceCite}”
                </p>
              ) : null}
            </div>
          ) : null}
          {pausedForAsk ? (
            <p className="text-caption text-lantern-text-secondary">Paused to answer. Resume when you are ready.</p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              onClick={() => {
                if (wantPlay && !pausedForAsk) {
                  setWantPlay(false);
                  cancelSpeech();
                  setSpeaking(false);
                } else {
                  setPausedForAsk(false);
                  setWantPlay(true);
                }
              }}
            >
              {wantPlay && !pausedForAsk && speaking ? 'Pause' : 'Play'}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => updateSession((current) => applyRecapCommand(current, { type: 'next' }))}
            >
              Skip
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => updateSession((current) => applyRecapCommand(current, { type: 'slower' }))}
            >
              Slower
            </Button>
            {pausedForAsk ? (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  setPausedForAsk(false);
                  setWantPlay(true);
                }}
              >
                Resume
              </Button>
            ) : null}
          </div>
        </section>
        <aside className="min-h-0 flex flex-col rounded-lantern-xl border border-lantern-border bg-lantern-surface p-3 gap-3">
          <h3 className="text-label uppercase text-lantern-text-secondary">Transcript</h3>
          <ol className="space-y-1 overflow-y-auto min-h-0 flex-1">
            {session.segments.map((row, index) => {
              const current = row.id === segment?.id;
              return (
                <li key={row.id}>
                  <button
                    type="button"
                    title={row.sourceCite}
                    onClick={() => {
                      setCiteOpen(false);
                      updateSession((currentSession) =>
                        applyRecapCommand(currentSession, { type: 'jump', segmentNumber: index + 1 })
                      );
                    }}
                    className={`w-full text-left rounded-lg px-2 py-1.5 min-h-[44px] text-body ${
                      current ? `${FEATURE_TINT_BG.ai} ${FEATURE_INK_TEXT.ai}` : 'text-lantern-text'
                    }`}
                  >
                    {index + 1}. {row.title}
                  </button>
                </li>
              );
            })}
          </ol>
          <div className="space-y-2 border-t border-lantern-border pt-3">
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
                void sendAsk(askDraft);
              }}
            >
              <input
                value={askDraft}
                onChange={(event) => setAskDraft(event.target.value)}
                placeholder="Ask while listening"
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
                segment &&
                openWithMessage(buildRecapAsk({ segment, sourceTitle: session.sourceTitle }), {
                  id: recapNoteId || session.sourceNoteId,
                  title: session.sourceTitle,
                })
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
