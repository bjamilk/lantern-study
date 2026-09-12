/**
 * The Me progress hub's arithmetic, shared by web and phone.
 *
 * These numbers used to live inside `components/me/progressHelpers.ts` and
 * inside the body of web's `AchievementsCard`, which meant the phone could
 * only reach parity by re-deriving them — and two derivations of the same
 * figure drift. Everything here is pure: no DOM, no AsyncStorage, no React,
 * so both platforms and jest can call it directly. The two platform files keep
 * only their own persistence (localStorage on web, AsyncStorage on the phone).
 */
import { BADGE_DEFINITIONS } from '../utils/gamification';
import type { BadgeId, UserStats } from '../types';

/** How many rows one page of Recent Tests holds, on both platforms. */
export const RECENT_TESTS_PAGE_SIZE = 5;

// --- Group naming -----------------------------------------------------------

export interface MeGroupLike {
  id: string;
  name: string;
  parentId?: string | null;
}

export interface MeOfflineBundleLike {
  displayName?: string;
  groupName?: string;
  config?: { groupId?: string; groupName?: string };
}

/**
 * The printed name of the exam a result belongs to.
 *
 * The group may be gone (deleted, or never synced to this device), so the
 * lookup falls back to the name stored on the result itself and then to an
 * offline bundle before it admits it does not know. A result whose group was
 * deleted still has a name worth printing.
 */
export function getGroupName(
  groupId: string | undefined,
  groups: readonly MeGroupLike[],
  offlineBundles: readonly MeOfflineBundleLike[] = [],
  storedName?: string
): string {
  const group = groups.find((g) => g.id === groupId);
  if (group) return group.name;
  if (storedName) return storedName;
  const bundle = offlineBundles.find((b) => b.config?.groupId === groupId);
  const bundleName = bundle?.displayName || bundle?.config?.groupName || bundle?.groupName;
  if (bundleName) return bundleName;
  return 'Unknown Exam';
}

// --- Group chooser ----------------------------------------------------------

export interface MeGroupOption {
  id: string;
  name: string;
  /** Nesting depth, so the chooser can indent a child under its parent. */
  level: number;
}

/**
 * The group chooser's rows: every group that has data, in tree order, each
 * carrying its depth. Groups with no results are walked through but not
 * listed — a chooser entry that selects an empty series is a dead option.
 */
export function buildHierarchicalGroupOptions(
  historyGroups: readonly MeGroupLike[],
  dataIds: ReadonlySet<string>
): MeGroupOption[] {
  const byParent = new Map<string | null, MeGroupLike[]>();
  for (const group of historyGroups) {
    const parentKey = group.parentId || null;
    const list = byParent.get(parentKey) || [];
    list.push(group);
    byParent.set(parentKey, list);
  }
  for (const list of byParent.values()) {
    list.sort((a, b) => a.name.localeCompare(b.name));
  }

  const options: MeGroupOption[] = [];
  const walk = (parentId: string | null, level: number) => {
    const children = byParent.get(parentId) || [];
    for (const child of children) {
      if (dataIds.has(child.id)) {
        options.push({ id: child.id, name: child.name, level });
      }
      walk(child.id, level + 1);
    }
  };

  const historyIds = new Set(historyGroups.map((g) => g.id));
  const roots = historyGroups
    .filter((g) => !g.parentId || !historyIds.has(g.parentId))
    .sort((a, b) => a.name.localeCompare(b.name));

  for (const root of roots) {
    if (dataIds.has(root.id)) {
      options.push({ id: root.id, name: root.name, level: 0 });
    }
    walk(root.id, 1);
  }

  const seen = new Set<string>();
  return options.filter((opt) => {
    if (seen.has(opt.id)) return false;
    seen.add(opt.id);
    return true;
  });
}

// --- Achievements -----------------------------------------------------------

/** The label web prints when a badge has no level left to earn. */
export const MAX_LEVEL_TEXT = 'Max Level!';

export interface AchievementRow {
  id: string;
  /** The emoji the badge is drawn with. */
  icon: string;
  /** The earned name when there is one, else the base name. */
  name: string;
  /** 0 when nothing is earned yet. */
  level: number;
  maxLevel: number;
  /** 0–100, clamped. 100 at max level. */
  progressPercent: number;
  /** `"12 / 25"`, or `MAX_LEVEL_TEXT`. */
  progressText: string;
  earned: boolean;
  maxed: boolean;
  /**
   * True for the badge whose metric is not a counter the student can act on
   * directly (today only RISING_STAR, which is upvotes other students leave on
   * one of their questions). It prints a goal line instead of a progress bar,
   * which is what web's Me page does.
   */
  goalOnly: boolean;
  /** Present only when `goalOnly` and a next level exists. */
  goalText?: string;
}

interface EarnedBadgeLike {
  id: string;
  level: number;
  name?: string;
}

/**
 * The canonical rows, from the badge definitions and the student's raw stats —
 * the shape web's Me page has. Earned badges sort first; within each half the
 * definition order is kept, so the list does not reshuffle as levels land.
 */
