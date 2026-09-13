/**
 * "Recent activities" — region 4 of Home's shared spine.
 *
 * StudyFetch's shape, which the founder asked us to follow: a hue tile with
 * the object's own glyph, a grey PAST-TENSE verb above a bold title, and the
 * relative time at the end of the row. The verb is the point. "Practiced
 * Flashcards / Pharmacology deck / 2h ago" says what the student DID; the old
 * tile said "Pick up where you left off" under every row, which is a slogan
 * rather than a fact and was identical on all three of them.
 *
 * Rows, not tiles. Six rows of one line each is the whole feed in one glance;
 * six 2-up tiles was a screen and a half of scrolling for the same content.
 *
 * Dumb on purpose: the feed arrives resolved from
 * `recentActivities()` in `@lantern/shared/dashboard`, so web and the phone
 * order and word the same events identically, and the tap mapping lives in
 * `recentActivityRoute` beside its test.
 */
import React from 'react';
import { Pressable, View } from 'react-native';
import type { FeatureKey } from '@lantern/shared/design';
import { FeatureDisc } from '../ui/FeatureDisc';
import { T } from '../ui';
import type { AppIconName } from '../ui/AppIcon';
import { relativeActivityTime, type RecentActivity, type RecentActivityKind } from './homeSections';

export interface HomeRecentActivitiesProps {
  activities: readonly RecentActivity[];
  /** Tapping a row resumes THAT activity. */
  onOpen: (activity: RecentActivity) => void;
  /** Injected in tests so the relative times are not wall-clock dependent. */
  now?: Date;
}

/**
 * One hue and one glyph per kind of thing.
 *
 * Identity, never state: a deck is the flashcards lime wherever it appears, so
 * a row on Home and the same deck inside its set are recognisably one object.
 */
const KIND_PRESENTATION: Record<RecentActivityKind, { feature: FeatureKey; icon: AppIconName }> = {
  flashcards: { feature: 'flashcards', icon: 'layers' },
  test: { feature: 'tests', icon: 'clipboard-check' },
  material: { feature: 'notes', icon: 'document-text' },
  lecture: { feature: 'recording', icon: 'mic' },
  companion: { feature: 'ai', icon: 'sparkles' },
};

export function HomeRecentActivities({ activities, onOpen, now }: HomeRecentActivitiesProps) {
  // No heading over nothing.
  if (activities.length === 0) return null;

  return (
    <View className="mb-4">
      <T.Caption tone="secondary" className="mb-2">
        Recent activities
      </T.Caption>
      <View className="rounded-lantern-xl border border-lantern-border bg-lantern-surface overflow-hidden">
        {activities.map((activity, index) => {
          const { feature, icon } = KIND_PRESENTATION[activity.kind];
          const when = relativeActivityTime(activity.at, now);
          return (
            <Pressable
              key={`${activity.kind}-${activity.id}`}
              onPress={() => onOpen(activity)}
              accessibilityRole="button"
              // The label reads as the row does, verb first, so a screen
              // reader hears what happened rather than just a title.
              accessibilityLabel={`${activity.verb}: ${activity.title}${
                when ? `, ${when}` : ''
              }`}
              testID={`home-recent-activity-${activity.kind}-${activity.id}`}
              className={`flex-row items-center gap-3 p-3 active:opacity-80 ${
                index > 0 ? 'border-t border-lantern-border' : ''
              }`}
            >
              <FeatureDisc feature={feature} icon={icon} size={40} />
              <View className="flex-1 min-w-0">
                <T.Caption tone="secondary" numberOfLines={1}>
                  {activity.verb}
                </T.Caption>
                <T.Body style={{ fontWeight: '600' }} numberOfLines={1}>
                  {activity.title}
                </T.Body>
                {activity.subtitle ? (
                  <T.Caption tone="tertiary" numberOfLines={1}>
                    {activity.subtitle}
                  </T.Caption>
                ) : null}
              </View>
              {when ? (
                <T.Caption tone="tertiary" numberOfLines={1}>
                  {when}
                </T.Caption>
              ) : null}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export default HomeRecentActivities;
