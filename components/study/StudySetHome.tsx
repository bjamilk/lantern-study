import React, { useState } from 'react';
import {
  STUDY_SET_RECOMMENDED_CARDS,
  pickRecommendedTopic,
  topicUnitLabel,
  topicsFromReadingNotes,
  topicsInUnit,
  unitsForTopics,
  unitsFromSourceMaterials,
  type StudySetHomeTool,
  type StudySetRecommendedKind,
  type StudySetTopic,
  type StudySetUnit,
  type UpcomingExam,
} from '@lantern/shared';
import type { Deck, StudyNote, StudySet } from '../../types';
import { AppIcon } from '../ui/AppIcon';
import { Button, Card } from '../ui';
import { Headline } from '../ui/Headline';
import { OwnWayGrid } from './OwnWayGrid';
import { RecentMaterials } from './RecentMaterials';
import { RoomRecommendationCard } from './RoomRecommendationCard';
import { RoomTopicRing } from './RoomTopicRing';
import { SetRoomFooter } from './SetRoomFooter';

/**
 * `About ⓘ` — why this door is the one being offered, in one sentence.
 *
 * Kept beside the wall rather than in the shared registry: this copy is about
 * the RECOMMENDATION (why now, for this topic), and the registry's `eyebrow`
 * and `promise` are about the feature. Three kinds of sentence on one object is
 * how the old grid ended up with a label, a promise and a description.
 */
const RECOMMENDATION_ABOUT: Record<StudySetRecommendedKind, string> = {
  ask: 'Opens the companion already pointed at this set, so you can ask about this topic in your own words.',
  read: 'Opens the material this topic came from, so you can cover it before you are tested on it.',
  quiz: 'An adaptive quiz drawn from this set. Answering marks the topic covered.',
  cards: 'Drills the decks filed in this set, scheduled by what you keep forgetting.',
  lesson: 'A structured lesson built from your own notes, one step at a time.',
  recap: 'A generated listen-through of this set, for when you cannot read.',
  play: 'Match and speed games over this set’s cards.',
  test: 'A full practice test under exam conditions.',
};

interface StudySetHomeProps {
  setLabel: string;
  notes: StudyNote[];
  decks?: Deck[];
  deckCount: number;
  testCount: number;
  recommended?: StudyNote | null;
  studySet?: StudySet | null;
  planTopics?: StudySetTopic[];
  planUnits?: StudySetUnit[];
  exams?: UpcomingExam[];
  planGenerating?: boolean;
  onTool: (tool: StudySetHomeTool) => void;
  onOpenNote: (noteId: string) => void;
  onOpenDeck?: (deckId: string) => void;
  onOpenRecommended: (kind: StudySetRecommendedKind) => void;
  onSkipTopic?: (topicId: string) => void;
  onOpenPlan?: () => void;
  onOpenCalendar?: () => void;
  onOpenLibrary?: () => void;
  onAddSyllabus?: () => void;
}

