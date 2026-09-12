import React, { useState } from 'react';
import {
  STUDY_SET_HOME_PRIMARY_TOOL_IDS,
  STUDY_SET_HOME_TOOLS,
  STUDY_SET_RECOMMENDED_CARDS,
  formatCourseMaterialCounts,
  pickRecommendedTopic,
  studySetPlanProgress,
  topicIndexLabel,
  topicsFromReadingNotes,
  topicsInUnit,
  unitsForTopics,
  type StudySetHomeTool,
  type StudySetRecommendedKind,
  type StudySetTopic,
  type StudySetUnit,
  type UpcomingExam,
} from '@lantern/shared';
import type { StudyNote, StudySet } from '../../types';
import { AppIcon } from '../ui/AppIcon';
import { Button, Card } from '../ui';
import { DoorTile } from '../ui/DoorTile';
import { FeatureDisc } from '../ui/FeatureDisc';
import { Headline } from '../ui/Headline';
import { FEATURE_INK_TEXT, FEATURE_TINT_BG } from '../ui/featureClasses';
import { StudySetMaterialTile } from './StudySetMaterialTile';

interface StudySetHomeProps {
  setLabel: string;
  notes: StudyNote[];
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
  onOpenRecommended: (kind: StudySetRecommendedKind) => void;
  onSkipTopic?: (topicId: string) => void;
  onOpenPlan?: () => void;
  onOpenCalendar?: () => void;
  onAddSyllabus?: () => void;
}

