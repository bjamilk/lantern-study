import React, { useState } from 'react';
import {
  CREATE_FROM_SOURCE_NOUN,
  DEFAULT_QUIZ_TYPE_COUNTS,
  LESSON_MODES,
  QUIZ_FROM_CARDS_COUNT,
  TOPIC_SKILL_LEVELS,
  normalizeTopicBrief,
  quizTypeCountTotal,
  sourceCardCopy,
  sourcesForKind,
  topicBriefError,
  type CreateFromSourceKind,
  type CreateFromSourceId,
  type CreateFromSourceOptions,
  type LessonMode,
  type RecapLength,
  type RecapStyle,
  type TopicBrief,
  type TopicSkillLevel,
} from '@lantern/shared';
import type { Deck, StudyNote } from '../../types';
import { Button } from '../ui';
import { AppIcon } from '../ui/AppIcon';
import { createDeckWithCards } from '../../services/apiEndpoints';
import { useToastStore } from '../../stores/toastStore';
import { StudySetMaterialTile } from './StudySetMaterialTile';

type WizardStep = 'source' | 'materials' | 'decks' | 'topic' | 'counts' | 'details' | 'anki';

interface CreateFromSourceProps {
  kind: CreateFromSourceKind;
  notes: StudyNote[];
  decks: Deck[];
  studySetId?: string;
  onCancel: () => void;
  onPickNote: (noteId: string, options?: CreateFromSourceOptions) => void;
  onPickTopic: (brief: TopicBrief, options?: CreateFromSourceOptions) => void;
  onPickScratch: () => void;
  onPickDecks?: (deckIds: string[], options?: CreateFromSourceOptions) => void;
}

const QUIZ_TYPE_FIELDS: Array<{ key: keyof typeof DEFAULT_QUIZ_TYPE_COUNTS; label: string }> = [
  { key: 'multiple_choice', label: 'Multiple choice' },
  { key: 'true_false', label: 'True / false' },
  { key: 'fill_in_blank', label: 'Fill in the blank' },
  { key: 'short_answer', label: 'Short answer' },
];