export function buildAchievementRows(input: {
  badges?: readonly EarnedBadgeLike[];
  stats?: Partial<Record<string, number>>;
}): AchievementRow[] {
  const stats = (input.stats || {}) as Partial<Record<keyof UserStats, number>>;
  // Several rows can share an id at different levels; only the highest counts.
  const highest = new Map<string, EarnedBadgeLike>();
  for (const badge of input.badges || []) {
    const existing = highest.get(badge.id);
    if (!existing || badge.level > existing.level) highest.set(badge.id, badge);
  }

  const rows = (Object.keys(BADGE_DEFINITIONS) as BadgeId[]).map((badgeId) => {
    const definition = BADGE_DEFINITIONS[badgeId];
    const earned = highest.get(badgeId);
    const currentLevel = earned?.level || 0;
    const nextLevel = definition.levels.find((l) => l.level === currentLevel + 1);
    const goalOnly = definition.id === 'RISING_STAR';

    let progressPercent = 0;
    let progressText = '0 / 0';
    if (nextLevel) {
      const currentValue = stats[definition.metric as keyof UserStats] || 0;
      const startOfLevel = definition.levels.find((l) => l.level === currentLevel)?.threshold || 0;
      progressPercent = clampPercent(
        ((currentValue - startOfLevel) / (nextLevel.threshold - startOfLevel)) * 100
      );
      progressText = `${currentValue} / ${nextLevel.threshold}`;
    } else {
      progressPercent = 100;
      progressText = MAX_LEVEL_TEXT;
    }

    return {
      id: definition.id,
      icon: definition.icon,
      name: earned?.name || definition.baseName,
      level: currentLevel,
      maxLevel: definition.levels.length,
      progressPercent,
      progressText,
      earned: !!earned,
      maxed: !nextLevel,
      goalOnly,
      goalText: goalOnly && nextLevel ? `Goal: ${nextLevel.threshold} upvotes on one question` : undefined,
    } satisfies AchievementRow;
  });

  return sortEarnedFirst(rows);
}

/**
 * The same rows, built from a badge summary that already carries the metric
 * and the next threshold — what the phone's stats store holds after it has
 * mapped the gamification profile. `buildAchievementRows` is the definition of
 * these numbers; this is the path for a caller that no longer has the raw
 * stats, and `meProgress.test.ts` pins the two to the same output.
 */
export interface BadgeSummaryLike {
  id: string;
  name?: string;
  level: number;
  maxLevel?: number;
  currentValue?: number;
  targetValue?: number;
}

export function buildAchievementRowsFromSummaries(
  summaries: readonly BadgeSummaryLike[]
): AchievementRow[] {
  const rows = summaries.map((summary) => {
    const definition = BADGE_DEFINITIONS[summary.id as BadgeId] as
      | (typeof BADGE_DEFINITIONS)[BadgeId]
      | undefined;
    const level = summary.level || 0;
    const maxLevel = summary.maxLevel ?? definition?.levels.length ?? 0;
    const nextLevel = definition?.levels.find((l) => l.level === level + 1);
    const goalOnly = definition?.id === 'RISING_STAR';
    const maxed = definition ? !nextLevel : level >= maxLevel && maxLevel > 0;

    let progressPercent = 0;
    let progressText = '0 / 0';
    if (!maxed) {
      const currentValue = summary.currentValue ?? 0;
      const startOfLevel = definition?.levels.find((l) => l.level === level)?.threshold || 0;
      const target = nextLevel?.threshold ?? summary.targetValue ?? 0;
      progressPercent =
        target > startOfLevel
          ? clampPercent(((currentValue - startOfLevel) / (target - startOfLevel)) * 100)
          : 0;
      progressText = `${currentValue} / ${target}`;
    } else if (maxed) {
      progressPercent = 100;
      progressText = MAX_LEVEL_TEXT;
    }

    return {
      id: summary.id,
      icon: definition?.icon ?? '🏅',
      name: summary.name || definition?.baseName || summary.id,
      level,
      maxLevel,
      progressPercent,
      progressText,
      earned: level > 0,
      maxed,
      goalOnly: !!goalOnly,
      goalText: goalOnly && nextLevel ? `Goal: ${nextLevel.threshold} upvotes on one question` : undefined,
    } satisfies AchievementRow;
  });

  return sortEarnedFirst(rows);
}

function sortEarnedFirst(rows: AchievementRow[]): AchievementRow[] {
  // A stable partition, not a comparator that returns 0 for ties: the earned
  // half and the unearned half each keep definition order.
  return [...rows.filter((r) => r.earned), ...rows.filter((r) => !r.earned)];
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

// --- Recent tests -----------------------------------------------------------

export interface RecentTestAnswerLike {
  timeSpentSeconds?: number;
}

/**
 * Seconds per question, over the answers that were actually timed, or null
 * when none were. Null is not zero: "0.0s avg" claims the student answered
 * instantly, which is the opposite of "we did not time this".
 */
export function averageSecondsPerQuestion(
  answers: Record<string, RecentTestAnswerLike | undefined> | undefined
): number | null {
  const timed = Object.values(answers || {}).filter(
    (answer): answer is RecentTestAnswerLike => answer?.timeSpentSeconds !== undefined
  );
  if (timed.length === 0) return null;
  const total = timed.reduce((sum, answer) => sum + (answer.timeSpentSeconds || 0), 0);
  return total / timed.length;
}

/** Pages, never fewer than one — an empty list is still "page 1 of 1". */
export function recentTestsPageCount(total: number, pageSize: number = RECENT_TESTS_PAGE_SIZE): number {
  if (!Number.isFinite(total) || total <= 0) return 1;
  return Math.max(1, Math.ceil(total / pageSize));
}
