/**
 * The Library archive tree (Phase 1 · B, contract §3): This semester →
 * Past semesters (collapsed) → Unfiled. Tapping a course row sets the course
 * filter the Notes / Flashcards tabs honour; each row also deep-links to the
 * Tests history and Offline screens filtered to that course.
 *
 * A course expands into its syllabus topics (Phase 1 · A) plus the entry point
 * to managing them. It expands even when the overview carries no topic rows —
 * the outline may exist with nothing filed under it yet, and that is precisely
 * the outline that needs curating.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { LibraryCourseNode } from '@lantern/shared/types';
import { featureAccents } from '@lantern/shared/design';
import { COURSE_TOPIC_COPY } from '@lantern/shared';
import { useTheme } from '../../theme';
import type { LibraryCourseFilter } from '../../stores/uiStore';
import {
  courseNodeLabel,
  courseTopicRows,
  UNFILED_COURSE_ID,
  type LibraryTopicRow,
  type LibraryTree,
} from '../../utils/libraryArchive';

/**
 * A topic selection. It carries its course because a topic is only ever valid
 * inside one: the moment the course filter moves, this one is stale.
 */
export interface LibraryTopicFilter {
  id: string;
  label: string;
  courseId: string;
}

interface Counts {
  notes: number;
  decks: number;
  tests: number;
  bundles: number;
  purchasedPacks?: number;
}

interface Props {
  tree: LibraryTree | null;
  loading: boolean;
  error: string | null;
  /** Course uuid or `'null'` (unfiled); null = no filter. */
  selectedCourseId: string | null;
  /** Topic uuid or `'null'` (no topic) inside `selectedCourseId`; null = the whole course. */
  selectedTopicId: string | null;
  onSelectCourse: (filter: LibraryCourseFilter | null) => void;
  /** Picking a topic sets both filters — a topic never stands on its own. */
  onSelectTopic: (course: LibraryCourseFilter, topic: LibraryTopicFilter | null) => void;
  onOpenTests: (filter: LibraryCourseFilter) => void;
  onOpenOffline: (filter: LibraryCourseFilter) => void;
  /** Open the manage-outline sheet for a course (rename/reorder/delete topics). */
  onManageTopics: (filter: LibraryCourseFilter) => void;
  onRetry: () => void;
  onManageCourses: () => void;
}

const UNFILED_FILTER: LibraryCourseFilter = { id: UNFILED_COURSE_ID, label: 'Unfiled' };

function CountChips({ counts }: { counts: Counts }) {
  const chips: Array<{ key: string; label: string }> = [];
  if (counts.notes > 0) chips.push({ key: 'notes', label: `${counts.notes} ${counts.notes === 1 ? 'note' : 'notes'}` });
  if (counts.decks > 0) chips.push({ key: 'decks', label: `${counts.decks} ${counts.decks === 1 ? 'deck' : 'decks'}` });
  if (counts.tests > 0) chips.push({ key: 'tests', label: `${counts.tests} ${counts.tests === 1 ? 'test' : 'tests'}` });
  const plainBundles = counts.bundles - (counts.purchasedPacks ?? 0);
  if (plainBundles > 0) chips.push({ key: 'bundles', label: `${plainBundles} offline` });
  if ((counts.purchasedPacks ?? 0) > 0) {
    chips.push({ key: 'packs', label: `${counts.purchasedPacks} ${counts.purchasedPacks === 1 ? 'pack' : 'packs'}` });
  }
  if (chips.length === 0) {
    return <Text className="text-[11px] text-lantern-text-tertiary mt-0.5">Nothing filed yet</Text>;
  }
  return (
    <View className="flex-row flex-wrap gap-1 mt-1">
      {chips.map(chip => (
        <View key={chip.key} className="px-1.5 py-0.5 rounded-full bg-lantern-background-secondary">
          <Text className="text-[10px] font-medium text-lantern-text-secondary">{chip.label}</Text>
        </View>
      ))}
    </View>
  );
}

