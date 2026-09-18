import React, { useMemo, useState } from 'react';
import {
  CREATE_FROM_SOURCE_NOUN,
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
  type QuizTypeCounts,
  type RecapLength,
  type RecapStyle,
  type TopicBrief,
  type TopicSkillLevel,
} from '@lantern/shared';
import type { Deck, StudyNote } from '../../types';
import { Button } from '../ui';
import type { AppIconName } from '../ui/AppIcon';
import { createDeckWithCards } from '../../services/apiEndpoints';
import { useToastStore } from '../../stores/toastStore';
import { StudySetMaterialTile } from './StudySetMaterialTile';
import { buildCreateOptions } from './createWizard/createOptions';
import {
  ALL_QUIZ_TYPES,
  DEFAULT_QUESTION_TOTAL,
  QUESTION_COUNT_CHOICES,
  QUESTION_TOTAL_MAX,
  QUIZ_TYPE_FIELDS,
  clampQuestionTotal,
  splitQuestionCounts,
  type QuizTypeKey,
} from './createWizard/questionCounts';
import { wizardStepIndex, wizardSteps, type WizardStepId } from './createWizard/wizardSteps';
import {
  ActionCard,
  ChoiceGroup,
  Disclosure,
  ToggleChip,
  WizardField,
  WizardShell,
} from './createWizard/WizardChrome';

/**
 * The create wizard: one question per screen, numbered.
 *
 * WHAT CHANGED AND WHY. It used to put four per-type number inputs and a
 * running total on one screen, and a title, a subject and a skill level on
 * another — a student had to do arithmetic before they could press Next, and
 * no screen said how many were left. Now every screen shows "Step N of M" and
 * asks one thing, the counts screen is a chip row plus a set of type toggles,
 * and the topic screen is a topic then a depth. Hick's law, and StudyFetch's
 * shape.
 *
 * WHAT DID NOT CHANGE: the payload. `buildCreateOptions` is the old
 * `options()` closure moved out verbatim, and `CreateFromSource.payload.test`
 * walks both step machines and compares what they send.
 *
 * Touches: `CourseWorkspace` (props below), `createDeckWithCards` for the
 * Anki/Quizlet paste, and the shared step machine in `createWizard/`.
 *
 * Gotchas:
 *  - The per-type counts are DERIVED (total × enabled types), except on the
 *    "Set each type" face where the four numbers are typed directly. Paths
 *    that never ask (a quiz from a topic, every non-quiz door) derive against
 *    multiple choice alone, which is the 20/0/0/0 those paths have always
 *    sent. Changing that default changes what the generator is asked for.
 *  - Everything with a default worth keeping lives behind "More options",
 *    collapsed: subject, lesson mode, recap style and length, the card count,
 *    the focus line and the essay rubric. Collapsed must always mean "send the
 *    defaults", never "unfinished".
 */

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

const SOURCE_ICON: Record<CreateFromSourceId, AppIconName> = {
  materials: 'document-text',
  topic: 'git-branch',
  flashcards: 'layers',
  import: 'cloud-upload',
  scratch: 'add',
};

/** How many source cards stand on the screen before "More ways" takes them. */
const SOURCE_CARDS_VISIBLE = 4;

/** "podcast" → "Podcast", without indexing a string the compiler distrusts. */
const sentenceCase = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);

const DEPTH_ICON: Record<TopicSkillLevel, AppIconName> = {
  intro: 'book-open',
  intermediate: 'layers',
  exam: 'trophy',
};

/**
 * The glyph on the illustration column's tile: the tool this run is making,
 * drawn the way the rail and the artifact library already draw it, so the
 * picture beside the question is not a second vocabulary.
 */
