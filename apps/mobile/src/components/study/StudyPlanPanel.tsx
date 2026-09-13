/**
 * The Study Plan, as a spine.
 *
 * WHAT THIS REPLACES. A `<Card>` inside `CourseRoomScreen.tsx` holding a
 * caption, a `2 topics · 0 covered · 0 mastered` line, and a checkbox per topic.
 * It was honest and it was unreadable: nothing said which topic came next,
 * finished topics looked exactly like unfinished ones, and the plan's shape —
 * the units — was a divider line. StudyFetch draws the same data as a vertical
 * timeline you can read at a glance, and the parity audit ranked it the single
 * highest-value gap on mobile (`SF2-gap-reaudit.md` R1).
 *
 * THE ANATOMY, and where each piece's data comes from:
 *
 *   - a LILAC RAIL running the height of the list, with every disc sitting on
 *     it. The rail is the `ai` feature pair (#f5d5ff tint / #7b2cab ink,
 *     `packages/shared/src/design/tokens.ts`) — the plan is the AI's reading of
 *     the student's materials, so it takes the AI hue rather than a new one;
 *   - `Start learning here` at the top, so the spine has a head and the eye
 *     knows which end to start at;
 *   - collapsible UNIT cards, each with a partial-arc ring for how far through
 *     it you are;
 *   - TOPIC rows inside: done ones struck through behind a filled grey dot, the
 *     next one raised into a lilac-bordered card with a black `Continue` pill;
 *   - a `Details` pill opening a sheet with the counts, the bar, the syllabus
 *     card, the exam dates and `View schedule`.
 *
 * WHAT IS DELIBERATELY NOT HERE. `Sources` chips — StudyFetch names the
 * material under each unit, and Lantern's derived units ARE the materials, so
 * the chip would repeat the unit's own title. A `Mode`/`Sort` selector — the
 * mode is the SET's, changed in its settings; the chip here reports it and does
 * not pretend to set it.
 *
 * All arithmetic lives in ./studyPlanPresentation.ts. Nothing below computes a
 * count, a fraction or "which one is next".
 */