export const StudySetHome: React.FC<StudySetHomeProps> = ({
  notes,
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
  onOpenRecommended,
  onSkipTopic,
  onOpenPlan,
  onOpenCalendar,
  onAddSyllabus,
}) => {
  const primary = STUDY_SET_HOME_TOOLS.filter((tool) =>
    STUDY_SET_HOME_PRIMARY_TOOL_IDS.includes(tool.id)
  );
  const more = STUDY_SET_HOME_TOOLS.filter(
    (tool) => !STUDY_SET_HOME_PRIMARY_TOOL_IDS.includes(tool.id)
  );
  const hasMaterials = notes.length > 0 || deckCount > 0 || testCount > 0;
  const counts = formatCourseMaterialCounts({
    notes: notes.length,
    decks: deckCount,
    tests: testCount,
  });
  const derived = studySet ? topicsFromReadingNotes(studySet.id, notes) : null;
  const topics = planTopics && planTopics.length > 0 ? planTopics : derived?.topics ?? [];
  const units = unitsForTopics(
    planUnits.length > 0 ? planUnits : derived ? [derived.unit] : [],
    topics
  );
  const progress = topics.length > 0 ? studySetPlanProgress(topics) : null;
  const nextTopic = pickRecommendedTopic(topics, studySet?.mode || 'standard');
  const [unitId, setUnitId] = useState<string | null>(null);
  const [showMore, setShowMore] = useState(false);
  const activeUnitId = unitId && units.some((unit) => unit.id === unitId) ? unitId : nextTopic?.unitId || units[0]?.id;
  const unitTopics = activeUnitId ? topicsInUnit(topics, activeUnitId) : topics;
  const currentTopic =
    (nextTopic && nextTopic.unitId === activeUnitId ? nextTopic : null) ||
    pickRecommendedTopic(unitTopics, studySet?.mode || 'standard') ||
    unitTopics[0] ||
    nextTopic;
  const recommendedCards = STUDY_SET_RECOMMENDED_CARDS.filter((card) => showMore || card.primary);
  const empty = !hasMaterials && topics.length === 0 && !planGenerating;

  return (
    <div className="flex-1 min-h-0 overflow-y-auto space-y-6 pr-1">
      {progress || hasMaterials ? (
        <div>
          <p className="text-caption text-lantern-text-secondary">
            {progress
              ? `${progress.topics} topics · ${progress.covered} covered · ${progress.mastered} mastered`
              : counts}
          </p>
          {progress && progress.topics > 0 ? (
            <div className="mt-2 h-1.5 rounded-full bg-lantern-background-secondary overflow-hidden">
              <div
                className="h-full bg-lantern-primary-fill"
                style={{ width: `${Math.round((progress.covered / progress.topics) * 100)}%` }}
              />
            </div>
          ) : null}
        </div>
      ) : null}

      {planGenerating ? (
        <Card padding="lg">
          <p className="text-heading">Generating your study plan…</p>
          <p className="text-body text-lantern-text-secondary mt-1">
            We are turning the new material into topics. You can keep using this set.
          </p>
        </Card>
      ) : null}

      {empty ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Card padding="md">
            <p className="text-heading">Add your syllabus</p>
            <p className="text-caption text-lantern-text-secondary mt-1">
              Import a syllabus or notes so this set can build a plan.
            </p>
            <Button size="sm" className="mt-3" onClick={() => onAddSyllabus?.()}>
              Add syllabus
            </Button>
          </Card>
          <Card padding="md">
            <p className="text-heading">Exam dates</p>
            <p className="text-caption text-lantern-text-secondary mt-1">
              Add an exam so the calendar can group what to study.
            </p>
            <Button size="sm" variant="secondary" className="mt-3" onClick={() => onOpenCalendar?.()}>
              Add exam
            </Button>
          </Card>
        </div>
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
          {units.length > 1 ? (
            <div className="flex gap-2 overflow-x-auto pb-2 mb-3">
              {units.map((unit, index) => {
                const active = unit.id === activeUnitId;
                return (
                  <button
                    key={unit.id}
                    type="button"
                    onClick={() => setUnitId(unit.id)}
                    className={`shrink-0 min-h-[40px] rounded-full border px-3 text-caption ${
                      active
                        ? 'border-transparent bg-lantern-primary-fill text-white'
                        : 'border-lantern-border text-lantern-text-secondary'
                    }`}
                  >
                    {String(index + 1).padStart(2, '0')} {unit.title}
                  </button>
                );
              })}
            </div>
          ) : null}
          <div className="rounded-2xl bg-lantern-background-secondary/70 p-4">
            <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
              <div>
                <p className="text-caption text-lantern-text-secondary">
                  {topicIndexLabel(topics, currentTopic)}
                </p>
                <h3 className="text-heading text-lantern-text mt-1">{currentTopic.title}</h3>
              </div>
              {onSkipTopic ? (
                <Button size="sm" variant="ghost" onClick={() => onSkipTopic(currentTopic.id)}>
                  Skip topic
                </Button>
              ) : null}
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {recommendedCards.map((card) => (
                // The three ways into a topic are doors, not bespoke cards:
                // same anatomy, same pastel panel, same hard edge as every
                // other door in the product. The card's `eyebrow` ("Read the
                // note", "Drill the deck") is already a one-line promise, so
                // it becomes the door's promise rather than a fourth line.
                <DoorTile
                  key={card.id}
                  feature={card.feature}
                  icon={<AppIcon name={card.icon} size={16} />}
                  title={card.label}
                  promise={card.eyebrow}
                  onClick={() => onOpenRecommended(card.id)}
                />
              ))}
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
        {/* The four primary tools are DOORS — the thing this screen exists to
            offer — and the rest stay chips. Turning all eleven into doors
            would be eleven pastel panels on one screen, which is the point at
            which the hue stops telling you anything. */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {primary.map((tool) => {
            const door = {
              feature: tool.feature,
              icon: <AppIcon name={tool.icon} size={16} />,
              title: tool.label,
              promise: tool.promise,
              onClick: () => onTool(tool),
            };
            // The deck door is the one that carries art: a fan of cards says
            // "flashcards" at a glance in a row of otherwise glyph-only
            // doors, and it is the surface the drawing was authored for.
            // Written as a literal so the placement ledger can see it.
            return tool.id === 'cards' ? (
              <DoorTile key={tool.id} {...door} illustration="cards-fan" />
            ) : (
              <DoorTile key={tool.id} {...door} />
            );
          })}
        </div>
        <div className="flex flex-wrap gap-2 mt-4">
          {more.map((tool) => (
            <ToolPill key={tool.id} tool={tool} onClick={() => onTool(tool)} />
          ))}
        </div>
      </section>

      {exams.length > 0 ? (
        <section>
          <h2 className="text-title text-lantern-text mb-4">Exam dates</h2>
          {exams.map((exam) => (
            <button
              key={`${exam.examDate}-${exam.title}`}
              type="button"
              onClick={() => onOpenCalendar?.()}
              className="w-full rounded-xl border border-lantern-border bg-lantern-surface p-3 text-left mb-2"
            >
              <span className="block text-body font-semibold">{exam.title}</span>
              <span className="block text-caption text-lantern-text-secondary">{exam.examDate}</span>
            </button>
          ))}
        </section>
      ) : null}

      {notes.length > 0 ? (
        <section>
          <Headline accent="materials" feature="notes" className="mb-4">
            Recent materials
          </Headline>
          <div className="grid grid-cols-1 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {notes.slice(0, 8).map((note) => (
              <StudySetMaterialTile
                key={note.id}
                note={note}
                onClick={() => onOpenNote(note.id)}
              />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
};

/**
 * A secondary tool, as a chip.
 *
 * The `compact` flag is gone: the four primary tools are `DoorTile`s now, so
 * this is only ever the small form and a size prop with one caller is a prop
 * that will drift. The mark is a rounded pastel SQUARE with a black glyph —
 * the same `FeatureDisc` anatomy as every other typed row — so a chip and the
 * door it duplicates are recognisably the same object.
 */
function ToolPill({ tool, onClick }: { tool: StudySetHomeTool; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={tool.promise}
      className="inline-flex min-h-[44px] items-center gap-2 rounded-full border border-lantern-border bg-lantern-surface pl-1.5 pr-4 text-caption text-left hover:bg-lantern-background-secondary"
    >
      <FeatureDisc size={32} feature={tool.feature} icon={<AppIcon name={tool.icon} size={16} />} />
      {tool.label}
    </button>
  );
}

export default StudySetHome;