export const StudySetHome: React.FC<StudySetHomeProps> = ({
  notes,
  decks = [],
  deckCount,
  testCount,
  recommended,
  studySet,
  planTopics,
  planUnits = [],
  exams = [],
  planGenerating,
  onTool,
  onOpenNote,
  onOpenDeck,
  onOpenRecommended,
  onSkipTopic,
  onOpenPlan,
  onOpenCalendar,
  onOpenLibrary,
  onAddSyllabus,
}) => {
  const hasMaterials = notes.length > 0 || deckCount > 0 || testCount > 0;
  const derived = studySet ? topicsFromReadingNotes(studySet.id, notes) : null;
  const storedTopics = planTopics && planTopics.length > 0 ? planTopics : derived?.topics ?? [];
  const storedUnits = planUnits.length > 0 ? planUnits : derived ? [derived.unit] : [];

  // The plan band needs UNITS to draw its `01`-`0N` pills, and a local plan
  // derived from notes files everything under one unit called "Your materials"
  // — one pill, no structure. When the stored plan has no real unit level,
  // group by the material each topic came from and name the unit after it.
  const grouped =
    storedUnits.length > 1 ? null : unitsFromSourceMaterials(storedTopics, notes);
  const topics = grouped && grouped.units.length > 1 ? grouped.topics : storedTopics;
  const units = unitsForTopics(
    grouped && grouped.units.length > 1 ? grouped.units : storedUnits,
    topics
  );

  const nextTopic = pickRecommendedTopic(topics, studySet?.mode || 'standard');
  const [unitId, setUnitId] = useState<string | null>(null);
  const [showMore, setShowMore] = useState(false);
  const activeUnitId =
    unitId && units.some((unit) => unit.id === unitId) ? unitId : nextTopic?.unitId || units[0]?.id;
  const unitTopics = activeUnitId ? topicsInUnit(topics, activeUnitId) : topics;
  const currentTopic =
    (nextTopic && nextTopic.unitId === activeUnitId ? nextTopic : null) ||
    pickRecommendedTopic(unitTopics, studySet?.mode || 'standard') ||
    unitTopics[0] ||
    nextTopic;
  const recommendedCards = STUDY_SET_RECOMMENDED_CARDS.filter((card) => showMore || card.primary);

  return (
    <div className="flex-1 min-h-0 overflow-y-auto space-y-6 pr-1">
      {planGenerating ? (
        <Card padding="lg">
          <p className="text-heading">Generating your study plan…</p>
          <p className="text-body text-lantern-text-secondary mt-1">
            We are turning the new material into topics. You can keep using this set.
          </p>
        </Card>
      ) : null}

      {currentTopic ? (
        <section>
          <div className="flex flex-wrap items-end justify-between gap-2 mb-3">
            <Headline accent="study plan" feature="ai">
              Recommended from your study plan
            </Headline>
            {onOpenPlan ? (
              <button
                type="button"
                onClick={onOpenPlan}
                className="min-h-[44px] text-caption font-medium text-lantern-primary-text hover:underline"
              >
                View full study plan
              </button>
            ) : null}
          </div>

          {/* The numbered unit pills. Drawn whenever the plan has units at all,
              not only when it has two: a single `01 AI Foundations` still tells
              a student which stretch of the course they are standing in, which
              is the whole thing the flattened band was missing. */}
          {units.length > 0 ? (
            <div className="flex gap-2 overflow-x-auto pb-2 mb-3">
              {units.map((unit, index) => {
                const active = unit.id === activeUnitId;
                return (
                  <button
                    key={unit.id}
                    type="button"
                    onClick={() => setUnitId(unit.id)}
                    aria-pressed={active}
                    className={`shrink-0 min-h-[40px] rounded-full border px-3 text-caption ${
                      active
                        ? 'border-lantern-text text-lantern-text font-semibold'
                        : 'border-lantern-border text-lantern-text-secondary hover:border-lantern-text-tertiary'
                    }`}
                  >
                    <span className="tabular-nums">{String(index + 1).padStart(2, '0')}</span>{' '}
                    {unit.title}
                  </button>
                );
              })}
            </div>
          ) : null}

          <div className="rounded-2xl border border-lantern-border bg-lantern-surface p-4">
            <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
              <div className="flex min-w-0 items-center gap-3">
                <RoomTopicRing status={currentTopic.status} />
                <div className="min-w-0">
                  <p className="text-caption text-lantern-text-secondary">
                    {topicUnitLabel(topics, units, currentTopic)}
                  </p>
                  <h3 className="text-heading text-lantern-text mt-1">{currentTopic.title}</h3>
                </div>
              </div>
              {onSkipTopic ? (
                <Button size="sm" variant="ghost" onClick={() => onSkipTopic(currentTopic.id)}>
                  Skip topic
                  <AppIcon name="flag" size={14} className="ml-1.5" />
                </Button>
              ) : null}
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {recommendedCards.map((card) =>
                // The flashcards card is the one that carries art: a fan of
                // cards says "flashcards" at a glance in a row of otherwise
                // glyph-only tiles, and it is the surface the drawing was
                // authored for. Written as a literal so the placement ledger in
                // `Illustration.test.tsx` can see it.
                card.id === 'cards' ? (
                  <RoomRecommendationCard
                    key={card.id}
                    feature={card.feature}
                    icon={card.icon}
                    illustration="cards-fan"
                    eyebrow={card.eyebrow}
                    label={card.label}
                    about={RECOMMENDATION_ABOUT[card.id]}
                    onClick={() => onOpenRecommended(card.id)}
                  />
                ) : (
                  <RoomRecommendationCard
                    key={card.id}
                    feature={card.feature}
                    icon={card.icon}
                    eyebrow={card.eyebrow}
                    label={card.label}
                    about={RECOMMENDATION_ABOUT[card.id]}
                    onClick={() => onOpenRecommended(card.id)}
                  />
                )
              )}
            </div>
            <button
              type="button"
              onClick={() => setShowMore((value) => !value)}
              className="mt-3 min-h-[44px] text-caption font-medium text-lantern-primary-text hover:underline"
            >
              {showMore ? 'Show less' : 'Show more'}
            </button>
          </div>
        </section>
      ) : recommended ? (
        <Card padding="md">
          <p className="text-label uppercase text-lantern-text-secondary mb-1">Continue from this set</p>
          <h3 className="text-heading text-lantern-text mb-2 truncate">
            {recommended.title || 'Untitled note'}
          </h3>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => onOpenRecommended('read')}>
              Read
            </Button>
            <Button size="sm" variant="secondary" onClick={() => onOpenRecommended('quiz')}>
              Quiz
            </Button>
            <Button size="sm" variant="secondary" onClick={() => onOpenRecommended('lesson')}>
              Tutor
            </Button>
          </div>
        </Card>
      ) : null}

      <section>
        <Headline accent="your own way" feature="sets" className="mb-4">
          Start learning your own way
        </Headline>
        <OwnWayGrid onTool={onTool} />
      </section>

      {hasMaterials ? (
        <RecentMaterials
          notes={notes}
          decks={decks.map((deck) => ({ id: deck.id, name: deck.name }))}
          onOpenNote={onOpenNote}
          onOpenDeck={onOpenDeck}
          onViewAll={() => onOpenLibrary?.()}
        />
      ) : null}

      {studySet ? (
        <SetRoomFooter
          studySetId={studySet.id}
          examDate={studySet.examDate ?? null}
          exams={exams}
          onViewSchedule={() => onOpenCalendar?.()}
          onAddSyllabus={() => onAddSyllabus?.()}
        />
      ) : null}
    </div>
  );
};

export default StudySetHome;