function TreeRow({
  title,
  subtitle,
  counts,
  selected,
  archived,
  topicsOpen,
  onToggleTopics,
  onPress,
  onOpenTests,
  onOpenOffline,
}: {
  title: string;
  subtitle?: string;
  counts: Counts;
  selected: boolean;
  archived?: boolean;
  /** Passed for courses (not the Unfiled row), which always expand. */
  topicsOpen?: boolean;
  onToggleTopics?: () => void;
  onPress: () => void;
  onOpenTests: () => void;
  onOpenOffline: () => void;
}) {
  const { colors } = useTheme();
  return (
    <View
      className={`flex-row items-center rounded-xl mb-1 ${
        selected ? 'bg-lantern-primary-background' : ''
      }`}
    >
      {onToggleTopics ? (
        <Pressable
          onPress={onToggleTopics}
          hitSlop={6}
          className="pl-1 pr-0.5 py-2 min-h-[44px] items-center justify-center"
          accessibilityRole="button"
          accessibilityState={{ expanded: topicsOpen }}
          accessibilityLabel={`${topicsOpen ? 'Hide' : 'Show'} topics in ${title}`}
        >
          <Ionicons name={topicsOpen ? 'chevron-down' : 'chevron-forward'} size={14} color={colors.textTertiary} />
        </Pressable>
      ) : null}
      <Pressable
        onPress={onPress}
        className="flex-1 flex-row items-center gap-2 px-2 py-2 min-h-[44px]"
        accessibilityRole="button"
        accessibilityState={{ selected }}
        accessibilityLabel={`${selected ? 'Clear filter' : 'Filter by'} ${title}`}
      >
        <Ionicons
          name={selected ? 'checkmark-circle' : archived ? 'archive-outline' : 'school-outline'}
          size={18}
          color={selected ? colors.primary : colors.textTertiary}
        />
        <View className="flex-1 min-w-0">
          <Text
            className={`text-sm font-semibold ${selected ? 'text-lantern-primary' : 'text-lantern-text'}`}
            numberOfLines={1}
          >
            {title}
          </Text>
          {subtitle ? (
            <Text className="text-[11px] text-lantern-text-secondary" numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
          <CountChips counts={counts} />
        </View>
      </Pressable>
      <Pressable
        onPress={onOpenTests}
        hitSlop={6}
        className="px-2 py-2 min-h-[44px] items-center justify-center"
        accessibilityRole="button"
        accessibilityLabel={`Open test history for ${title}`}
      >
        <Ionicons name="clipboard-outline" size={18} color={colors.textSecondary} />
      </Pressable>
      <Pressable
        onPress={onOpenOffline}
        hitSlop={6}
        className="pl-2 pr-3 py-2 min-h-[44px] items-center justify-center"
        accessibilityRole="button"
        accessibilityLabel={`Open offline bundles for ${title}`}
      >
        <Ionicons name="cloud-download-outline" size={18} color={colors.textSecondary} />
      </Pressable>
    </View>
  );
}

/** One syllabus topic under its course, or the "No topic" bucket. */
function TopicRow({
  row,
  selected,
  onPress,
}: {
  row: LibraryTopicRow;
  selected: boolean;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  const untopiced = row.untopiced;
  return (
    <Pressable
      onPress={onPress}
      className={`flex-row items-center gap-2 pl-8 pr-3 py-2 mb-1 rounded-xl min-h-[44px] ${
        selected ? 'bg-lantern-primary-background' : ''
      }`}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={`${selected ? 'Clear topic filter' : 'Filter by topic'} ${row.title}`}
    >
      <Ionicons
        name={selected ? 'checkmark-circle' : untopiced ? 'ellipse-outline' : 'bookmark-outline'}
        size={15}
        color={selected ? colors.primary : colors.textTertiary}
      />
      <View className="flex-1 min-w-0">
        <Text
          className={`text-[13px] ${
            selected ? 'font-semibold text-lantern-primary' : untopiced ? 'text-lantern-text-secondary' : 'text-lantern-text'
          }`}
          numberOfLines={1}
        >
          {row.title}
        </Text>
        <CountChips counts={row.counts} />
      </View>
    </Pressable>
  );
}

function SectionHeader({
  label,
  count,
  open,
  onToggle,
}: {
  label: string;
  count: number;
  open: boolean;
  onToggle: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onToggle}
      className="flex-row items-center justify-between py-1.5 min-h-[36px]"
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
      accessibilityLabel={`${label}, ${count} ${count === 1 ? 'course' : 'courses'}`}
    >
      <Text className="text-[11px] font-bold uppercase tracking-wider text-lantern-text-tertiary">
        {label} · {count}
      </Text>
      <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={14} color={colors.textTertiary} />
    </Pressable>
  );
}

export function LibraryCourseTree({
  tree,
  loading,
  error,
  selectedCourseId,
  selectedTopicId,
  onSelectCourse,
  onSelectTopic,
  onOpenTests,
  onOpenOffline,
  onManageTopics,
  onRetry,
  onManageCourses,
}: Props) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(true);
  const [thisOpen, setThisOpen] = useState(true);
  const [pastOpen, setPastOpen] = useState(false);
  // Topic levels are collapsed by default; keyed per row because one course can
  // appear under several academic years. Only rows the student toggled are here.
  const [topicsOpen, setTopicsOpen] = useState<Record<string, boolean>>({});

  // Every row key (year:courseId) belonging to the selected course.
  const selectedRowKeys = useMemo(() => {
    if (!tree || !selectedCourseId) return [] as string[];
    const nodes = [...tree.thisSemester, ...tree.pastSemesters.flatMap(y => y.courses)];
    return nodes
      .filter(n => n.course.id === selectedCourseId)
      .map(n => `${n.enrolment.academicYear}:${n.course.id}`);
  }, [tree, selectedCourseId]);

  // A topic selected elsewhere (a count badge, a restored filter) must be
  // visible. Force the course open — a plain `?? fallback` only fires while the
  // key is ABSENT, so once a student had collapsed this course the live topic
  // stayed hidden forever. This mirrors web's rail. Only ADD to the open set, so
  // the student can still collapse afterwards without it snapping back.
  useEffect(() => {
    if (!selectedTopicId || selectedRowKeys.length === 0) return;
    setTopicsOpen(prev => {
      if (selectedRowKeys.every(k => prev[k])) return prev;
      const next = { ...prev };
      for (const k of selectedRowKeys) next[k] = true;
      return next;
    });
  }, [selectedTopicId, selectedRowKeys]);

  const courseFilter = (node: LibraryCourseNode): LibraryCourseFilter => ({
    id: node.course.id,
    label: courseNodeLabel(node),
  });
  const toggle = (filter: LibraryCourseFilter) => {
    // With a topic selected, the course row is the way *back* to the whole
    // course — one tap widens rather than dumping the student out to
    // everything. Only a plain course selection toggles off. (Web's rail does
    // the same thing; the two rails must agree.)
    if (selectedCourseId === filter.id && selectedTopicId) {
      onSelectTopic(filter, null);
      return;
    }
    onSelectCourse(selectedCourseId === filter.id ? null : filter);
  };

  const activeCount = tree?.thisSemester.length ?? 0;
  const pastCount = tree?.pastSemesters.reduce((n, y) => n + y.courses.length, 0) ?? 0;
  const hasCourses = activeCount + pastCount > 0;

  const renderCourse = (node: LibraryCourseNode, archived: boolean) => {
    const rowKey = `${node.enrolment.academicYear}:${node.course.id}`;
    const filter = courseFilter(node);
    const courseSelected = selectedCourseId === node.course.id;
    // Only topics something is FILED under reach the overview, so this is empty
    // both for a course with no outline and for a freshly seeded one.
    const topics = courseTopicRows(node);
    // Collapsed until asked for, except when this course holds the live topic
    // filter: a selection the student cannot see reads as a broken filter.
    //
    // Every course expands, including one with no rows yet: the section also
    // holds "Course topics", and gating it on `topics.length > 0` is what left a
    // seeded-but-unfiled outline with no way to rename or delete anything.
    const expanded = topicsOpen[rowKey] ?? (courseSelected && !!selectedTopicId);
    return (
      <View key={rowKey}>
        <TreeRow
          title={node.course.code}
          subtitle={node.course.title && node.course.title.toUpperCase() !== node.course.code ? node.course.title : undefined}
          counts={node.counts}
          // Only one row reads as selected at a time: with a topic picked, the
          // topic row carries the selection, not the course above it.
          selected={courseSelected && !selectedTopicId}
          archived={archived}
          topicsOpen={expanded}
          onToggleTopics={() => setTopicsOpen(o => ({ ...o, [rowKey]: !expanded }))}
          onPress={() => toggle(filter)}
          onOpenTests={() => onOpenTests(filter)}
          onOpenOffline={() => onOpenOffline(filter)}
        />
        {expanded ? (
          <>
            {topics.map(row => {
              const selected = courseSelected && selectedTopicId === row.id;
              return (
                <TopicRow
                  key={`${rowKey}:${row.id}`}
                  row={row}
                  selected={selected}
                  onPress={() =>
                    onSelectTopic(filter, selected ? null : { id: row.id, label: row.title, courseId: node.course.id })
                  }
                />
              );
            })}
            {/* Rename/reorder/delete the shared outline. Present whenever a
                course is expanded, not only when rows are showing: the outline
                that most needs curating is the one nothing is filed under yet,
                and it contributes no rows here. */}
            <Pressable
              onPress={() => onManageTopics(filter)}
              className="flex-row items-center gap-2 pl-8 pr-3 py-2 mb-1 min-h-[40px]"
              accessibilityRole="button"
              accessibilityLabel={`${COURSE_TOPIC_COPY.manageTitle} in ${node.course.code}`}
            >
              <Ionicons name="options-outline" size={15} color={colors.textTertiary} />
              <Text className="text-[12px] font-medium text-lantern-text-secondary">
                {COURSE_TOPIC_COPY.manageTitle}
              </Text>
            </Pressable>
          </>
        ) : null}
      </View>
    );
  };

  return (
    <View className="rounded-2xl border border-lantern-border bg-lantern-surface mb-2 overflow-hidden">
      <Pressable
        onPress={() => setOpen(o => !o)}
        className="flex-row items-center gap-2 px-3 py-2.5 min-h-[44px]"
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel="My courses"
      >
        <Ionicons name="git-branch-outline" size={16} color={featureAccents.library} />
        <Text className="flex-1 text-sm font-semibold text-lantern-text">My courses</Text>
        {loading && !tree ? <ActivityIndicator size="small" color={colors.primary} /> : null}
        {!open && tree ? (
          <Text className="text-[11px] text-lantern-text-secondary mr-1">
            {activeCount} active{pastCount > 0 ? ` · ${pastCount} past` : ''}
          </Text>
        ) : null}
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={16} color={colors.textTertiary} />
      </Pressable>

      {open ? (
        <ScrollView
          style={{ maxHeight: 300 }}
          nestedScrollEnabled
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingHorizontal: 8, paddingBottom: 8 }}
        >
          {error && !tree ? (
            <View className="px-2 py-3">
              <Text className="text-xs text-lantern-error mb-2">Could not load your courses: {error}</Text>
              <Pressable onPress={onRetry} accessibilityRole="button" className="self-start">
                <Text className="text-xs font-semibold text-lantern-primary">Retry</Text>
              </Pressable>
            </View>
          ) : null}

          {tree && !hasCourses ? (
            <View className="px-2 py-2">
              <Text className="text-xs text-lantern-text-secondary">
                No courses yet. Add this semester's courses to file notes, decks and tests under them.
              </Text>
              <Pressable onPress={onManageCourses} accessibilityRole="button" className="self-start mt-2 mb-1">
                <Text className="text-xs font-semibold text-lantern-primary">Add my courses</Text>
              </Pressable>
            </View>
          ) : null}

          {tree && activeCount > 0 ? (
            <>
              <SectionHeader label="This semester" count={activeCount} open={thisOpen} onToggle={() => setThisOpen(o => !o)} />
              {thisOpen ? tree.thisSemester.map(node => renderCourse(node, false)) : null}
            </>
          ) : null}

          {tree && pastCount > 0 ? (
            <>
              <SectionHeader label="Past semesters" count={pastCount} open={pastOpen} onToggle={() => setPastOpen(o => !o)} />
              {pastOpen
                ? tree.pastSemesters.map(year => (
                    <View key={year.academicYear} className="mb-1">
                      <Text className="text-[11px] font-semibold text-lantern-text-secondary px-2 py-1">
                        {year.academicYear}
                      </Text>
                      {year.courses.map(node => renderCourse(node, true))}
                    </View>
                  ))
                : null}
            </>
          ) : null}

          {tree ? (
            <>
              <View className="flex-row items-center justify-between py-1.5 min-h-[36px]">
                <Text className="text-[11px] font-bold uppercase tracking-wider text-lantern-text-tertiary">Unfiled</Text>
                {hasCourses ? (
                  <Pressable onPress={onManageCourses} accessibilityRole="button" hitSlop={6}>
                    <Text className="text-[11px] font-semibold text-lantern-primary">Manage courses</Text>
                  </Pressable>
                ) : null}
              </View>
              <TreeRow
                title="Unfiled"
                subtitle="Not linked to a course"
                counts={tree.unfiled}
                selected={selectedCourseId === UNFILED_COURSE_ID}
                onPress={() => toggle(UNFILED_FILTER)}
                onOpenTests={() => onOpenTests(UNFILED_FILTER)}
                onOpenOffline={() => onOpenOffline(UNFILED_FILTER)}
              />
            </>
          ) : null}
        </ScrollView>
      ) : null}
    </View>
  );
}

export default LibraryCourseTree;
