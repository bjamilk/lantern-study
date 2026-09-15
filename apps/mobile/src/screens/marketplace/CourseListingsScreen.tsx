/**
 * `CourseListings` route: the banks and packs filed under one course.
 *
 * Exports: CourseListingsScreen (named and default).
 * Touches: fetchMarketplaceCourseListings in ../../services/api;
 * useLowDataMode for the image default; COURSE_ANCHOR_COPY from
 * @lantern/shared/marketplace. Navigates to `ListingDetail`.
 *
 * Gotchas: the effect on `lowDataMode` resets showImages, so toggling the
 * app-wide low-data setting overrides a per-screen choice. Header text falls
 * back to the route params until the fetch lands, so a stale label can show
 * briefly.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, Text, View } from 'react-native';
import { Screen, useScreenBottomPadding } from '../../components/layout';
import { fetchMarketplaceCourseListings } from '../../services/api';
import { useLowDataMode } from '../../hooks/useLowDataMode';
import { useTheme } from '../../theme';
import { COURSE_ANCHOR_COPY } from '@lantern/shared/marketplace';
import { AppIcon } from '../../components/ui/AppIcon';

type NavigationProp = {
  goBack: () => void;
  navigate: (screen: string, params?: Record<string, unknown>) => void;
};

type Route = {
  params?: {
    courseId?: string;
    courseLabel?: string;
    institutionName?: string | null;
  };
};

type CoursePage = Awaited<ReturnType<typeof fetchMarketplaceCourseListings>> | null;

function kindLabel(kind: string | null): string {
  if (kind === 'question_bank') return 'Question bank';
  if (kind === 'study_pack') return 'Study pack';
  return 'Listing';
}

/**
 * One course's banks and packs (Gap 3), in parity with the web panel.
 *
 * LOW-DATA: thumbnails stay behind a "Show images" chip. With the app-wide
 * low-data setting on the chip starts off, so a student on a metered line never
 * has to opt out twice; otherwise it starts on. Nothing is downloaded until the
 * <Image> is actually rendered.
 */
export function CourseListingsScreen({
  navigation,
  route,
}: {
  navigation: NavigationProp;
  route: Route;
}) {
  const { colors } = useTheme();
  const bottomPadding = useScreenBottomPadding();
  const { lowDataMode } = useLowDataMode();
  const courseId = route.params?.courseId || '';
  const [page, setPage] = useState<CoursePage>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showImages, setShowImages] = useState(!lowDataMode);

  useEffect(() => {
    setShowImages(!lowDataMode);
  }, [lowDataMode]);

  const load = useCallback(async () => {
    if (!courseId) {
      setError(COURSE_ANCHOR_COPY.invalid);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setPage(await fetchMarketplaceCourseListings(courseId));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : COURSE_ANCHOR_COPY.browseError);
      setPage(null);
    } finally {
      setLoading(false);
    }
  }, [courseId]);

  useEffect(() => {
    void load();
  }, [load]);

  const heading = page?.course
    ? `${page.course.code}${page.course.title && page.course.title !== page.course.code ? ` · ${page.course.title}` : ''}`
    : route.params?.courseLabel || 'Course';
  const campusLine =
    page?.course?.institutionName ?? route.params?.institutionName ?? null;
  const listings = page?.listings ?? [];
  const hasAnyImage = listings.some(listing => Boolean(listing.imageUrl));

  return (
    <Screen bottom="none">
      <View className="flex-row items-center px-4 py-2">
        <Pressable
          hitSlop={10}
          onPress={() => navigation.goBack()}
          className="p-2"
          accessibilityRole="button"
          accessibilityLabel="Back to courses"
        >
          <AppIcon name="arrow-back" size={24} color="#64748b" />
        </Pressable>
        <Text numberOfLines={1} className="flex-1 text-lg font-semibold text-lantern-text">
          {heading}
        </Text>
      </View>

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: bottomPadding }}
      >
        {campusLine ? (
          <Text className="text-xs text-lantern-text-secondary mb-3">{campusLine}</Text>
        ) : null}

        {loading ? (
          <View className="py-10 items-center">
            <ActivityIndicator color={colors.primaryText} />
          </View>
        ) : error ? (
          <View className="py-10 items-center gap-3">
            <Text
              accessibilityLiveRegion="polite"
              style={{ color: colors.error }}
              className="text-sm text-center"
            >
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
        ) : listings.length === 0 ? (
          <Text className="py-10 text-center text-sm text-lantern-text-secondary">
            {COURSE_ANCHOR_COPY.browseEmptyForCourse}
          </Text>
        ) : (
          <>
            {hasAnyImage ? (
              <Pressable
                onPress={() => setShowImages(value => !value)}
                accessibilityRole="button"
                accessibilityState={{ selected: showImages }}
                accessibilityLabel={showImages ? 'Hide images' : COURSE_ANCHOR_COPY.showImages}
                style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: 14, alignSelf: 'flex-start' }}
                className="mb-2 rounded-full border border-lantern-border flex-row items-center"
              >
                <AppIcon name="image" size={16} color="#64748b" />
                <Text className="ml-1.5 text-xs font-semibold text-lantern-text-secondary">
                  {showImages ? 'Hide images' : COURSE_ANCHOR_COPY.showImages}
                </Text>
              </Pressable>
            ) : null}
            {!showImages ? (
              <Text className="mb-2 text-xs text-lantern-text-tertiary">
                {COURSE_ANCHOR_COPY.imagesOffNote}
              </Text>
            ) : null}

            <View className="gap-2">
              {listings.map(listing => (
                <Pressable
                  key={listing.id}
                  onPress={() =>
                    navigation.navigate('ListingDetail', { listingId: listing.id })
                  }
                  accessibilityRole="button"
                  accessibilityLabel={`${listing.title}, ${kindLabel(listing.listingKind)}`}
                  style={{ minHeight: 44 }}
                  className="flex-row items-start gap-3 p-3 rounded-xl border border-lantern-border"
                >
                  {showImages && listing.imageUrl ? (
                    <Image
                      source={{ uri: listing.imageUrl }}
                      accessibilityIgnoresInvertColors
                      style={{ width: 56, height: 56, borderRadius: 8 }}
                    />
                  ) : null}
                  <View className="flex-1 min-w-0">
                    <Text numberOfLines={2} className="text-sm font-semibold text-lantern-text">
                      {listing.title}
                    </Text>
                    <Text className="text-xs text-lantern-text-secondary">
                      {kindLabel(listing.listingKind)}
                      {listing.questionCount != null
                        ? ` · ${listing.questionCount} question${listing.questionCount === 1 ? '' : 's'}`
                        : ''}
                      {listing.sellerName ? ` · ${listing.sellerName}` : ''}
                    </Text>
                    <Text className="text-xs font-semibold text-lantern-text">
                      {listing.price && listing.price > 0
                        ? `₦${listing.price.toLocaleString()}`
                        : 'Free'}
                    </Text>
                  </View>
                </Pressable>
              ))}
            </View>

            <Text className="mt-3 text-xs text-lantern-text-tertiary">
              {page?.total ?? listings.length} listing
              {(page?.total ?? listings.length) === 1 ? '' : 's'} filed under this course.
            </Text>
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

export default CourseListingsScreen;
