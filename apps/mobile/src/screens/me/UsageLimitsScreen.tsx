/**
 * Usage & limits — where a student finds out what AI costs them.
 *
 * The rule this screen exists to keep (spec v1, "what not to import" §3):
 * limits are visible, every button says its price, and there is a clear next
 * step at zero. StudyFetch hides the meter until it refuses you; this prints
 * the meter, the whole price list, and the things that keep working when the
 * meter is empty.
 *
 * All the arithmetic and all the copy decisions live in
 * `@lantern/shared/ai` (buildAIUsageView / planZeroCreditSteps), which is pure
 * and unit-tested. This file is the render and the fetch — so the phone and
 * the browser can never disagree about what an action costs.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import {
  buildAIUsageView,
  type AICostRow,
  type AIUsageSnapshot,
  type AIUsageView,
} from '@lantern/shared/ai';
import { aiUsageCounterCopy } from '@lantern/shared/utils/aiUsage';
import { ScreenScroll } from '../../components/layout';
import { AppIcon, type AppIconName } from '../../components/ui/AppIcon';
import { FeatureDisc, useFeatureAccent, smallTextInk } from '../../components/ui/FeatureDisc';
import { BackButton } from '../../components/ui/BackButton';
import { Card } from '../../components/ui';
import { useTheme } from '../../theme';
import { useAIUsage } from '../../components/AIUsageBadge';
import { fetchAIUsageDetail } from '../../services/ai';
import { navigate as navigateFromRoot } from '../../navigation/navigationRef';

/** How often the countdown re-renders while the screen is open. */
const TICK_MS = 30_000;

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <Text className="text-label text-lantern-text-secondary uppercase mt-6 mb-2">{children}</Text>
  );
}

/** The meter. A bar, not a dial: it has to read at a glance in the AI ink. */
function UsageBar({ view }: { view: AIUsageView }) {
  const accent = useFeatureAccent('ai');
  const { colors } = useTheme();
  return (
    <View
      className="h-2.5 rounded-full overflow-hidden"
      style={{ backgroundColor: colors.border }}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <View
        className="h-full rounded-full"
        style={{
          width: `${Math.round(view.ratio * 100)}%`,
          backgroundColor: view.exhausted ? colors.error : accent.ink,
        }}
      />
    </View>
  );
}

function CostRow({ row }: { row: AICostRow }) {
  const { colors, isDark } = useTheme();
  const accent = useFeatureAccent('ai');
  const priceInk = row.affordable ? smallTextInk('ai', accent, isDark) : colors.error;

  return (
    <View className="flex-row items-start gap-3 py-2.5 border-t border-lantern-border">
      <View className="flex-1 min-w-0">
        <Text className="text-body text-lantern-text">{row.label}</Text>
        <Text className="text-caption text-lantern-text-secondary">{row.detail}</Text>
        {row.featureCapLabel ? (
          <Text
            className="text-label mt-0.5"
            style={{ color: row.featureCapReached ? colors.error : colors.textTertiary }}
          >
            {row.featureCapReached
              ? `Its own daily cap is spent — ${row.featureCapLabel}`
              : `Its own daily cap: ${row.featureCapLabel}`}
          </Text>
        ) : null}
      </View>
      {/* The price, always, on the same helper every button uses. */}
      <Text className="text-caption font-semibold" style={{ color: priceInk }}>
        {row.costLabel}
      </Text>
    </View>
  );
}

