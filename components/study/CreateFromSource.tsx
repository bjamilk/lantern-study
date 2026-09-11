import React, { useState } from 'react';
import {
  DEFAULT_QUIZ_TYPE_COUNTS,
  quizTypeCountTotal,
  type QuizTypeCounts,
} from '@lantern/shared';
import type { Deck, StudyNote } from '../../types';
import { Button } from '../ui';
import { AppIcon } from '../ui/AppIcon';
import { createDeckWithCards } from '../../services/apiEndpoints';
import { useToastStore } from '../../stores/toastStore';
import { StudySetMaterialTile } from './StudySetMaterialTile';

type WizardStep = 'source' | 'materials' | 'counts' | 'details' | 'anki';

interface CreateFromSourceProps {
  kind: 'quiz' | 'cards' | 'recap' | 'lesson';
  notes: StudyNote[];
  decks: Deck[];
  studySetId?: string;
  onCancel: () => void;
  onPickNote: (noteId: string, options?: { questionCount?: number; title?: string; focus?: string }) => void;
  onPickScratch: () => void;
}

const QUIZ_TYPE_FIELDS: Array<{ key: keyof QuizTypeCounts; label: string }> = [
  { key: 'multiple_choice', label: 'Multiple choice' },
  { key: 'true_false', label: 'True / false' },
  { key: 'fill_in_blank', label: 'Fill in the blank' },
  { key: 'short_answer', label: 'Short answer' },
];

