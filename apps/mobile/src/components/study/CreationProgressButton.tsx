/**
 * "Creation progress" — the set header control that says what is still being
 * made, from any room.
 *
 * The phone's half of the browser's header popover. It opens a sheet rather
 * than an anchored popover, because an anchored panel on a 390 px header is a
 * panel that covers the thing it is anchored to; everything else — the four
 * tabs, the ordering, the empty line, the counts — comes from
 * `@lantern/shared/utils/importStages`, so the two platforms say the same
 * words.
 *
 * LABELLED, unlike the reference, whose header glyphs carry no text and no
 * tooltip: the badge count is part of the accessible name, because a coloured
 * dot tells TalkBack nothing.
 *
 * Touches: `stores/jobsStore` (read only), `stores/authStore` for the owner id,
 * `screens/study/creationProgress` for the mapping. Rendered by
 * `SetRoomHeader`.
 */
import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import {
  CREATION_TABS,
  CREATIONS_EMPTY,
  countCreations,
  creationsSummary,
  filterCreations,
  type CreationTab,
} from '@lantern/shared/utils/importStages';
import { useJobsStore } from '../../stores/jobsStore';
import { useAuthStore } from '../../stores/authStore';
import { toCreationEntries } from '../../screens/study/creationProgress';
import { SheetShell, T } from '../ui';
import { AppIcon } from '../ui/AppIcon';
import { brand } from '../../theme';

export function CreationProgressButton() {
  const jobs = useJobsStore((s) => s.jobs);
  const userId = useAuthStore((s) => s.user?.id);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<CreationTab>('all');

  const rows = useMemo(() => toCreationEntries(jobs, userId), [jobs, userId]);
  const processing = countCreations(rows, 'processing');
  const shown = useMemo(() => filterCreations(rows, tab), [rows, tab]);

  return (
    <>
      <Pressable
        testID="creation-progress-button"
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={
          processing > 0
            ? `Creation progress — ${processing} still processing`
            : 'Creation progress'
        }
        hitSlop={8}
        className="h-9 flex-row items-center gap-1 px-1"
      >
        <AppIcon name="sync" size={20} importantForAccessibility="no" color={brand.text} />
        {processing > 0 ? (
          <View className="rounded-full bg-lantern-text px-1.5 min-w-[18px] items-center">
            <T.Caption className="text-lantern-background font-semibold">
              {String(processing)}
            </T.Caption>
          </View>
        ) : null}
      </Pressable>

      <SheetShell visible={open} onClose={() => setOpen(false)} title="Creation progress">
        <View>
          <T.Caption tone="secondary">{creationsSummary(rows)}</T.Caption>

          <View className="flex-row flex-wrap gap-1 mt-2">
            {CREATION_TABS.map((id) => (
              <Pressable
                key={id}
                onPress={() => setTab(id)}
                accessibilityRole="button"
                accessibilityState={{ selected: tab === id }}
                accessibilityLabel={`Show ${id}`}
                className={`rounded-full border px-3 py-2 ${
                  tab === id ? 'border-transparent bg-lantern-text' : 'border-lantern-border'
                }`}
              >
                <T.Caption className={tab === id ? 'text-lantern-background font-semibold' : ''}>
                  {id}
                </T.Caption>
              </Pressable>
            ))}
          </View>

          <ScrollView className="mt-2 max-h-80">
            {shown.length === 0 ? (
              <T.Body tone="secondary" className="py-3">
                {CREATIONS_EMPTY}
              </T.Body>
            ) : (
              shown.map((row) => (
                <View key={row.id} testID={`creation-row-${row.id}`} className="py-2">
                  <T.Body className="font-semibold" numberOfLines={1}>
                    {row.title}
                  </T.Body>
                  <T.Caption tone="secondary" numberOfLines={1}>
                    {row.detail || row.status}
                  </T.Caption>
                </View>
              ))
            )}
          </ScrollView>
        </View>
      </SheetShell>
    </>
  );
}

export default CreationProgressButton;
