import React, { useState } from 'react';
import type { Deck, StudyNote } from '../../types';
import { Button } from '../ui';
import { AppIcon } from '../ui/AppIcon';
import { createDeckWithCards } from '../../services/apiEndpoints';
import { useToastStore } from '../../stores/toastStore';

type SourceKind = 'materials' | 'topic' | 'scratch' | 'anki';

interface CreateFromSourceProps {
  kind: 'quiz' | 'cards' | 'recap' | 'lesson';
  notes: StudyNote[];
  decks: Deck[];
  studySetId?: string;
  onCancel: () => void;
  onPickNote: (noteId: string) => void;
  onPickScratch: () => void;
}

export const CreateFromSource: React.FC<CreateFromSourceProps> = ({
  kind,
  notes,
  studySetId,
  onCancel,
  onPickNote,
  onPickScratch,
}) => {
  const [step, setStep] = useState<SourceKind | 'pick'>('pick');
  const [importText, setImportText] = useState('');
  const showToast = useToastStore((s) => s.showToast);
  const noun =
    kind === 'quiz' ? 'quiz' : kind === 'cards' ? 'deck' : kind === 'recap' ? 'recap' : 'lesson';

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

  if (step === 'materials') {
    return (
      <div className="flex-1 min-h-0 overflow-y-auto space-y-3">
        <h2 className="text-heading">Pick materials</h2>
        {notes.length === 0 ? (
          <p className="text-body text-lantern-text-secondary">Import a note first.</p>
        ) : (
          notes.map((note) => (
            <button
              key={note.id}
              type="button"
              onClick={() => onPickNote(note.id)}
              className="w-full rounded-xl border border-lantern-border p-3 text-left hover:bg-lantern-background-secondary"
            >
              {note.title || 'Untitled note'}
            </button>
          ))
        )}
        <Button variant="ghost" onClick={() => setStep('pick')}>
          Back
        </Button>
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
          <Button variant="ghost" onClick={() => setStep('pick')}>
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
          Step 1 — from materials, from a topic, or from scratch.
        </p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <SourceCard
          icon="document-text"
          title="From materials"
          promise="Use notes already in this set"
          onClick={() => setStep('materials')}
        />
        <SourceCard
          icon="git-branch"
          title="From a topic"
          promise="Scope this to the recommended topic"
          onClick={() => setStep('materials')}
        />
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
  icon: 'document-text' | 'git-branch' | 'add' | 'cloud-upload';
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
