import React, { useState } from 'react';
import { useAutohideScrollbar } from '../../hooks/useAutohideScrollbar';
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
  TOPIC_SKILL_LEVELS,
  normalizeTopicBrief,
  topicBriefError,
  type TopicBrief,
  type TopicSkillLevel,
} from '@lantern/shared';
import { tileSceneForTool } from '@lantern/shared/design';
import type { Deck, StudyNote, StudySet } from '../../types';
import { AppIcon } from '../ui/AppIcon';
import { Button, Card } from '../ui';
import { Headline } from '../ui/Headline';
import { OwnWayGrid } from './OwnWayGrid';
import { RecentMaterials } from './RecentMaterials';
import { RoomRecommendationCard } from './RoomRecommendationCard';
import { RoomTopicRing } from './RoomTopicRing';
import { UnitChipRow } from './UnitChipRow';

/**
 * The two pill anatomies measured off the reference, spelt once.
 *
 * Both are 32px TALL and carry a 44px hit target through a transparent
 * pseudo-element rather than through a taller pill: the reference's controls
 * are 32px and growing them would be a different design, but a 32px tap
 * target is below every platform's minimum. `after:-inset-1.5` adds 6px on
 * each side of a 32px box, which is 44.
 */
const PILL_BASE =
  "relative inline-flex h-8 shrink-0 items-center justify-center rounded-full px-3 text-body font-medium after:absolute after:-inset-1.5 after:content-[''] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lantern-ink/40";
