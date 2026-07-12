import React, { useState, useCallback } from 'react';
import {
  DocumentArrowUpIcon,
  SparklesIcon,
  DocumentTextIcon,
  ChatBubbleLeftRightIcon,
  RectangleStackIcon,
  AcademicCapIcon,
} from '@heroicons/react/24/outline';
import { getNoteStudyContent, hasEnoughNoteStudyContent } from '@lantern/shared';
import { ScreenHeader, Button, Card } from './ui';
import * as notesApi from '../services/notes';
import { aiGenerateFlashcards } from '../services/ai';
import { normalizeFlashcardCount } from '../utils/flashcardGeneration';
import { useUIStore } from '../stores/uiStore';
import { useNotesStore } from '../stores/notesStore';
import { useCompanionStore } from '../stores/companionStore';
import type { NoteAttachment, StudyNote } from '../types';
import type { ImportAndStudyResult } from './ImportAndStudyModal';

interface AIToolsHubProps {
  theme?: 'light' | 'dark';
  onOpenNote: (noteId: string) => void;
  onStartLearn?: () => void;
  onTakePracticeTest?: () => void;
  onComplete?: (result: ImportAndStudyResult) => void;
}

type Step = 'hub' | 'processing' | 'done';

export const AIToolsHub: React.FC<AIToolsHubProps> = ({
  onOpenNote,
  onStartLearn,
  onTakePracticeTest,
  onComplete,
}) => {
  const [step, setStep] = useState<Step>('hub');
  const [textContent, setTextContent] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportAndStudyResult | null>(null);
  const [generateCards, setGenerateCards] = useState(true);
  const [generateQuiz, setGenerateQuiz] = useState(true);
  const setImportProgress = useUIStore((s) => s.setImportProgress);
  const loadNote = useNotesStore((s) => s.loadNote);
  const openWithMessage = useCompanionStore((s) => s.openWithMessage);
  const { lowDataMode } = useUIStore();

  const runStudyGenerators = useCallback(
    async (note: StudyNote & { attachments?: NoteAttachment[] }) => {
      let flashcardCount = 0;
      let quizQuestionCount = 0;

      if (generateCards && hasEnoughNoteStudyContent(note)) {
        try {
          const studyText = getNoteStudyContent(note);
          const { flashcards } = await aiGenerateFlashcards(studyText.slice(0, 8000), {
            count: normalizeFlashcardCount(),
          });
          if (flashcards?.length) flashcardCount = flashcards.length;
        } catch {
          // non-fatal
        }
      }

      if (generateQuiz && hasEnoughNoteStudyContent(note)) {
        try {
          const studyText = getNoteStudyContent(note);
          const { questions } = await notesApi.generateDailyQuizFromContent(
            studyText.slice(0, 8000),
            'retention',
            5
          );
          quizQuestionCount = questions?.length ?? 0;
        } catch {
          // non-fatal
        }
      }

      const res: ImportAndStudyResult = {
        noteId: note.id,
        noteTitle: note.title,
        flashcardCount,
        quizQuestionCount,
      };
      setResult(res);
      setStep('done');
      onComplete?.(res);
    },
    [generateCards, generateQuiz, onComplete]
  );

  const processContent = useCallback(
    async (body: string, title: string, sourceType: string) => {
      setStep('processing');
      setError(null);
      try {
        const note = await notesApi.createNote({
          title,
          body,
          sourceType: sourceType as StudyNote['sourceType'],
        });
        await runStudyGenerators(note);
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : 'Import failed');
        setStep('hub');
      }
    },
    [runStudyGenerators]
  );

  const handlePdf = async (file: File) => {
    setStep('processing');
    setError(null);
    try {
      const { note, attachment } = await notesApi.uploadNotePdfViaApi(file, undefined, setImportProgress);
      const notesState = useNotesStore.getState();
      notesState.setNotes([note, ...notesState.notes.filter((n) => n.id !== note.id)]);
      await loadNote(note.id);
      useUIStore.getState().clearImportProgress();
      await runStudyGenerators({ ...note, attachments: [attachment] });
    } catch (e: unknown) {
      useUIStore.getState().clearImportProgress();
      setError(e instanceof Error ? e.message : 'PDF import failed');
      setStep('hub');
    }
  };

  const handlePresentation = async (file: File) => {
    setStep('processing');
    setError(null);
    try {
      const { note, attachment } = await notesApi.uploadPresentationViaApi(file, undefined, setImportProgress);
      const notesState = useNotesStore.getState();
      notesState.setNotes([note, ...notesState.notes.filter((n) => n.id !== note.id)]);
      await loadNote(note.id);
      const loaded = useNotesStore.getState().selectedNote;
      if (loaded?.id === note.id && (!loaded.attachments || loaded.attachments.length === 0)) {
        notesState.setSelectedNote({ ...loaded, attachments: [attachment] });
      }
      useUIStore.getState().clearImportProgress();
      await runStudyGenerators({
        ...useNotesStore.getState().selectedNote!,
        attachments: useNotesStore.getState().selectedNote?.attachments ?? [attachment],
      });
    } catch (e: unknown) {
      useUIStore.getState().clearImportProgress();
      setError(e instanceof Error ? e.message : 'PowerPoint import failed');
      setStep('hub');
    }
  };

  const toolCards = [
    {
      id: 'pdf',
      title: 'PDF Summarizer',
      description: 'Upload readings or slides',
      icon: DocumentArrowUpIcon,
      action: 'file-pdf' as const,
    },
    {
      id: 'pptx',
      title: 'PowerPoint',
      description: 'Import lecture slides',
      icon: DocumentArrowUpIcon,
      action: 'file-pptx' as const,
    },
    {
      id: 'paste',
      title: 'Paste notes',
      description: 'Turn text into study tools',
      icon: DocumentTextIcon,
      action: 'paste' as const,
    },
    {
      id: 'weak',
      title: 'Weak topics',
      description: 'AI cards from your performance',
      icon: RectangleStackIcon,
      action: 'weak' as const,
      disabled: lowDataMode,
    },
    {
      id: 'chat',
      title: 'Ask Lantern AI',
      description: 'Chat about your materials',
      icon: ChatBubbleLeftRightIcon,
      action: 'chat' as const,
      disabled: lowDataMode,
    },
  ];

  return (
    <div className="flex-1 flex flex-col overflow-y-auto bg-lantern-background">
      <div className="px-4 md:px-6 lg:px-8 py-6 w-full space-y-6">
        <ScreenHeader
          title="AI Tools"
          subtitle="Add material once — get notes, flashcards, and practice tests"
          icon={<SparklesIcon className="w-6 h-6" />}
        />

        {step === 'hub' && (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {toolCards.map((tool) => (
                <Card key={tool.id} padding="md" className="hover:border-lantern-primary transition-colors">
                  {tool.action === 'file-pdf' && (
                    <label className={`cursor-pointer block ${tool.disabled ? 'opacity-50 pointer-events-none' : ''}`}>
                      <tool.icon className="w-7 h-7 text-lantern-primary mb-2" />
                      <p className="font-semibold text-lantern-text">{tool.title}</p>
                      <p className="text-xs text-lantern-text-secondary mt-1">{tool.description}</p>
                      <input type="file" accept=".pdf,application/pdf" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void handlePdf(f); e.target.value = ''; }} />
                    </label>
                  )}
                  {tool.action === 'file-pptx' && (
                    <label className="cursor-pointer block">
                      <tool.icon className="w-7 h-7 text-violet-600 mb-2" />
                      <p className="font-semibold text-lantern-text">{tool.title}</p>
                      <p className="text-xs text-lantern-text-secondary mt-1">{tool.description}</p>
                      <input type="file" accept=".pptx,.ppt,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/vnd.ms-powerpoint" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void handlePresentation(f); e.target.value = ''; }} />
                    </label>
                  )}
                  {tool.action === 'paste' && (
                    <div>
                      <tool.icon className="w-7 h-7 text-lantern-primary mb-2" />
                      <p className="font-semibold text-lantern-text">{tool.title}</p>
                      <p className="text-xs text-lantern-text-secondary mt-1 mb-3">{tool.description}</p>
                    </div>
                  )}
                  {tool.action === 'weak' && (
                    <button type="button" disabled={tool.disabled} onClick={() => openWithMessage('Generate flashcards for my weak topics from recent tests and save them to a new deck.')} className="text-left w-full disabled:opacity-50">
                      <tool.icon className="w-7 h-7 text-emerald-600 mb-2" />
                      <p className="font-semibold text-lantern-text">{tool.title}</p>
                      <p className="text-xs text-lantern-text-secondary mt-1">{tool.description}</p>
                    </button>
                  )}
                  {tool.action === 'chat' && (
                    <button type="button" disabled={tool.disabled} onClick={() => openWithMessage('Help me create a study plan from my notes and flashcards.')} className="text-left w-full disabled:opacity-50">
                      <tool.icon className="w-7 h-7 text-lantern-primary mb-2" />
                      <p className="font-semibold text-lantern-text">{tool.title}</p>
                      <p className="text-xs text-lantern-text-secondary mt-1">{tool.description}</p>
                    </button>
                  )}
                </Card>
              ))}
            </div>

            <Card padding="md">
              <p className="text-sm font-medium text-lantern-text mb-2">Paste lecture notes</p>
              <textarea
                placeholder="Paste your notes here..."
                value={textContent}
                onChange={(e) => setTextContent(e.target.value)}
                rows={5}
                className="w-full px-3 py-2 rounded-lg border border-lantern-border bg-lantern-surface text-sm text-lantern-text resize-none"
              />
              <div className="flex flex-wrap gap-4 text-sm mt-3 mb-3">
                <label className="flex items-center gap-2 cursor-pointer text-lantern-text">
                  <input type="checkbox" checked={generateCards} onChange={(e) => setGenerateCards(e.target.checked)} />
                  Generate flashcards
                </label>
                <label className="flex items-center gap-2 cursor-pointer text-lantern-text">
                  <input type="checkbox" checked={generateQuiz} onChange={(e) => setGenerateQuiz(e.target.checked)} />
                  Generate quiz
                </label>
              </div>
              {textContent.trim() && (
                <Button onClick={() => void processContent(textContent.trim(), 'Imported Notes', 'typed')} className="w-full sm:w-auto">
                  Import & study
                </Button>
              )}
              {error && <p className="text-sm text-red-500 mt-2">{error}</p>}
            </Card>
          </>
        )}

        {step === 'processing' && (
          <Card padding="lg" className="text-center py-12">
            <div className="animate-spin w-10 h-10 border-4 border-lantern-primary border-t-transparent rounded-full mx-auto mb-4" />
            <p className="font-medium text-lantern-text">Creating your study materials...</p>
            <p className="text-sm text-lantern-text-secondary mt-1">Note + flashcards + quiz</p>
          </Card>
        )}

        {step === 'done' && result && (
          <Card padding="lg" className="text-center space-y-4">
            <div className="text-4xl text-emerald-500">✓</div>
            <p className="font-semibold text-lg text-lantern-text">{result.noteTitle} ready!</p>
            <div className="flex justify-center gap-4 text-sm text-lantern-text-secondary">
              {result.flashcardCount ? <span>{result.flashcardCount} flashcards</span> : null}
              {result.quizQuestionCount ? <span>{result.quizQuestionCount} quiz questions</span> : null}
            </div>
            <div className="flex flex-col sm:flex-row gap-2 justify-center pt-2">
              <Button onClick={() => onOpenNote(result.noteId)}>
                Open note
              </Button>
              {onStartLearn && result.flashcardCount ? (
                <Button variant="accent" onClick={onStartLearn}>
                  <AcademicCapIcon className="w-4 h-4" />
                  Start Learn
                </Button>
              ) : null}
              {onTakePracticeTest && result.quizQuestionCount ? (
                <Button variant="secondary" onClick={onTakePracticeTest}>
                  Practice test
                </Button>
              ) : null}
            </div>
            <Button variant="ghost" size="sm" onClick={() => { setStep('hub'); setResult(null); }}>
              Add more material
            </Button>
          </Card>
        )}
      </div>
    </div>
  );
};

export default AIToolsHub;
