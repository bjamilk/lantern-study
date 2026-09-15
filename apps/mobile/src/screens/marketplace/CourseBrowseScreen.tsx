/**
 * `CourseBrowse` route: the index of courses that have at least one active
 * listing, with a local text filter.
 *
 * Exports: CourseBrowseScreen (named and default).
 * Touches: fetchMarketplaceCourses in ../../services/api; COURSE_ANCHOR_COPY,
 * courseAnchorLabel and courseListingCountLabel from
 * @lantern/shared/marketplace. Navigates to `CourseListings`.
 *
 * Gotchas: the search box filters the already-loaded page in memory, so it
 * cannot reach courses the server truncated away — the truncation note at the
 * bottom is the only signal that happened.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Screen, useScreenBottomPadding } from '../../components/layout';
import { fetchMarketplaceCourses } from '../../services/api';
import { useTheme } from '../../theme';
import {
  COURSE_ANCHOR_COPY,
  courseAnchorLabel,
  courseListingCountLabel,
  type MarketplaceCourseSummary,
} from '@lantern/shared/marketplace';
import { AppIcon } from '../../components/ui/AppIcon';

type NavigationProp = {
  goBack: () => void;
  navigate: (screen: string, params?: Record<string, unknown>) => void;
};

/**
 * "Browse by course" — the index (Gap 3), in parity with the web panel.
 *
 * Only courses that actually have an ACTIVE listing appear, with real counts;
 * a course with nothing published is simply absent, so there are no fake zeros
 * to explain away.
 *
 * LOW-DATA: this list carries no images at all. The API response for the index
 * has no image field, so nothing is fetched and nothing has to be suppressed —
 * the "Show images" chip lives on the course page, where images exist.
 */
export function CourseBrowseScreen({ navigation }: { navigation: NavigationProp }) {
  const { colors } = useTheme();
  const bottomPadding = useScreenBottomPadding();
  const [courses, setCourses] = useState<MarketplaceCourseSummary[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchMarketplaceCourses();
      setCourses(result?.courses ?? []);
      setTruncated(Boolean(result?.truncated));
    } catch (e: unknown) {
      // A failure must never render as "no course has anything published",
      // which is a different and false claim.
      setError(e instanceof Error ? e.message : COURSE_ANCHOR_COPY.browseError);
      setCourses([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return courses;
    return courses.filter(
      course =>
        course.code.toLowerCase().includes(q) ||
        (course.title || '').toLowerCase().includes(q) ||
        (course.institutionName || '').toLowerCase().includes(q)
    );
  }, [courses, query]);

  return (
    <Screen bottom="none">
      <View className="flex-row items-center px-4 py-2">
        <Pressable
          hitSlop={10}
          onPress={() => navigation.goBack()}
          className="p-2"
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <AppIcon name="arrow-back" size={24} color="#64748b" />
        </Pressable>
        <Text className="flex-1 text-lg font-semibold text-lantern-text">
          {COURSE_ANCHOR_COPY.browseTitle}
        </Text>
      </View>

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: bottomPadding }}
        keyboardShouldPersistTaps="handled"
      >
        <Text className="text-xs text-lantern-text-secondary mb-3">
          {COURSE_ANCHOR_COPY.browseSubtitle}
        </Text>

        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search course code, title or campus"
          placeholderTextColor={colors.textSecondary}
          accessibilityLabel="Search courses"
          style={{
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: 10,
            paddingHorizontal: 12,
            // 44px touch target: NativeWind inlines rem at 14 here, so px.
            minHeight: 44,
            color: colors.text,
            marginBottom: 12,
          }}
        />

        {loading ? (
          <View className="py-10 items-center">
            <ActivityIndicator color={colors.primaryText} />
          </View>
        ) : error ? (
          <View className="py-10 items-center gap-3">
            <Text accessibilityLiveRegion="polite" style={{ color: colors.error }} className="text-sm text-center">
              {error}
            </Text>
            <Pressable
              onPress={() => void load()}
              accessibilityRole="button"
              accessibilityLabel={COURSE_ANCHOR_COPY.retry}
              style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: 16 }}
              className="rounded-lg border border-lantern-border"
            >
              <Text className="text-sm font-semibold text-lantern-text">
                {COURSE_ANCHOR_COPY.retry}
              </Text>
            </Pressable>
          </View>
        ) : visible.length === 0 ? (
          <Text className="py-10 text-center text-sm text-lantern-text-secondary">
            {courses.length === 0
              ? COURSE_ANCHOR_COPY.browseEmpty
              : `No course matches "${query.trim()}".`}
          </Text>
        ) : (
          <View className="rounded-xl border border-lantern-border overflow-hidden">
            {visible.map((course, index) => (
              <Pressable
                key={course.courseId}
                onPress={() =>
                  navigation.navigate('CourseListings', {
                    courseId: course.courseId,
                    courseLabel: courseAnchorLabel(course),
                    institutionName: course.institutionName,
                  })
                }
                accessibilityRole="button"
                accessibilityLabel={`${courseAnchorLabel(course)}, ${courseListingCountLabel(course)}`}
                style={{ minHeight: 44 }}
                className={`px-3 py-3 ${index > 0 ? 'border-t border-lantern-border' : ''}`}
              >
                <Text className="text-sm font-semibold text-lantern-text">
                  {courseAnchorLabel(course)}
                </Text>
                <Text className="text-xs text-lantern-text-secondary">
                  {course.institutionName || 'Not tied to a campus'}
                </Text>
                <Text className="text-xs text-lantern-text-tertiary">
                  {courseListingCountLabel(course)}
                </Text>
              </Pressable>
            ))}
          </View>
        )}

        {truncated ? (
          <Text className="mt-3 text-xs text-lantern-text-tertiary">
            Showing the busiest courses. Search above to narrow this down.
          </Text>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

export default CourseBrowseScreen;