export function UsageLimitsScreen() {
  const { colors } = useTheme();
  const accent = useFeatureAccent('ai');
  // The badge's live figures are the starting point, so the screen has
  // something true to draw before the fetch lands.
  const badgeUsage = useAIUsage();
  const [snapshot, setSnapshot] = useState<AIUsageSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // This also republishes the global counts to every subscriber, so
      // opening the screen re-syncs the top bar's badge with the server.
      setSnapshot(await fetchAIUsageDetail());
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, []);

  const view = buildAIUsageView(
    snapshot ?? {
      used: badgeUsage.used,
      limit: badgeUsage.limit,
      resetsAt: badgeUsage.resetsAt,
    },
    { nowMs }
  );

  /*
   * What the counter is allowed to say.
   *
   * The badge's figures start at the honest unknown (limit 0) until the server
   * answers, and `buildAIUsageView` reads a 0 as "AI uses are not available on
   * this account" — true of a server that answered zero, a lie about a phone
   * that has not been told yet. This planner tells the two apart, so a cold
   * start says it is checking rather than inventing a number OR revoking one.
   */
  const counter = aiUsageCounterCopy({
    knownLabel: view.countLabel,
    limit: view.limit,
    serverAnswered: snapshot !== null,
    loading,
    failed,
  });

  return (
    <ScreenScroll>
      <View className="flex-row items-center gap-2 px-4 py-3">
        <BackButton />
        <Text className="text-title text-lantern-text">Usage & limits</Text>
      </View>

      <View className="px-4 pb-4">
        {/* The counter. */}
        <Card>
          <View className="flex-row items-center gap-3 pb-3">
            <FeatureDisc feature="ai" icon="sparkles" size={40} />
            <View className="flex-1 min-w-0">
              <Text className="text-heading text-lantern-text">{counter.countLine}</Text>
              {/* Referral rewards, if the server reports any. Absent field =
                  no line at all: a "+0" would be a balance we never measured. */}
              {view.bonusLabel ? (
                <Text className="text-caption font-semibold" style={{ color: accent.ink }}>
                  {view.bonusLabel} · earned from invites, spent after today's allowance
                </Text>
              ) : null}
              <Text className="text-caption text-lantern-text-secondary">
                {view.resetRelative}
                {view.resetAbsolute ? ` · ${view.resetAbsolute}` : ''}
              </Text>
            </View>
            {loading ? <ActivityIndicator color={accent.ink} /> : null}
          </View>
          <UsageBar view={view} />
          {counter.offlineNote ? (
            <Text className="text-caption mt-2" style={{ color: colors.warning }}>
              {counter.offlineNote}
            </Text>
          ) : null}
        </Card>

        {/* At zero. The countdown and the doors that are still open. */}
        {view.exhausted ? (
          <View
            className="mt-4 rounded-2xl p-4"
            style={{ backgroundColor: accent.tint }}
            accessible
            accessibilityLabel={`You are out of AI uses. ${view.resetRelative}.`}
          >
            <Text className="text-heading" style={{ color: accent.ink }}>
              You are out for today
            </Text>
            <Text className="text-caption mt-1" style={{ color: accent.ink }}>
              Nothing you have made is locked. Here is what still works.
            </Text>
            {view.nextSteps.map((step) => {
              const icon: AppIconName =
                step.kind === 'wait'
                  ? 'time'
                  : step.kind === 'referral'
                    ? 'person-add'
                    : 'checkmark-circle';
              const body = (
                <>
                  <AppIcon name={icon} size={16} color={accent.ink} />
                  <View className="flex-1 min-w-0">
                    <Text className="text-body" style={{ color: accent.ink }}>
                      {step.label}
                    </Text>
                    <Text className="text-caption text-lantern-text-secondary">{step.detail}</Text>
                  </View>
                </>
              );
              // The referral step is the only one that can CHANGE the number,
              // so it is the only one that goes anywhere. It opens the invite
              // screen that already exists — no new flow, and no checkout:
              // there is nothing to buy on this screen and never will be.
              if (step.kind === 'referral') {
                return (
                  <Pressable
                    key={step.id}
                    onPress={() => navigateFromRoot('InviteFriends')}
                    accessibilityRole="button"
                    accessibilityLabel={step.label}
                    className="flex-row items-start gap-2 mt-2.5 active:opacity-80"
                  >
                    {body}
                    <AppIcon name="chevron-forward" size={16} color={accent.ink} />
                  </Pressable>
                );
              }
              return (
                <View key={step.id} className="flex-row items-start gap-2 mt-2.5">
                  {body}
                </View>
              );
            })}
          </View>
        ) : null}

        <SectionHeading>What each action costs</SectionHeading>
        <Card>
          {view.costRows.map((row) => (
            <CostRow key={row.id} row={row} />
          ))}
        </Card>

        <SectionHeading>What costs nothing</SectionHeading>
        <Card>
          {view.freeRows.map((row) => (
            <View
              key={row.id}
              className="flex-row items-start gap-3 py-2.5 border-t border-lantern-border"
            >
              <AppIcon name="checkmark-circle" size={18} color={colors.success} />
              <View className="flex-1 min-w-0">
                <Text className="text-body text-lantern-text">{row.label}</Text>
                <Text className="text-caption text-lantern-text-secondary">{row.detail}</Text>
              </View>
            </View>
          ))}
        </Card>

        <SectionHeading>Work in progress</SectionHeading>
        <Card>
          <Pressable
            onPress={() => navigateFromRoot('Main', { screen: 'HomeTab' })}
            accessibilityRole="button"
            accessibilityLabel="See what is being made, on Home"
            className="flex-row items-center gap-3 py-2.5"
          >
            <FeatureDisc feature="ai" icon="time" size={32} />
            <View className="flex-1 min-w-0">
              <Text className="text-body text-lantern-text">See what is being made</Text>
              {/* The honest refund rule, said once, where it can be checked:
                  a run that fails before the AI answers is given back
                  automatically; one that fails while SAVING was already paid
                  for, and saving it again is free. */}
              <Text className="text-caption text-lantern-text-secondary">
                On Home. A run that fails before the AI answers is refunded; one that fails while
                saving keeps its charge, and saving it again is free.
              </Text>
            </View>
            <AppIcon name="chevron-forward" size={18} color={colors.textTertiary} />
          </Pressable>
        </Card>

        <Text className="text-caption text-lantern-text-secondary mt-4">
          Your allowance is the same for everyone and resets every day. There is nothing to buy
          here.
        </Text>
      </View>
    </ScreenScroll>
  );
}

export default UsageLimitsScreen;