/** `View full study plan`, `Skip topic`: 1px hairline on the card ground. */
const PILL_SECONDARY = `${PILL_BASE} border border-lantern-border bg-lantern-surface text-lantern-text hover:border-lantern-text-tertiary`;
/** `Show more`: the tonal one — the second plane, no border. */
const PILL_TONAL = `${PILL_BASE} bg-lantern-background-secondary text-lantern-text hover:bg-lantern-border`;

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
  planGenerating?: boolean;
  onTool: (tool: StudySetHomeTool) => void;
  onOpenNote: (noteId: string) => void;
  onOpenDeck?: (deckId: string) => void;
  onOpenRecommended: (kind: StudySetRecommendedKind) => void;
  onSkipTopic?: (topicId: string) => void;
  onOpenPlan?: () => void;
  onOpenLibrary?: () => void;
  /** The ⋮ for one note, forwarded to the materials grid and list. */
  renderNoteMenu?: (note: StudyNote) => React.ReactNode;
  /** Empty-set starter notes from a topic, subject and skill level. */
  onGenerateFromTopic?: (brief: TopicBrief) => void;
  /**
   * The set's own header (tile, title, gear, stats), scrolled WITH the home
   * rather than pinned above it — which is what the reference does and what
   * Lantern did not. Pinned, it held ~90px of every scrolled view: a set's
   * name and its topic counts are not something you need in front of you
   * while you read the eighth material card. Only the 52px top bar stays.
   */
  header?: React.ReactNode;
  /**
   * "Sync with your class", above everything, for a set with no materials.
   *
   * Passed in rather than built here because it owns network state (the
   * upload, the extraction result, the Undo) and this component is otherwise
   * presentational. The GATE is here — an empty set — because `hasMaterials`
   * is already computed here and nothing else knows it as cheaply.
   */
  syncWithClass?: React.ReactNode;
  /**
   * Exam / syllabus, scrolled with the home rather than pinned under it.
   * Pinning a second card row was what ate the materials grid.
   */
  footer?: React.ReactNode;
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
  planGenerating,
  onTool,
  onOpenNote,
  onOpenDeck,
  onOpenRecommended,
  onSkipTopic,
  onOpenPlan,
  onOpenLibrary,
  renderNoteMenu,
  onGenerateFromTopic,
  header,
  syncWithClass,
  footer,
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
  const [topicTitle, setTopicTitle] = useState('');
  const [topicSubject, setTopicSubject] = useState('');
  const [topicLevel, setTopicLevel] = useState<TopicSkillLevel>('intermediate');
  const [topicError, setTopicError] = useState<string | null>(null);
  const activeUnitId =
    unitId && units.some((unit) => unit.id === unitId) ? unitId : nextTopic?.unitId || units[0]?.id;
  const unitTopics = activeUnitId ? topicsInUnit(topics, activeUnitId) : topics;
  const currentTopic =
    (nextTopic && nextTopic.unitId === activeUnitId ? nextTopic : null) ||
    pickRecommendedTopic(unitTopics, studySet?.mode || 'standard') ||
    unitTopics[0] ||
    nextTopic;
  const recommendedCards = STUDY_SET_RECOMMENDED_CARDS.filter((card) => card.primary);
  const moreCards = STUDY_SET_RECOMMENDED_CARDS.filter((card) => !card.primary);
  const [showMoreCards, setShowMoreCards] = useState(false);
  const homeScrollRef = useAutohideScrollbar<HTMLDivElement>();

  return (
    <div ref={homeScrollRef} className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain scrollbar-autohide space-y-4 pr-1 pb-2">
      {header}

      {/* The first landing in an empty set, ABOVE the own-way grid — the two
          facts that sharpen everything under it. A set with any material has
          moved past this question, and the parent stops rendering it once the
          student skips. Never a wall: everything below is still on the page. */}
      {!hasMaterials && syncWithClass ? syncWithClass : null}

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
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <Headline accent="study plan" feature="ai" size="eyebrow">
              Recommended from your study plan
            </Headline>
            {onOpenPlan ? (
              // The measured secondary pill: h32, r9999, 1px hairline, p8 12,
              // with the 44px hit target behind it. It was an underlined text
              // link, which is the one anatomy on this page that does not say
              // "this is a control you can press".
              <button type="button" onClick={onOpenPlan} className={PILL_SECONDARY}>
                View full study plan
              </button>
            ) : null}
          </div>

          {/* The numbered unit cards. Drawn whenever the plan has units at all,
              not only when it has two: a single `01 AI Foundations` still tells
              a student which stretch of the course they are standing in, which
              is the whole thing the flattened band was missing. */}
          <UnitChipRow units={units} activeUnitId={activeUnitId} onSelect={setUnitId} />

          {/* The topic card: r24 on the palest step of the AI lilac, which is
              the reference's #FCF6FF. NOT A NEW TOKEN — `feature-ai-tint` IS
              #f5d5ff, and a 30% wash of it over the card ground is that colour;
              minting a near-duplicate ground is what index.css's own note
              about the plan ring warns against. */}
          <div className="rounded-3xl bg-lantern-feature-ai-tint/30 p-4">
            <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
              <div className="flex min-w-0 items-center gap-3">
                <RoomTopicRing status={currentTopic.status} />
                <div className="min-w-0">
                  <p className="text-caption text-lantern-text-secondary">
                    {topicUnitLabel(topics, units, currentTopic)}
                  </p>
                  <h3 className="mt-0.5 text-body font-semibold text-lantern-text">
                    {currentTopic.title}
                  </h3>
                </div>
              </div>
              {onSkipTopic ? (
                <button
                  type="button"
                  onClick={() => onSkipTopic(currentTopic.id)}
                  className={PILL_SECONDARY}
                >
                  Skip topic
                  <AppIcon name="flag" size={14} aria-hidden className="ml-1.5" />
                </button>
              ) : null}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {recommendedCards.map((card) =>
                // The flashcards card keeps the SPOT illustration it was
                // authored for. Every other card takes the landscape SCENE the
                // art lane drew for that door (`tileSceneForTool`), and a card
                // with neither — `read` — keeps its glyph. Written as a literal
                // so the placement ledger in `Illustration.test.tsx` can see it.
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
                    scene={tileSceneForTool(card.id)}
                    eyebrow={card.eyebrow}
                    label={card.label}
                    about={RECOMMENDATION_ABOUT[card.id]}
                    onClick={() => onOpenRecommended(card.id)}
                  />
                )
              )}
            </div>
            {/* "Show more": the measured tonal pill, 120×32, no border. The
                other five doors were reachable only from the rail's practice
                drawer, which is a different mental model from "here are the
                ways into THIS topic". */}
            {moreCards.length > 0 ? (
              <button
                type="button"
                onClick={() => setShowMoreCards((value) => !value)}
                aria-expanded={showMoreCards}
                className={PILL_TONAL + ' mt-3'}
              >
                {showMoreCards ? 'Show less' : 'Show more'}
                <AppIcon
                  name={showMoreCards ? 'chevron-up' : 'chevron-down'}
                  size={14}
                  aria-hidden
                  className="ml-1.5"
                />
              </button>
            ) : null}
            {showMoreCards ? (
              <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-3">
                {moreCards.map((card) => (
                  <RoomRecommendationCard
                    key={card.id}
                    feature={card.feature}
                    icon={card.icon}
                    scene={tileSceneForTool(card.id)}
                    eyebrow={card.eyebrow}
                    label={card.label}
                    about={RECOMMENDATION_ABOUT[card.id]}
                    onClick={() => onOpenRecommended(card.id)}
                  />
                ))}
              </div>
            ) : null}
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

      {/* The measured panel: #F1F0E9 r16 p20 — which is `background-secondary`
          (#f2f0e8), the palette's second plane, not a new ground. The wall
          used to sit on the page with nothing behind it, so eight doors read
          as loose buttons rather than as one offer. */}
      <section className="rounded-2xl bg-lantern-background-secondary p-5">
        <div className="mb-3">
          <Headline accent="your own way" feature="sets">
            Or start learning your own way
          </Headline>
        </div>
        <OwnWayGrid onTool={onTool} />
      </section>

      {!hasMaterials && onGenerateFromTopic ? (
        <Card padding="lg">
          <h3 className="text-heading text-lantern-text">Generate starter materials</h3>
          <p className="text-body text-lantern-text-secondary mt-1">
            Name a topic and we file 3–8 notes in this set, then you can turn them into a quiz, cards, or a lesson.
          </p>
          <input
            value={topicTitle}
            onChange={(event) => setTopicTitle(event.target.value)}
            placeholder="Topic — e.g. renal physiology"
            className="mt-3 w-full rounded-xl border border-lantern-border bg-lantern-surface px-3 py-2 text-body"
          />
          <input
            value={topicSubject}
            onChange={(event) => setTopicSubject(event.target.value)}
            placeholder="Subject (optional)"
            className="mt-2 w-full rounded-xl border border-lantern-border bg-lantern-surface px-3 py-2 text-body"
          />
          <div className="mt-2 flex flex-wrap gap-2">
            {TOPIC_SKILL_LEVELS.map((level) => (
              <button
                key={level.id}
                type="button"
                aria-pressed={topicLevel === level.id}
                title={level.promise}
                onClick={() => setTopicLevel(level.id)}
                className={`min-h-[40px] rounded-full border px-3 text-caption ${
                  topicLevel === level.id
                    ? 'border-lantern-text font-semibold'
                    : 'border-lantern-border text-lantern-text-secondary'
                }`}
              >
                {level.label}
              </button>
            ))}
          </div>
          {topicError ? <p className="mt-2 text-caption text-lantern-error">{topicError}</p> : null}
          <Button
            className="mt-3"
            onClick={() => {
              const brief = normalizeTopicBrief({
                title: topicTitle,
                subject: topicSubject,
                level: topicLevel,
              });
              if (!brief) {
                setTopicError(topicBriefError(topicTitle) || 'Name the topic first.');
                return;
              }
              setTopicError(null);
              onGenerateFromTopic(brief);
            }}
          >
            Generate 3–8 notes
          </Button>
        </Card>
      ) : null}

      {hasMaterials ? (
        <RecentMaterials
          notes={notes}
          decks={decks.map((deck) => ({ id: deck.id, name: deck.name }))}
          onOpenNote={onOpenNote}
          onOpenDeck={onOpenDeck}
          onViewAll={() => onOpenLibrary?.()}
          renderNoteMenu={renderNoteMenu}
          // Home gets the type filter and nothing else, as measured. Sort and
          // the grid/list toggle live on the Materials page, where the whole
          // archive is the subject.
          showViewControls={false}
        />
      ) : null}

      {footer ? <div className="pt-1">{footer}</div> : null}
    </div>
  );
};

export default StudySetHome;
