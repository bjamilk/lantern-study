/**
 * The 16-week activity grid.
 *
 * Extracted from `DashboardScreen` when Home was cut back to its shared spine:
 * the heatmap is the LOOKING-BACK half of the app and now lives on Progress,
 * which is the screen a student opens to look back. It was defined inline in a
 * 1,600-line screen, which is why it could not simply be imported there.
 *
 * Colours come from the shared heat scale (`getActivityHeatHexColor…`) so a
 * day of the same intensity is the same green on Home, on Progress and on web.
 */
import React from 'react';
import { View } from 'react-native';
import {
  getActivityHeatHexColor,
  getActivityHeatHexColorForCount,
  type ActivityHeatLevel,
} from '@lantern/shared/utils';
import { T } from '../ui';

export interface ActivityHeatmapProps {
  days: { date: string; count: number }[];
  theme: 'light' | 'dark';
}

export function ActivityHeatmap({ days, theme }: ActivityHeatmapProps) {
  const legendLevels: ActivityHeatLevel[] = [0, 1, 2, 3, 4];
  const weeks: { date: string; count: number }[][] = [];

  for (let i = 0; i < days.length; i += 7) {
    weeks.push(days.slice(i, i + 7));
  }

  return (
    <View className="overflow-hidden items-center gap-2">
      <View className="flex-row flex-wrap gap-1">
        {weeks.map((week, wi) => (
          <View key={`week-${wi}`} className="gap-1">
            {week.map((day) => (
              <View
                key={day.date}
                style={{
                  width: 12,
                  height: 12,
                  borderRadius: 2,
                  backgroundColor: getActivityHeatHexColorForCount(day.count, theme),
                }}
              />
            ))}
          </View>
        ))}
      </View>
      <View className="flex-row items-center gap-1">
        <T.Caption tone="tertiary">Less</T.Caption>
        {legendLevels.map((level) => (
          <View
            key={level}
            style={{
              width: 12,
              height: 12,
              borderRadius: 2,
              backgroundColor: getActivityHeatHexColor(level, theme),
            }}
          />
        ))}
        <T.Caption tone="tertiary">More</T.Caption>
      </View>
    </View>
  );
}

export default ActivityHeatmap;