export const CreateFromSource: React.FC<CreateFromSourceProps> = ({
  kind,
  notes,
  studySetId,
  onCancel,
  onPickNote,
  onPickScratch,
}) => {
  const [step, setStep] = useState<WizardStep>('source');
  const [noteId, setNoteId] = useState<string | null>(null);
  const [counts, setCounts] = useState<QuizTypeCounts>({ ...DEFAULT_QUIZ_TYPE_COUNTS });
  const [title, setTitle] = useState('');
  const [focus, setFocus] = useState('');
  const [importText, setImportText] = useState('');
  const showToast = useToastStore((s) => s.showToast);
  const noun =
    kind === 'quiz' ? 'quiz' : kind === 'cards' ? 'deck' : kind === 'recap' ? 'recap' : 'lesson';
  const quizWizard = kind === 'quiz';

  const importCards = async () => {
    const cards = parseCardExport(importText);
    if (cards.length === 0) {
      showToast('Paste Anki or Quizlet text: one card per line, front and back separated by a tab.', 'info');
      return;
    }
    try {
      await createDeckWithCards({
        name: kind === 'cards' ? 'Imported cards' : 'Imported deck',
        studySetId,
        cards: cards.map((card) => ({ type: 'BASIC' as const, front: card.front, back: card.back })),
      });
      showToast(`${cards.length} cards imported into this set.`, 'success');
      onPickScratch();
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not import those cards.', 'error');
    }
  };

  const finish = () => {
    if (!noteId) return;
    onPickNote(noteId, {
      questionCount: quizTypeCountTotal(counts) || 20,
      title: title.trim() || undefined,
      focus: focus.trim() || undefined,
    });
  };

  if (step === 'materials') {
    return (
      <div className="flex-1 min-h-0 overflow-y-auto space-y-3">
        <h2 className="text-heading">Pick materials</h2>
        {notes.length === 0 ? (
          <p className="text-body text-lantern-text-secondary">Import a note first.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {notes.map((note) => (
              <StudySetMaterialTile
                key={note.id}
                note={note}
                selected={note.id === noteId}
                onClick={() => {
                  setNoteId(note.id);
                  if (quizWizard) setStep('counts');
                  else onPickNote(note.id);
                }}
              />
            ))}
          </div>
        )}
        <Button variant="ghost" onClick={() => setStep('source')}>
          Back
        </Button>
      </div>
    );
  }

  if (step === 'counts') {
    return (
      <div className="flex-1 min-h-0 overflow-y-auto space-y-4">
        <div>
          <h2 className="text-heading">Question types</h2>
          <p className="text-caption text-lantern-text-secondary mt-1">
            Default is 20 multiple choice. Adaptive quiz already understands these kinds.
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {QUIZ_TYPE_FIELDS.map((field) => (
            <label key={field.key} className="rounded-xl border border-lantern-border p-3">
              <span className="block text-caption text-lantern-text-secondary mb-1">{field.label}</span>
              <input
                type="number"
                min={0}
                max={40}
                value={counts[field.key]}
                onChange={(event) =>
                  setCounts((current) => ({
                    ...current,
                    [field.key]: Math.max(0, Number(event.target.value) || 0),
                  }))
                }
                className="w-full rounded-lg border border-lantern-border bg-lantern-surface px-3 py-2 text-body"
              />
            </label>
          ))}
        </div>
        <p className="text-caption text-lantern-text-secondary">{quizTypeCountTotal(counts)} questions total</p>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={() => setStep('materials')}>
            Back
          </Button>
          <Button disabled={quizTypeCountTotal(counts) < 1} onClick={() => setStep('details')}>
            Next
          </Button>
        </div>
      </div>
    );
  }

  if (step === 'details') {
    return (
      <div className="flex-1 min-h-0 overflow-y-auto space-y-4">
        <div>
          <h2 className="text-heading">Name this quiz</h2>
          <p className="text-caption text-lantern-text-secondary mt-1">
            Optional focus stays with this set. The writer uses the question count.
          </p>
        </div>
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Quiz name"
          className="w-full rounded-xl border border-lantern-border bg-lantern-surface px-3 py-2 text-body"
        />
        <input
          value={focus}
          onChange={(event) => setFocus(event.target.value)}
          placeholder="Focus topic (optional)"
          className="w-full rounded-xl border border-lantern-border bg-lantern-surface px-3 py-2 text-body"
        />
        <div className="flex gap-2">
          <Button variant="ghost" onClick={() => setStep('counts')}>
            Back
          </Button>
          <Button onClick={finish}>Create quiz</Button>
        </div>
      </div>
    );
  }

  if (step === 'anki') {
    return (
      <div className="flex-1 min-h-0 overflow-y-auto space-y-3">
        <h2 className="text-heading">Import Anki or Quizlet</h2>
        <p className="text-caption text-lantern-text-secondary">
          Paste an export: one card per line, term and definition separated by a tab.
        </p>
        <textarea
          value={importText}
          onChange={(event) => setImportText(event.target.value)}
          rows={8}
          className="w-full rounded-xl border border-lantern-border bg-lantern-surface px-3 py-2 text-body"
        />
        <div className="flex gap-2">
          <Button variant="ghost" onClick={() => setStep('source')}>
            Back
          </Button>
          <Button onClick={() => void importCards()}>Import</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 overflow-y-auto space-y-4">
      <div>
        <h2 className="text-heading">Create a {noun}</h2>
        <p className="text-body text-lantern-text-secondary mt-1">
          {quizWizard
            ? 'From materials, from flashcards, or from scratch.'
            : 'Step 1 — from materials, from a topic, or from scratch.'}
        </p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <SourceCard
          icon="document-text"
          title="From materials"
          promise="Use notes already in this set"
          onClick={() => setStep('materials')}
        />
        {quizWizard ? (
          <SourceCard
            icon="layers"
            title="From flashcards"
            promise="Use this set’s decks as the source notes"
            onClick={() => setStep('materials')}
          />
        ) : (
          <SourceCard
            icon="git-branch"
            title="From a topic"
            promise="Scope this to the recommended topic"
            onClick={() => setStep('materials')}
          />
        )}
        <SourceCard
          icon="add"
          title="From scratch"
          promise={kind === 'quiz' ? 'Open the quiz writer' : 'Start an empty deck'}
          onClick={onPickScratch}
        />
        {kind === 'cards' ? (
          <SourceCard
            icon="cloud-upload"
            title="Anki / Quizlet"
            promise="Paste a tab-separated export"
            onClick={() => setStep('anki')}
          />
        ) : null}
      </div>
      <Button variant="ghost" onClick={onCancel}>
        Cancel
      </Button>
    </div>
  );
};

function SourceCard({
  icon,
  title,
  promise,
  onClick,
}: {
  icon: 'document-text' | 'git-branch' | 'add' | 'cloud-upload' | 'layers';
  title: string;
  promise: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-2xl border border-lantern-border bg-lantern-surface p-4 text-left hover:bg-lantern-background-secondary"
    >
      <AppIcon name={icon} size={20} />
      <p className="mt-3 text-body font-semibold">{title}</p>
      <p className="text-caption text-lantern-text-secondary">{promise}</p>
    </button>
  );
}

export function parseCardExport(raw: string): Array<{ front: string; back: string }> {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      const parts = line.split('\t');
      if (parts.length < 2) {
        const dashed = line.split(' - ');
        if (dashed.length < 2) return [];
        return [{ front: dashed[0].trim(), back: dashed.slice(1).join(' - ').trim() }];
      }
      return [{ front: parts[0].trim(), back: parts.slice(1).join('\t').trim() }];
    })
    .filter((card) => card.front && card.back);
}

export default CreateFromSource;
