import React, { useState, useCallback } from 'react';
import {
  DocumentArrowUpIcon,
  PlayCircleIcon,
  SparklesIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { getNoteStudyContent } from '@lantern/shared';
import { Button } from './ui';
import * as notesApi from '../services/notes';
import { aiGenerateFlashcards } from '../services/ai';
import { normalizeFlashcardCount } from '../utils/flashcardGeneration';
import type { NoteAttachment, StudyNote } from '../types';

export interface ImportAndStudyResult {
  noteId: string;
  noteTitle: string;
  flashcardCount?: number;
  quizQuestionCount?: number;
}

interface ImportAndStudyModalProps {
  isOpen: boolean;
  onClose: () => void;
  onComplete: (result: ImportAndStudyResult) => void;
  onOpenNote: (noteId: string) => void;
  theme?: 'light' | 'dark';
}

type Step = 'input' | 'processing' | 'done';

export const ImportAndStudyModal: React.FC<ImportAndStudyModalProps> = ({
  isOpen,
  onClose,
  onComplete,
  onOpenNote,
  theme = 'light',
}) => {
  const [step, setStep] = useState<Step>('input');
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [textContent, setTextContent] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportAndStudyResult | null>(null);
  const [generateCards, setGenerateCards] = useState(true);
  const [generateQuiz, setGenerateQuiz] = useState(true);
  const isDark = theme === 'dark';

  const reset = () => {
    setStep('input');
    setYoutubeUrl('');
    setTextContent('');
    setError(null);
    setResult(null);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const runStudyGenerators = useCallback(
    async (note: StudyNote & { attachments?: NoteAttachment[] }) => {
      const studyText = getNoteStudyContent({
        sourceType: note.sourceType,
        body: note.body,
        summary: note.summary,
        attachments: note.attachments,
      });

      let flashcardCount = 0;
      let quizQuestionCount = 0;

      if (generateCards && studyText.length >= 50) {
        try {
          const { flashcards } = await aiGenerateFlashcards(studyText.slice(0, 8000), {
            count: normalizeFlashcardCount(),
          });
          if (flashcards?.length) flashcardCount = flashcards.length;
        } catch {
          // non-fatal
        }
      }

      if (generateQuiz && studyText.length >= 50) {
        try {
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
      onComplete(res);
    },
    [generateCards, generateQuiz, onComplete]
  );

  const processContent = useCallback(
    async (body: string, title: string, sourceType: string, extra?: Partial<{ youtubeUrl: string }>) => {
      setStep('processing');
      setError(null);
      try {
        const note = await notesApi.createNote({
          title,
          body,
          sourceType: sourceType as StudyNote['sourceType'],
          ...extra,
        });
        await runStudyGenerators(note);
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : 'Import failed');
        setStep('input');
      }
    },
    [runStudyGenerators]
  );

  const handleYouTube = async () => {
    if (!youtubeUrl.trim()) return;
    try {
      setStep('processing');
      const note = await notesApi.importYouTubeNote(youtubeUrl.trim());
      await runStudyGenerators(note);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'YouTube import failed');
      setStep('input');
    }
  };

  const handlePdf = async (file: File) => {
    setStep('processing');
    setError(null);
    try {
      const { note, attachment } = await notesApi.uploadNotePdfViaApi(file);
      await runStudyGenerators({ ...note, attachments: [attachment] });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'PDF import failed');
      setStep('input');
    }
  };

  const handlePresentation = async (file: File) => {
    setStep('processing');
    setError(null);
    try {
      const { note, attachment } = await notesApi.uploadPresentationViaApi(file);
      await runStudyGenerators({ ...note, attachments: [attachment] });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'PowerPoint import failed');
      setStep('input');
    }
  };

  const handleTextSubmit = () => {
    if (!textContent.trim()) return;
    void processContent(textContent.trim(), 'Imported Notes', 'typed');
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className={`w-full max-w-lg rounded-2xl shadow-xl ${isDark ? 'bg-slate-800 text-slate-100' : 'bg-white text-slate-900'}`}>
        <div className="flex items-center justify-between p-4 border-b border-slate-200 dark:border-slate-700">
          <h2 className="text-lg font-bold flex items-center gap-2">
            <SparklesIcon className="w-5 h-5 text-violet-500" />
            Import & Study
          </h2>
          <button onClick={handleClose} className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700">
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {step === 'input' && (
            <>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Drop content in once — get a note plus optional flashcards and quiz.
              </p>

              <div className="flex gap-3">
                <label className={`flex-1 flex flex-col items-center gap-2 p-4 rounded-xl border-2 border-dashed cursor-pointer hover:border-indigo-400 ${isDark ? 'border-slate-600' : 'border-slate-300'}`}>
                  <DocumentArrowUpIcon className="w-8 h-8 text-indigo-500" />
                  <span className="text-sm font-medium">Upload PDF</span>
                  <input type="file" accept=".pdf,application/pdf" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void handlePdf(f); e.target.value = ''; }} />
                </label>
                <label className={`flex-1 flex flex-col items-center gap-2 p-4 rounded-xl border-2 border-dashed cursor-pointer hover:border-indigo-400 ${isDark ? 'border-slate-600' : 'border-slate-300'}`}>
                  <DocumentArrowUpIcon className="w-8 h-8 text-violet-500" />
                  <span className="text-sm font-medium">PowerPoint</span>
                  <input type="file" accept=".pptx,.ppt,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/vnd.ms-powerpoint" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void handlePresentation(f); e.target.value = ''; }} />
                </label>
              </div>

              <div className="flex gap-2">
                <input
                  type="url"
                  placeholder="Paste YouTube URL..."
                  value={youtubeUrl}
                  onChange={(e) => setYoutubeUrl(e.target.value)}
                  className={`flex-1 px-3 py-2 rounded-lg border text-sm ${isDark ? 'bg-slate-700 border-slate-600' : 'bg-slate-50 border-slate-300'}`}
                />
                <Button size="sm" onClick={handleYouTube} disabled={!youtubeUrl.trim()}>
                  <PlayCircleIcon className="w-4 h-4" />
                </Button>
              </div>

              <textarea
                placeholder="Or paste lecture notes / text..."
                value={textContent}
                onChange={(e) => setTextContent(e.target.value)}
                rows={4}
                className={`w-full px-3 py-2 rounded-lg border text-sm resize-none ${isDark ? 'bg-slate-700 border-slate-600' : 'bg-slate-50 border-slate-300'}`}
              />

              <div className="flex gap-4 text-sm">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={generateCards} onChange={(e) => setGenerateCards(e.target.checked)} />
                  Generate flashcards
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={generateQuiz} onChange={(e) => setGenerateQuiz(e.target.checked)} />
                  Generate quiz
                </label>
              </div>

              {textContent.trim() && (
                <Button onClick={handleTextSubmit} className="w-full">Import text</Button>
              )}

              {error && <p className="text-sm text-red-500">{error}</p>}
            </>
          )}

          {step === 'processing' && (
            <div className="py-8 text-center">
              <div className="animate-spin w-10 h-10 border-4 border-indigo-500 border-t-transparent rounded-full mx-auto mb-4" />
              <p className="font-medium">Creating your study materials...</p>
              <p className="text-sm text-slate-500 mt-1">Note + flashcards + quiz</p>
            </div>
          )}

          {step === 'done' && result && (
            <div className="py-4 text-center space-y-4">
              <div className="text-4xl">✓</div>
              <p className="font-semibold">{result.noteTitle} ready!</p>
              <div className="flex justify-center gap-4 text-sm text-slate-500">
                {result.flashcardCount ? <span>{result.flashcardCount} flashcards</span> : null}
                {result.quizQuestionCount ? <span>{result.quizQuestionCount} quiz Qs</span> : null}
              </div>
              <Button onClick={() => { onOpenNote(result.noteId); handleClose(); }} className="w-full">
                Open note
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ImportAndStudyModal;
