import React, { useEffect, useRef, useState } from 'react';
import { AppIcon } from './ui/AppIcon';
import { useToastStore } from '../stores/toastStore';
import AIUsageInline from './AIUsageInline';
import { AIDisclaimer } from './AIDisclaimer';
import Modal from './ui/Modal';
import { fetchAIUsage } from '../services/ai';
import * as notesApi from '../services/notes';
import { getNoteStudyContent, hasEnoughNoteStudyContent } from '@lantern/shared/utils';
import { formatMaxNoteUploadLabel } from '@lantern/shared/utils/noteUpload';

interface AIGenerateQuestionsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (
    notes: string,
    options: { count: number; difficulty: string; questionTypes: string[]; subject: string }
  ) => void | Promise<unknown>;
  isGenerating: boolean;
  error?: string | null;
}

const QUESTION_TYPES = [
  { value: 'multiple_choice', label: 'Multiple Choice' },
  { value: 'true_false', label: 'True / False' },
  { value: 'short_answer', label: 'Short Answer' },
  { value: 'fill_in_blank', label: 'Fill in the Blank' },
];

const AIGenerateQuestionsModal: React.FC<AIGenerateQuestionsModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
  isGenerating,
  error = null,
}) => {
  const [notes, setNotes] = useState('');
  const [count, setCount] = useState<number | ''>(5);
  const [difficulty, setDifficulty] = useState('mixed');
  const [subject, setSubject] = useState('');
  const [selectedTypes, setSelectedTypes] = useState<string[]>(['multiple_choice', 'true_false']);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadLabel, setUploadLabel] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) void fetchAIUsage();
  }, [isOpen]);

  useEffect(() => {
    if (error) {
      useToastStore.getState().showToast(error, 'error');
    }
  }, [error]);

  const toggleType = (type: string) => {
    setSelectedTypes((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]
    );
  };

  const handleFileUpload = async (file: File | undefined) => {
    if (!file || isGenerating || isUploading) return;
    const name = file.name.toLowerCase();
    const isPdf = name.endsWith('.pdf') || file.type === 'application/pdf';
    const isPpt =
      name.endsWith('.pptx') ||
      name.endsWith('.ppt') ||
      file.type.includes('presentation') ||
      file.type.includes('powerpoint');

    if (!isPdf && !isPpt) {
      useToastStore.getState().showToast('Upload a PDF or PowerPoint file.', 'error');
      return;
    }

    setIsUploading(true);
    setUploadLabel(`Uploading ${file.name}…`);
    try {
      const result = isPdf
        ? await notesApi.uploadNotePdfViaApi(file, undefined, (p) => {
            if (p.label) setUploadLabel(p.label);
          })
        : await notesApi.uploadPresentationViaApi(file, undefined, (p) => {
            if (p.label) setUploadLabel(p.label);
          });

      const studyText = getNoteStudyContent({
        sourceType: result.note.sourceType,
        body: result.note.body,
        summary: result.note.summary,
        attachments: [result.attachment, ...(result.note.attachments || [])],
      });

      if (!hasEnoughNoteStudyContent({
        sourceType: result.note.sourceType,
        body: result.note.body,
        summary: result.note.summary,
        attachments: [result.attachment, ...(result.note.attachments || [])],
      })) {
        useToastStore
          .getState()
          .showToast(
            'Not enough text extracted yet. Wait a moment and try again, or paste notes manually.',
            'error'
          );
        return;
      }

      setNotes(studyText.slice(0, 8000));
      useToastStore.getState().showToast('Attachment text loaded into the notes field.', 'success');
    } catch (err: unknown) {
      useToastStore
        .getState()
        .showToast(err instanceof Error ? err.message : 'Failed to upload attachment', 'error');
    } finally {
      setIsUploading(false);
      setUploadLabel(null);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!notes.trim() || count === '' || Number(count) <= 0 || Number(count) > 20) {
      useToastStore.getState().showToast('Please provide notes and a number of questions between 1 and 20.', 'error');
      return;
    }
    if (notes.trim().length < 50) {
      useToastStore
        .getState()
        .showToast('Notes must be at least 50 characters (or upload a PDF/slides file).', 'error');
      return;
    }
    if (selectedTypes.length === 0) {
      useToastStore.getState().showToast('Please select at least one question type.', 'error');
      return;
    }
    void onSubmit(notes, {
      count: Number(count),
      difficulty,
      questionTypes: selectedTypes,
      subject: subject.trim(),
    });
  };

  const busy = isGenerating || isUploading;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      ariaLabelledBy="ai-generate-questions-title"
      maxWidthClass="max-w-2xl"
      loading={busy}
      closeOnBackdrop={!busy}
      panelClassName="max-h-[90vh] overflow-y-auto"
    >
      <div className="flex justify-between items-center mb-4">
        <h2
          id="ai-generate-questions-title"
          className="text-xl font-semibold text-lantern-text flex items-center"
        >
          <AppIcon name="sparkles" size={24} className="mr-2 text-lantern-primary" aria-hidden />
          Generate Questions with AI
        </h2>
        <button
          type="button"
          onClick={onClose}
          disabled={busy}
          className="min-h-[44px] min-w-[44px] flex items-center justify-center text-lantern-text-muted hover:text-lantern-text rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-lantern-primary disabled:opacity-50"
          aria-label="Close generate questions dialog"
        >
          <AppIcon name="close" size={24} aria-hidden />
        </button>
      </div>
      <p className="text-sm text-lantern-text-secondary mb-2">
        Paste notes or upload a PDF/PowerPoint. AI posts practice questions to the group chat for voting.
      </p>
      <AIDisclaimer className="mb-4" />

      {error ? (
        <div
          role="alert"
          className="mb-4 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300"
        >
          {error}
        </div>
      ) : null}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
            <label htmlFor="ai-notes" className="block text-sm font-medium text-lantern-text">
              Your Notes
            </label>
            <div className="flex items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.ppt,.pptx,application/pdf,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  void handleFileUpload(file);
                  e.target.value = '';
                }}
              />
              <button
                type="button"
                disabled={busy}
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-lantern-border bg-lantern-background-secondary px-3 py-1.5 text-xs font-medium text-lantern-text hover:bg-lantern-surface disabled:opacity-50"
              >
                {isUploading ? (
                  <AppIcon name="refresh" size={16} className="animate-spin" aria-hidden />
                ) : (
                  <AppIcon name="document-upload" size={16} aria-hidden />
                )}
                {isUploading ? 'Uploading…' : 'Upload PDF / PPT'}
              </button>
            </div>
          </div>
          <textarea
            id="ai-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={8}
            className="w-full p-2 border border-lantern-border rounded-lg bg-lantern-surface text-lantern-text focus:ring-2 focus:ring-lantern-primary focus:border-transparent"
            placeholder="Paste lecture notes, chapter text, or upload a PDF/PowerPoint…"
            required
          />
          <p className="mt-1 text-xs text-lantern-text-secondary">
            {uploadLabel ||
              `At least 50 characters · max upload ${formatMaxNoteUploadLabel()} · text is truncated for AI`}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="ai-subject" className="block text-sm font-medium text-lantern-text mb-1">
              Subject (optional)
            </label>
            <input
              id="ai-subject"
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="w-full min-h-[44px] p-2 border border-lantern-border rounded-lg bg-lantern-surface text-lantern-text focus:ring-2 focus:ring-lantern-primary focus:border-transparent"
              placeholder="e.g. Biology, History"
            />
          </div>
          <div>
            <label htmlFor="ai-count" className="block text-sm font-medium text-lantern-text mb-1">
              Number of Questions
            </label>
            <input
              id="ai-count"
              type="number"
              value={count}
              onChange={(e) => setCount(e.target.value === '' ? '' : parseInt(e.target.value, 10))}
              min="1"
              max="20"
              required
              className="w-full min-h-[44px] p-2 border border-lantern-border rounded-lg bg-lantern-surface text-lantern-text focus:ring-2 focus:ring-lantern-primary focus:border-transparent"
            />
          </div>
        </div>

        <div>
          <p className="block text-sm font-medium text-lantern-text mb-1">Difficulty</p>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Question difficulty">
            {['easy', 'medium', 'hard', 'mixed'].map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDifficulty(d)}
                aria-pressed={difficulty === d}
                className={`min-h-[44px] px-3 py-1.5 text-sm rounded-lg border capitalize ${
                  difficulty === d
                    ? 'bg-lantern-primary text-white border-lantern-primary'
                    : 'bg-lantern-surface text-lantern-text border-lantern-border hover:bg-lantern-background-secondary'
                }`}
              >
                {d}
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="block text-sm font-medium text-lantern-text mb-1">Question Types</p>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Question types">
            {QUESTION_TYPES.map((qt) => (
              <button
                key={qt.value}
                type="button"
                onClick={() => toggleType(qt.value)}
                aria-pressed={selectedTypes.includes(qt.value)}
                className={`min-h-[44px] px-3 py-1.5 text-sm rounded-lg border ${
                  selectedTypes.includes(qt.value)
                    ? 'bg-lantern-primary text-white border-lantern-primary'
                    : 'bg-lantern-surface text-lantern-text border-lantern-border hover:bg-lantern-background-secondary'
                }`}
              >
                {qt.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between pt-2 flex-wrap gap-3">
          <AIUsageInline />
          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="min-h-[44px] px-4 py-2 text-sm font-medium text-lantern-text bg-lantern-background-secondary border border-lantern-border rounded-lg disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy}
              className="min-h-[44px] px-4 py-2 text-sm font-medium text-white bg-lantern-primary hover:bg-lantern-primary-dark rounded-lg shadow-sm flex items-center justify-center disabled:opacity-50"
            >
              {isGenerating && <AppIcon name="refresh" size={16} className="mr-2 animate-spin" aria-hidden />}
              {isGenerating ? 'Generating...' : 'Generate Questions'}
            </button>
          </div>
        </div>
      </form>
    </Modal>
  );
};

export default AIGenerateQuestionsModal;