import React, { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import {
  featureAccentsDark,
  featureAccentsLight,
} from '@lantern/shared/design';
import type { StudySetTopic, StudySetTopicStatus, StudySetUnit } from '@lantern/shared/learning';
import { Button, Card, SheetShell, T } from '../ui';
import { AppIcon } from '../ui/AppIcon';
import { useTheme } from '../../theme';
import {
  buildStudyPlanModel,
  defaultOpenUnitId,
  nextTopicStatus,
  planExamRows,
  type PlanTopicRow,
  type PlanUnitRow,
} from './studyPlanPresentation';

/** The rail's width and the disc it threads through. One place, three users. */
const RAIL_WIDTH = 2;
const DISC = 34;
const RAIL_COLUMN = 44;

function useAiAccent() {
  const { isDark } = useTheme();
  return isDark ? featureAccentsDark.ai : featureAccentsLight.ai;
}

/**
 * A partial arc, drawn as a stroked circle with a dash gap.
 *
 * Not an animated one and not a library: a ring here is a static statement of
 * a fraction, and `strokeDasharray` over a rotated circle is the whole of it.
 * `fraction` is 0..1 from the presentation model — this function knows nothing
 * about topics.
 */
function ProgressRing({
  fraction,
  size,
  color,
  track,
  children,
}: {
  fraction: number;
  size: number;
  color: string;
  track: string;
  children?: React.ReactNode;
}) {
  const stroke = size >= 30 ? 3 : 2.5;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const filled = Math.max(0, Math.min(1, fraction)) * circumference;
  return (
    <View style={{ width: size, height: size }} className="items-center justify-center">
      <Svg width={size} height={size} style={{ position: 'absolute' }}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={track}
          strokeWidth={stroke}
          fill="none"
        />
        {filled > 0 ? (
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke={color}
            strokeWidth={stroke}
            strokeLinecap="round"
            fill="none"
            strokeDasharray={`${filled} ${circumference}`}
            // Start the arc at twelve o'clock rather than at three.
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        ) : null}
      </Svg>
      {children}
    </View>
  );
}

/** The bar under the header and in the Details sheet — one drawing, two places. */
function PlanProgressBar({ percent }: { percent: number }) {
  const accent = useAiAccent();
  return (
    // Ink on TINT, not tint on grey. StudyFetch's bar is a pale lilac on a
    // pale grey, which measures 1.21:1 in this palette — a progress bar nobody
    // can see is not a progress bar. The track takes the lilac and the fill
    // takes the same ink the rings use, so the bar and the rings state the
    // same fact in the same two colours (5.68:1 light, 9.49:1 dark).
    <View
      className="h-2 rounded-full overflow-hidden"
      style={{ backgroundColor: accent.tint }}
      accessibilityRole="progressbar"
      accessibilityValue={{ now: percent, min: 0, max: 100 }}
      accessibilityLabel={`Plan progress, ${percent} percent`}
    >
      <View
        style={{ width: `${Math.max(0, Math.min(100, percent))}%`, backgroundColor: accent.ink }}
        className="h-full rounded-full"
      />
    </View>
  );
}

/** One row of the spine: the rail column on the left, anything on the right. */
function SpineRow({
  disc,
  children,
  first,
  last,
}: {
  disc: React.ReactNode;
  children: React.ReactNode;
  /** No rail above the first row. */
  first?: boolean;
  /** No rail below the last. */
  last?: boolean;
}) {
  const accent = useAiAccent();
  return (
    <View className="flex-row items-start">
      <View style={{ width: RAIL_COLUMN }} className="items-center self-stretch">
        {/* The rail is drawn BEHIND the disc as two absolute segments — one
            above the disc's centre, one below — so a row's height is set by
            its content rather than by the line, and the first and last rows
            can drop the half that would dangle into nothing. */}
        {!first ? (
          <View
            className="absolute"
            style={{ width: RAIL_WIDTH, backgroundColor: accent.tint, top: 0, height: DISC / 2 }}
          />
        ) : null}
        {!last ? (
          <View
            className="absolute"
            style={{ width: RAIL_WIDTH, backgroundColor: accent.tint, top: DISC / 2, bottom: 0 }}
          />
        ) : null}
        <View style={{ marginTop: 2 }}>{disc}</View>
      </View>
      <View className="flex-1 pb-3">{children}</View>
    </View>
  );
}

function TopicDot({ row }: { row: PlanTopicRow }) {
  const accent = useAiAccent();
  const { colors } = useTheme();
  if (row.done) {
    // A finished topic stops being lilac: the hue is for what is still ahead.
    // The grey is `textTertiary`, the app's own retired ink — `surfaceSecondary`
    // is the obvious choice and measures 1.10:1 on a card, which is a dot only
    // the designer can see.
    return (
      <View
        style={{
          width: DISC - 10,
          height: DISC - 10,
          borderRadius: (DISC - 10) / 2,
          backgroundColor: colors.textTertiary,
        }}
      />
    );
  }
  return (
    <ProgressRing
      fraction={row.ring}
      size={DISC - 10}
      color={accent.ink}
      track={accent.tint}
    />
  );
}

function TopicRow({
  row,
  onToggle,
  onContinue,
  first,
  last,
}: {
  row: PlanTopicRow;
  onToggle: (next: StudySetTopicStatus) => void;
  onContinue: (row: PlanTopicRow) => void;
  first?: boolean;
  last?: boolean;
}) {
  const accent = useAiAccent();
  const { colors } = useTheme();

  if (row.next) {
    return (
      <SpineRow first={first} last={last} disc={<TopicDot row={row} />}>
        <View
          className="rounded-2xl px-4 py-3"
          style={{ borderWidth: 1, borderColor: accent.tint, backgroundColor: colors.surface }}
        >
          <T.Body>{row.title}</T.Body>
          <T.Caption tone="secondary" className="mt-1">
            Pick up where you left off
          </T.Caption>
          <Button size="sm" className="mt-3" onPress={() => onContinue(row)}>
            Continue
          </Button>
          <Pressable
            onPress={() => onToggle(nextTopicStatus(row.status))}
            accessibilityRole="button"
            accessibilityLabel={`${row.accessibilityLabel}. Tap to change`}
            className="mt-2 self-start py-1"
          >
            <T.Caption tone="tertiary">Mark {row.status === 'unseen' ? 'covered' : 'mastered'}</T.Caption>
          </Pressable>
        </View>
      </SpineRow>
    );
  }

  return (
    <SpineRow first={first} last={last} disc={<TopicDot row={row} />}>
      <Pressable
        onPress={() => onToggle(nextTopicStatus(row.status))}
        accessibilityRole="button"
        accessibilityLabel={`${row.accessibilityLabel}. Tap to change`}
        className="py-2 pr-2"
      >
        <T.Body
          numberOfLines={2}
          tone={row.done ? 'secondary' : 'text'}
          // The strike is the "done" signal; the status is also spoken, so a
          // screen reader is never left reading a plain line.
          style={row.done ? { textDecorationLine: 'line-through' } : undefined}
        >
          {row.title}
        </T.Body>
      </Pressable>
    </SpineRow>
  );
}

function UnitCard({
  unit,
  expanded,
  onToggleUnit,
  onToggleTopic,
  onContinue,
}: {
  unit: PlanUnitRow;
  expanded: boolean;
  onToggleUnit: () => void;
  onToggleTopic: (topicId: string, next: StudySetTopicStatus) => void;
  onContinue: (row: PlanTopicRow) => void;
}) {
  const accent = useAiAccent();
  return (
    <Card className="mb-3">
      <Pressable
        onPress={onToggleUnit}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={`${unit.label}. ${unit.progressLabel}`}
        className="flex-row items-center gap-3"
      >
        <AppIcon name={expanded ? 'chevron-up' : 'chevron-down'} size={20} />
        <ProgressRing fraction={unit.ring} size={DISC - 10} color={accent.ink} track={accent.tint} />
        <View className="flex-1">
          <T.Body numberOfLines={2}>{unit.label}</T.Body>
          <T.Caption tone="tertiary">{unit.progressLabel}</T.Caption>
        </View>
      </Pressable>
      {expanded ? (
        <View className="mt-3">
          {unit.topics.map((row, index) => (
            <TopicRow
              key={row.id}
              row={row}
              first={index === 0}
              last={index === unit.topics.length - 1}
              onToggle={(next) => onToggleTopic(row.id, next)}
              onContinue={onContinue}
            />
          ))}
        </View>
      ) : null}
    </Card>
  );
}

export interface StudyPlanPanelProps {
  units: readonly StudySetUnit[];
  topics: readonly StudySetTopic[];
  /** Notes and lectures, so a flat plan can borrow their titles for its units. */
  materials: readonly { id: string; title?: string | null }[];
  mode?: 'cram' | 'standard' | 'comprehensive';
  /** True only once the server has answered — "no plan" is not "not asked". */
  planLoaded: boolean;
  /** False while the topics are read off note titles rather than a saved plan. */
  usingServerPlan: boolean;
  /** Disabled when there is nothing to build a plan out of. */
  canBuildPlan: boolean;
  onGeneratePlan: () => Promise<void>;
  onToggleTopic: (topicId: string, next: StudySetTopicStatus) => void;
  /** Opens the topic's material, or the companion when it has none. */
  onContinue: (topic: PlanTopicRow) => void;
  onAddSyllabus: () => void;
  onAddExam: () => void;
  onViewSchedule: () => void;
  examDate?: string | null;
  /** `YYYY-MM-DD`. Injected so "is this exam past" is testable. */
  today: string;
}

export function StudyPlanPanel({
  units,
  topics,
  materials,
  mode,
  planLoaded,
  usingServerPlan,
  canBuildPlan,
  onGeneratePlan,
  onToggleTopic,
  onContinue,
  onAddSyllabus,
  onAddExam,
  onViewSchedule,
  examDate,
  today,
}: StudyPlanPanelProps) {
  const accent = useAiAccent();
  const { colors } = useTheme();
  const model = useMemo(
    () => buildStudyPlanModel({ units, topics, materials, mode }),
    [units, topics, materials, mode]
  );
  // `null` means "not chosen yet", so the seed can follow the plan as it fills
  // in rather than freezing whichever unit was open on first paint.
  const [openUnitId, setOpenUnitId] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [generating, setGenerating] = useState(false);
  const openId = openUnitId ?? defaultOpenUnitId(model);
  const exams = planExamRows(examDate, today);

  if (model.empty) return null;

  return (
    <View className="mb-4">
      <View className="flex-row items-center justify-between mb-2">
        <T.Heading>Study plan</T.Heading>
        <Button size="sm" variant="secondary" onPress={() => setDetailsOpen(true)}>
          Details
        </Button>
      </View>

      <PlanProgressBar percent={model.percent} />

      <View className="flex-row items-center gap-4 mt-2 mb-3">
        <View className="flex-row items-center gap-1">
          <AppIcon name="options" size={16} color={colors.textSecondary} />
          <T.Caption tone="secondary">{model.modeLabel}</T.Caption>
        </View>
        <View className="flex-row items-center gap-1">
          <AppIcon name="sparkles" size={16} color={colors.textSecondary} />
          <T.Caption tone="secondary">Recommended</T.Caption>
        </View>
      </View>

      {!usingServerPlan ? (
        <Card className="mb-3">
          <T.Caption tone="secondary">
            {planLoaded
              ? 'These topics are read off your notes. Save them as a plan to tick them off on every device.'
              : 'Showing topics read off your notes — your saved plan has not loaded yet.'}
          </T.Caption>
          {planLoaded ? (
            <Button
              size="sm"
              className="mt-3 self-start"
              disabled={generating || !canBuildPlan}
              onPress={() => {
                setGenerating(true);
                void onGeneratePlan().finally(() => setGenerating(false));
              }}
            >
              {generating ? 'Building…' : 'Save as my study plan'}
            </Button>
          ) : null}
        </Card>
      ) : null}

      {/* The spine's head. Its rail segment runs DOWN only, so the line starts
          at the disc rather than above the first thing on the screen. */}
      <SpineRow
        first
        disc={
          <View
            style={{
              width: DISC,
              height: DISC,
              borderRadius: DISC / 2,
              backgroundColor: accent.tint,
            }}
            className="items-center justify-center"
          >
            <AppIcon name="send" size={18} color={accent.ink} />
          </View>
        }
      >
        <View className="py-2">
          <T.Body>Start learning here</T.Body>
        </View>
      </SpineRow>

      {model.units.map((unit) => (
        <UnitCard
          key={unit.id}
          unit={unit}
          expanded={openId === unit.id}
          onToggleUnit={() => setOpenUnitId(openId === unit.id ? '' : unit.id)}
          onToggleTopic={onToggleTopic}
          onContinue={onContinue}
        />
      ))}

      <SheetShell
        visible={detailsOpen}
        onClose={() => setDetailsOpen(false)}
        title="Study plan"
        footer={
          <Button fullWidth onPress={() => { setDetailsOpen(false); onViewSchedule(); }}>
            View schedule
          </Button>
        }
      >
        <View className="gap-3">
          <T.Body>{model.detailLabel}</T.Body>
          <PlanProgressBar percent={model.percent} />

          <Card>
            <T.Body>Add your syllabus</T.Body>
            <T.Caption tone="secondary" className="mt-1">
              Import a syllabus so this plan follows the course, not just your notes.
            </T.Caption>
            <Button
              size="sm"
              variant="secondary"
              className="mt-3 self-start"
              onPress={() => { setDetailsOpen(false); onAddSyllabus(); }}
            >
              Add syllabus
            </Button>
          </Card>

          <Card>
            <View className="flex-row items-center justify-between">
              <T.Body>Exam dates</T.Body>
              <Pressable
                onPress={() => { setDetailsOpen(false); onAddExam(); }}
                accessibilityRole="button"
                accessibilityLabel="Add an exam date"
                className="py-1 px-2"
              >
                <T.Caption>+ Add</T.Caption>
              </Pressable>
            </View>
            {exams.length === 0 ? (
              <T.Caption tone="secondary" className="mt-1">
                No exam date yet. Add one and the calendar can count back from it.
              </T.Caption>
            ) : (
              exams.map((exam) => (
                <View key={exam.date} className="flex-row items-center gap-2 mt-2">
                  <AppIcon name="calendar" size={16} color={colors.textSecondary} />
                  <T.Caption
                    tone={exam.past ? 'tertiary' : 'secondary'}
                    style={exam.past ? { textDecorationLine: 'line-through' } : undefined}
                    accessibilityLabel={`${exam.label}${exam.past ? ', passed' : ''}`}
                  >
                    {exam.label}
                  </T.Caption>
                </View>
              ))
            )}
          </Card>
        </View>
      </SheetShell>
    </View>
  );
}

export default StudyPlanPanel;