export const CreateFromSource: React.FC<CreateFromSourceProps> = ({
  kind,
  notes,
  decks,
  studySetId,
  onCancel,
  onPickNote,
  onPickTopic,
  onPickScratch,
  onPickDecks,
}) => {
  const [step, setStep] = useState<WizardStep>('source');
  const [noteId, setNoteId] = useState<string | null>(null);
  const [deckIds, setDeckIds] = useState<string[]>([]);
  const [counts, setCounts] = useState({ ...DEFAULT_QUIZ_TYPE_COUNTS });
  const [title, setTitle] = useState('');
  const [focus, setFocus] = useState('');
  const [topicTitle, setTopicTitle] = useState('');
  const [topicSubject, setTopicSubject] = useState('');
  const [topicLevel, setTopicLevel] = useState<TopicSkillLevel>('intermediate');
  const [lessonMode, setLessonMode] = useState<LessonMode>('explore');
  const [recapStyle, setRecapStyle] = useState<RecapStyle>('podcast');
  const [recapLength, setRecapLength] = useState<RecapLength>('medium');
  const [rubricText, setRubricText] = useState('');
  const [importText, setImportText] = useState('');
  const showToast = useToastStore((s) => s.showToast);
  const noun = CREATE_FROM_SOURCE_NOUN[kind];
  const sources = sourcesForKind(kind);
  const quizWizard = kind === 'quiz';

  const options = (): CreateFromSourceOptions => ({
    questionCount: quizTypeCountTotal(counts) || (quizWizard ? QUIZ_FROM_CARDS_COUNT : undefined),
    title: title.trim() || undefined,
    focus: focus.trim() || undefined,
    quizTypes: counts,
    lessonMode: kind === 'lesson' ? lessonMode : undefined,
    recapStyle: kind === 'recap' ? recapStyle : undefined,
    recapLength: kind === 'recap' ? recapLength : undefined,
    rubricText: kind === 'essay' ? rubricText.trim() || undefined : undefined,
  });

  const importCards = async () => {
    const cards = parseCardExport(importText);
    if (cards.length === 0) {
      showToast('Paste Anki or Quizlet text: one card per line, front and back separated by a tab.', 'info');
      return;
    }
    try {
      await createDeckWithCards({
        name: 'Imported cards',
        studySetId,
        cards: cards.map((card) => ({ type: 'BASIC' as const, front: card.front, back: card.back })),
      });
      showToast(`${cards.length} cards imported into this set.`, 'success');
      onPickScratch();
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not import those cards.', 'error');
    }
  };

  const finishNote = () => {
    if (!noteId) return;
    onPickNote(noteId, options());
  };

  const finishTopic = () => {
    const brief = normalizeTopicBrief({ title: topicTitle, subject: topicSubject, level: topicLevel });
    if (!brief) {
      showToast(topicBriefError(topicTitle) || 'Name the topic first.', 'info');
      return;
    }
    onPickTopic(brief, options());
  };

  const finishDecks = () => {
    if (!onPickDecks || deckIds.length === 0) return;
    onPickDecks(deckIds, options());
  };

  const openSource = (id: CreateFromSourceId) => {
    if (id === 'materials') setStep('materials');
    else if (id === 'topic') setStep('topic');
    else if (id === 'flashcards') setStep('decks');
    else if (id === 'import') setStep('anki');
    else onPickScratch();
  };

  if (step === 'materials') {
    return (
      <div className="flex-1 min-h-0 overflow-y-auto space-y-3">
        <h2 className="text-heading">Pick materials</h2>
        {notes.length === 0 ? (
          <p className="text-body text-lantern-text-secondary">Import a note first, or go back and create from a topic.</p>
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
                  else if (kind === 'recap' || kind === 'lesson' || kind === 'essay') setStep('details');
                  else onPickNote(note.id, options());
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

  if (step === 'decks') {
    return (
      <div className="flex-1 min-h-0 overflow-y-auto space-y-3">
        <h2 className="text-heading">Pick decks</h2>
        <p className="text-caption text-lantern-text-secondary">
          We write {QUIZ_FROM_CARDS_COUNT} multiple-choice questions from the cards in the decks you pick.
        </p>
        {decks.length === 0 ? (
          <p className="text-body text-lantern-text-secondary">File a deck in this set first.</p>
        ) : (
          <div className="space-y-2">
            {decks.map((deck) => {
              const on = deckIds.includes(deck.id);
              return (
                <button
                  key={deck.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() =>
                    setDeckIds((current) =>
                      on ? current.filter((id) => id !== deck.id) : [...current, deck.id]
                    )
                  }
                  className={`w-full text-left rounded-xl border px-3 py-3 min-h-[44px] ${
                    on
                      ? 'border-lantern-text bg-lantern-background-secondary'
                      : 'border-lantern-border hover:bg-lantern-background-secondary'
                  }`}
                >
                  <span className="text-body font-semibold">{deck.name}</span>
                </button>
              );
            })}
          </div>
        )}
        <div className="flex gap-2">
          <Button variant="ghost" onClick={() => setStep('source')}>
            Back
          </Button>
          <Button disabled={deckIds.length === 0} onClick={finishDecks}>
            Write {QUIZ_FROM_CARDS_COUNT} questions
          </Button>
        </div>
      </div>
    );
  }

  if (step === 'topic') {
    return (
      <div className="flex-1 min-h-0 overflow-y-auto space-y-4">
        <div>
          <h2 className="text-heading">From a topic</h2>
          <p className="text-caption text-lantern-text-secondary mt-1">
            We write starter notes from this brief
            {kind === 'materials' ? '.' : `, then build the ${noun}.`}
          </p>
        </div>
        <input
          value={topicTitle}
          onChange={(event) => setTopicTitle(event.target.value)}
          placeholder="Topic — e.g. social determinants of health"
          className="w-full rounded-xl border border-lantern-border bg-lantern-surface px-3 py-2 text-body"
        />
        <input
          value={topicSubject}
          onChange={(event) => setTopicSubject(event.target.value)}
          placeholder="Subject (optional)"
          className="w-full rounded-xl border border-lantern-border bg-lantern-surface px-3 py-2 text-body"
        />
        <div className="flex flex-wrap gap-2">
          {TOPIC_SKILL_LEVELS.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={topicLevel === item.id}
              onClick={() => setTopicLevel(item.id)}
              className={`min-h-[44px] rounded-full border px-3 text-caption ${
                topicLevel === item.id
                  ? 'border-lantern-text font-semibold'
                  : 'border-lantern-border text-lantern-text-secondary'
              }`}
              title={item.promise}
            >
              {item.label}
            </button>
          ))}
        </div>
        {kind === 'lesson' ? (
          <div className="flex flex-wrap gap-2">
            {LESSON_MODES.map((item) => (
              <button
                key={item.id}
                type="button"
                aria-pressed={lessonMode === item.id}
                onClick={() => setLessonMode(item.id)}
                className={`min-h-[44px] rounded-full border px-3 text-caption ${
                  lessonMode === item.id
                    ? 'border-lantern-text font-semibold'
                    : 'border-lantern-border text-lantern-text-secondary'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        ) : null}
        {kind === 'cards' ? (
          <label className="block">
            <span className="block text-caption text-lantern-text-secondary mb-1">How many cards</span>
            <input
              type="number"
              min={5}
              max={40}
              value={counts.multiple_choice || 10}
              onChange={(event) =>
                setCounts((current) => ({
                  ...current,
                  multiple_choice: Math.max(5, Math.min(40, Number(event.target.value) || 10)),
                }))
              }
              className="w-full rounded-xl border border-lantern-border bg-lantern-surface px-3 py-2 text-body"
            />
          </label>
        ) : null}
        {kind === 'cards' ? (
          <label className="block">
            <span className="block text-caption text-lantern-text-secondary mb-1">How many cards</span>
            <input
              type="number"
              min={5}
              max={40}
              value={counts.multiple_choice || 10}
              onChange={(event) =>
                setCounts((current) => ({
                  ...current,
                  multiple_choice: Math.max(5, Math.min(40, Number(event.target.value) || 10)),
                }))
              }
              className="w-full rounded-xl border border-lantern-border bg-lantern-surface px-3 py-2 text-body"
            />
          </label>
        ) : null}
        {kind === 'recap' ? (
          <div className="flex flex-wrap gap-2">
            {(['summary', 'lecture', 'podcast'] as RecapStyle[]).map((id) => (
              <button
                key={id}
                type="button"
                aria-pressed={recapStyle === id}
                onClick={() => setRecapStyle(id)}
                className={`min-h-[44px] rounded-full border px-3 text-caption capitalize ${
                  recapStyle === id ? 'border-lantern-text font-semibold' : 'border-lantern-border'
                }`}
              >
                {id}
              </button>
            ))}
            {(['short', 'medium', 'long'] as RecapLength[]).map((id) => (
              <button
                key={id}
                type="button"
                aria-pressed={recapLength === id}
                onClick={() => setRecapLength(id)}
                className={`min-h-[44px] rounded-full border px-3 text-caption capitalize ${
                  recapLength === id ? 'border-lantern-text font-semibold' : 'border-lantern-border'
                }`}
              >
                {id}
              </button>
            ))}
          </div>
        ) : null}
        <div className="flex gap-2">
          <Button variant="ghost" onClick={() => setStep('source')}>
            Back
          </Button>
          <Button onClick={finishTopic}>Create {noun}</Button>
        </div>
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
          <h2 className="text-heading">Name this {noun}</h2>
          <p className="text-caption text-lantern-text-secondary mt-1">
            Optional focus stays with this set.
          </p>
        </div>
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder={`${noun[0].toUpperCase()}${noun.slice(1)} name`}
          className="w-full rounded-xl border border-lantern-border bg-lantern-surface px-3 py-2 text-body"
        />
        <input
          value={focus}
          onChange={(event) => setFocus(event.target.value)}
          placeholder="Focus topic (optional)"
          className="w-full rounded-xl border border-lantern-border bg-lantern-surface px-3 py-2 text-body"
        />
        {kind === 'essay' ? (
          <textarea
            value={rubricText}
            onChange={(event) => setRubricText(event.target.value)}
            rows={4}
            placeholder="Rubric — one criterion per line"
            className="w-full rounded-xl border border-lantern-border bg-lantern-surface px-3 py-2 text-body"
          />
        ) : null}
        <div className="flex gap-2">
          <Button variant="ghost" onClick={() => setStep(quizWizard ? 'counts' : 'materials')}>
            Back
          </Button>
          <Button onClick={finishNote}>Create {noun}</Button>
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
            : kind === 'materials'
              ? 'Generate 3–8 starter notes from a topic.'
              : 'From materials, from a topic, or from scratch.'}
        </p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {sources.map((id) => {
          const copy = sourceCardCopy(id, kind);
          return (
            <SourceCard
              key={id}
              icon={
                id === 'materials'
                  ? 'document-text'
                  : id === 'topic'
                    ? 'git-branch'
                    : id === 'flashcards'
                      ? 'layers'
                      : id === 'import'
                        ? 'cloud-upload'
                        : 'add'
              }
              title={copy.title}
              promise={copy.promise}
              onClick={() => openSource(id)}
            />
          );
        })}
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