const KIND_ICON: Record<CreateFromSourceKind, AppIconName> = {
  quiz: 'help-circle',
  cards: 'layers',
  recap: 'headphones',
  lesson: 'school',
  play: 'game-controller',
  essay: 'document-text',
  test: 'clipboard',
  materials: 'document-text',
  notes: 'document',
};

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
  const [source, setSource] = useState<CreateFromSourceId | null>(null);
  const [stepId, setStepId] = useState<WizardStepId>('source');
  const [noteId, setNoteId] = useState<string | null>(null);
  const [deckIds, setDeckIds] = useState<string[]>([]);
  // How many questions, and which types — the two answers the counts screen
  // asks. `manualCounts` is the "Set each type" face.
  const [total, setTotal] = useState(DEFAULT_QUESTION_TOTAL);
  const [customTotal, setCustomTotal] = useState(false);
  const [enabledTypes, setEnabledTypes] = useState<QuizTypeKey[]>([...ALL_QUIZ_TYPES]);
  const [perType, setPerType] = useState(false);
  const [manualCounts, setManualCounts] = useState<QuizTypeCounts>(() =>
    splitQuestionCounts(DEFAULT_QUESTION_TOTAL, [...ALL_QUIZ_TYPES])
  );
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
  /**
   * The two props every screen's frame takes. Spread, not a wrapper component
   * declared in this body: a component defined during render is a new type on
   * every render, so React would unmount and remount the whole screen on each
   * keystroke — losing input focus and resetting the shell's step ref.
   */
  const shellChrome = {
    art: { icon: KIND_ICON[kind], label: noun },
    onExit: onCancel,
  } as const;
  const steps = useMemo(() => wizardSteps(kind, source), [kind, source]);
  const index = wizardStepIndex(steps, stepId);
  const asksTypes = steps.some((step) => step.id === 'types');

  const counts: QuizTypeCounts = perType
    ? manualCounts
    : splitQuestionCounts(total, asksTypes ? enabledTypes : ['multiple_choice']);

  const options = (): CreateFromSourceOptions =>
    buildCreateOptions(kind, {
      counts,
      title,
      focus,
      lessonMode,
      recapStyle,
      recapLength,
      rubricText,
    });

  const go = (next: WizardStepId) => setStepId(next);

  /** One screen back along this path; off step two it returns to the cards. */
  const back = () => {
    if (index <= 1) {
      setSource(null);
      setStepId('source');
      return;
    }
    const previous = steps[index - 1];
    if (previous) setStepId(previous.id);
  };

  const backButton = (
    <Button variant="ghost" onClick={back}>
      Back
    </Button>
  );

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

  const finishNote = (id?: string) => {
    const chosen = id ?? noteId;
    if (!chosen) return;
    onPickNote(chosen, options());
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
    if (id === 'scratch') {
      onPickScratch();
      return;
    }
    setSource(id);
    const next = wizardSteps(kind, id)[1];
    if (next) go(next.id);
  };

  /** Where a picked note goes next, unchanged from before the split. */
  const afterMaterials = (picked: string) => {
    setNoteId(picked);
    const next = steps[index + 1];
    if (!next) {
      finishNote(picked);
      return;
    }
    go(next.id);
  };

  if (stepId === 'materials') {
    return (
      <WizardShell
        {...shellChrome}
        steps={steps}
        index={index}
        hint={notes.length === 0 ? undefined : 'Pick one to carry on.'}
        actions={backButton}
      >
        {notes.length === 0 ? (
          <p className="text-body text-lantern-text-secondary">
            Import a note first, or go back and create from a topic.
          </p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {notes.map((note) => (
              <StudySetMaterialTile
                key={note.id}
                note={note}
                selected={note.id === noteId}
                onClick={() => afterMaterials(note.id)}
              />
            ))}
          </div>
        )}
      </WizardShell>
    );
  }

  if (stepId === 'decks') {
    return (
      <WizardShell
        {...shellChrome}
        steps={steps}
        index={index}
        hint={`We write ${QUIZ_FROM_CARDS_COUNT} multiple-choice questions from the cards in the decks you pick.`}
        actions={
          <>
            {backButton}
            <Button disabled={deckIds.length === 0} onClick={finishDecks}>
              Write {QUIZ_FROM_CARDS_COUNT} questions
            </Button>
          </>
        }
      >
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
      </WizardShell>
    );
  }

  if (stepId === 'topic') {
    const next = steps[index + 1];
    return (
      <WizardShell
        {...shellChrome}
        steps={steps}
        index={index}
        hint={
          kind === 'materials'
            ? 'We write starter notes from this brief.'
            : `We write starter notes from this brief, then build the ${noun}.`
        }
        actions={
          <>
            {backButton}
            <Button
              disabled={topicTitle.trim().length < 2}
              onClick={() => (next ? go(next.id) : finishTopic())}
            >
              Next
            </Button>
          </>
        }
      >
        <WizardField
          label="Topic"
          value={topicTitle}
          autoFocus
          onChange={setTopicTitle}
          onEnter={() => {
            if (topicTitle.trim().length >= 2 && next) go(next.id);
          }}
          placeholder="e.g. social determinants of health"
        />
      </WizardShell>
    );
  }

  if (stepId === 'depth') {
    return (
      <WizardShell
        {...shellChrome}
        steps={steps}
        index={index}
        actions={
          <>
            {backButton}
            <Button onClick={finishTopic}>Create {noun}</Button>
          </>
        }
      >
        <ChoiceGroup
          label="How deep should it go?"
          variant="card"
          value={topicLevel}
          onChange={setTopicLevel}
          options={TOPIC_SKILL_LEVELS.map((item) => ({
            value: item.id,
            label: item.label,
            promise: item.promise,
            icon: DEPTH_ICON[item.id],
          }))}
        />
        <Disclosure id="create-depth-more" label="More options">
          <WizardField
            label="Subject (optional)"
            value={topicSubject}
            onChange={setTopicSubject}
            placeholder="e.g. Public health"
          />
          {kind === 'lesson' ? (
            <ChoiceGroup
              label="Lesson mode"
              value={lessonMode}
              onChange={setLessonMode}
              options={LESSON_MODES.map((item) => ({ value: item.id, label: item.label }))}
            />
          ) : null}
          {kind === 'cards' ? (
            <label className="block">
              <span className="mb-1 block text-caption text-lantern-text-secondary">
                How many cards
              </span>
              <input
                type="number"
                min={5}
                max={QUESTION_TOTAL_MAX}
                value={total}
                // The old screen's clamp, kept verbatim: an emptied box reads
                // as 10 rather than as the floor.
                onChange={(event) =>
                  setTotal(Math.max(5, Math.min(40, Number(event.target.value) || 10)))
                }
                className="min-h-[44px] w-full rounded-xl border border-lantern-border bg-lantern-surface px-3 py-2 text-body"
              />
            </label>
          ) : null}
          {kind === 'recap' ? (
            <>
              <ChoiceGroup
                label="Recap style"
                value={recapStyle}
                onChange={setRecapStyle}
                options={(['summary', 'lecture', 'podcast'] as RecapStyle[]).map((id) => ({
                  value: id,
                  label: sentenceCase(id),
                }))}
              />
              <ChoiceGroup
                label="Recap length"
                value={recapLength}
                onChange={setRecapLength}
                options={(['short', 'medium', 'long'] as RecapLength[]).map((id) => ({
                  value: id,
                  label: sentenceCase(id),
                }))}
              />
            </>
          ) : null}
        </Disclosure>
      </WizardShell>
    );
  }

  if (stepId === 'count') {
    const next = steps[index + 1];
    return (
      <WizardShell
        {...shellChrome}
        steps={steps}
        index={index}
        actions={
          <>
            {backButton}
            <Button disabled={total < 1} onClick={() => next && go(next.id)}>
              Next
            </Button>
          </>
        }
      >
        <ChoiceGroup
          label="How many questions?"
          value={customTotal ? 'custom' : total}
          onChange={(value) => {
            if (value === 'custom') {
              setCustomTotal(true);
              return;
            }
            setCustomTotal(false);
            setTotal(Number(value));
            setPerType(false);
          }}
          options={[
            ...QUESTION_COUNT_CHOICES.map((count) => ({
              value: count as number | 'custom',
              label: String(count),
            })),
            { value: 'custom' as number | 'custom', label: 'Custom' },
          ]}
        />
        {customTotal ? (
          <label className="block max-w-[12rem]">
            <span className="mb-1 block text-caption text-lantern-text-secondary">
              How many questions
            </span>
            <input
              type="number"
              min={1}
              max={QUESTION_TOTAL_MAX}
              value={total}
              onChange={(event) => {
                setTotal(clampQuestionTotal(Number(event.target.value)));
                setPerType(false);
              }}
              className="min-h-[44px] w-full rounded-xl border border-lantern-border bg-lantern-surface px-3 py-2 text-body"
            />
          </label>
        ) : null}
      </WizardShell>
    );
  }

  if (stepId === 'types') {
    const allOn = enabledTypes.length === ALL_QUIZ_TYPES.length;
    const totalNow = quizTypeCountTotal(counts);
    const next = steps[index + 1];
    return (
      <WizardShell
        {...shellChrome}
        steps={steps}
        index={index}
        hint={
          perType
            ? `${totalNow} questions in total.`
            : allOn
              ? "We'll mix them."
              : `Only these — ${totalNow} questions in total.`
        }
        actions={
          <>
            {backButton}
            <Button disabled={totalNow < 1} onClick={() => next && go(next.id)}>
              Next
            </Button>
          </>
        }
      >
        {perType ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {QUIZ_TYPE_FIELDS.map((field) => (
              <label key={field.key} className="rounded-xl border border-lantern-border p-3">
                <span className="mb-1 block text-caption text-lantern-text-secondary">
                  {field.label}
                </span>
                <input
                  type="number"
                  min={0}
                  max={QUESTION_TOTAL_MAX}
                  value={manualCounts[field.key]}
                  onChange={(event) =>
                    setManualCounts((current) => ({
                      ...current,
                      [field.key]: Math.max(0, Number(event.target.value) || 0),
                    }))
                  }
                  className="min-h-[44px] w-full rounded-lg border border-lantern-border bg-lantern-surface px-3 py-2 text-body"
                />
              </label>
            ))}
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {QUIZ_TYPE_FIELDS.map((field) => (
              <ToggleChip
                key={field.key}
                label={field.label}
                on={enabledTypes.includes(field.key)}
                onClick={() =>
                  setEnabledTypes((current) =>
                    current.includes(field.key)
                      ? current.filter((key) => key !== field.key)
                      : [...current, field.key]
                  )
                }
              />
            ))}
          </div>
        )}
        <button
          type="button"
          onClick={() => {
            // Opening the per-type face seeds it with the split the student is
            // already looking at, so the numbers never jump under them.
            if (!perType) setManualCounts(splitQuestionCounts(total, enabledTypes));
            setPerType((was) => !was);
          }}
          className="inline-flex min-h-[44px] items-center text-caption font-medium text-lantern-text-secondary hover:text-lantern-text hover:underline"
        >
          {perType ? 'Back to a mix' : 'Set each type'}
        </button>
      </WizardShell>
    );
  }

  if (stepId === 'details') {
    return (
      <WizardShell
        {...shellChrome}
        steps={steps}
        index={index}
        actions={
          <>
            {backButton}
            <Button onClick={() => finishNote()}>Create {noun}</Button>
          </>
        }
      >
        <WizardField
          label={`${noun[0].toUpperCase()}${noun.slice(1)} name`}
          value={title}
          autoFocus
          onChange={setTitle}
          onEnter={() => finishNote()}
          placeholder="Optional — we'll name it for you"
        />
        <Disclosure id="create-details-more" label="More options">
          <WizardField
            label="Focus topic (optional)"
            value={focus}
            onChange={setFocus}
            placeholder="Narrow it to one thing"
          />
          {kind === 'essay' ? (
            <label className="block">
              <span className="mb-1 block text-caption text-lantern-text-secondary">
                Rubric — one criterion per line
              </span>
              <textarea
                value={rubricText}
                onChange={(event) => setRubricText(event.target.value)}
                rows={4}
                className="w-full rounded-xl border border-lantern-border bg-lantern-surface px-3 py-2 text-body"
              />
            </label>
          ) : null}
        </Disclosure>
      </WizardShell>
    );
  }

  if (stepId === 'anki') {
    return (
      <WizardShell
        {...shellChrome}
        steps={steps}
        index={index}
        hint="One card per line, term and definition separated by a tab."
        actions={
          <>
            {backButton}
            <Button onClick={() => void importCards()}>Import</Button>
          </>
        }
      >
        <textarea
          value={importText}
          onChange={(event) => setImportText(event.target.value)}
          rows={8}
          aria-label="Anki or Quizlet export"
          className="w-full rounded-xl border border-lantern-border bg-lantern-surface px-3 py-2 text-body"
        />
      </WizardShell>
    );
  }

  const visible = sources.slice(0, SOURCE_CARDS_VISIBLE);
  const overflow = sources.slice(SOURCE_CARDS_VISIBLE);

  return (
    <WizardShell
      {...shellChrome}
      steps={steps}
      index={0}
      // No Cancel button here: the shell's Exit pill is the way out, and it is
      // on EVERY screen — the old Cancel existed only on this one.
      actions={null}
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {visible.map((id) => {
          const copy = sourceCardCopy(id, kind);
          return (
            <ActionCard
              key={id}
              icon={SOURCE_ICON[id]}
              title={copy.title}
              promise={copy.promise}
              onClick={() => openSource(id)}
            />
          );
        })}
      </div>
      {overflow.length > 0 ? (
        <Disclosure id="create-source-more" label="More ways">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {overflow.map((id) => {
              const copy = sourceCardCopy(id, kind);
              return (
                <ActionCard
                  key={id}
                  icon={SOURCE_ICON[id]}
                  title={copy.title}
                  promise={copy.promise}
                  onClick={() => openSource(id)}
                />
              );
            })}
          </div>
        </Disclosure>
      ) : null}
    </WizardShell>
  );
};

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
