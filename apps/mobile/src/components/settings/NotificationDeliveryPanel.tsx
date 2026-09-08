/**
 * The notification-delivery panel, mounted in two places on purpose.
 *
 * It lived inside NotificationsScreen — the inbox tab — where a student
 * looking for "why didn't I get told?" never goes. Settings is where they
 * look, so Settings renders it too, from this one implementation rather than
 * a second copy that would drift.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, Text, View } from 'react-native';
import { useTheme } from '../../theme';
import { useJobsStore } from '../../stores/jobsStore';
import type { JobPushAudit } from '../../stores/jobsCore';
import { AppIcon } from '../ui/AppIcon';
import {
  fetchPushTokenStatus,
  getCachedPushToken,
  getLastPushRegisterError,
  getPushAppIdentity,
  getPushPermissionState,
  isPushNotificationsSupported,
  reRegisterPushToken,
} from '../../services/pushNotifications';
import {
  registerOutcomeParts,
  hasPushDetails,
  pushDiagnosticRows,
  pushErrorRows,
  jobPushFailureRows,
  jobPushFailureDetail,
  pushIdentityRows,
  pushReadiness,
  pushReadinessSummary,
  type PushAppIdentity,
  type PushReadinessInput,
} from '../../utils/pushDiagnostics';

/**
 * "Why didn't I get a notification?", answered on the device.
 *
 * A generation finished while the app was backgrounded and no push ever
 * arrived; the notice the student eventually saw was the LOCAL one posted on
 * resume. Nothing in the app could tell them whether the OS had blocked it,
 * whether this phone had ever registered a token, or whether the server held
 * one — so the failure was invisible and unreportable.
 *
 * Each of those is now stated separately, from its real source, with the one
 * action that can fix the client half. It claims nothing it has not checked:
 * a server that cannot be reached produces "couldn't check", never "off".
 */
/**
 * The device's real push state, and a way to re-read it.
 *
 * Exported because the Settings screen's "Push Notifications" switch has to
 * show the same truth this panel prints four lines above it — on device the
 * two disagreed, the switch reading ON while the panel said the OS had never
 * allowed anything. One reader, one answer.
 */
export function usePushDeliveryState() {
  const [state, setState] = useState<PushReadinessInput>({
    supported: isPushNotificationsSupported(),
    permission: 'undetermined',
    deviceToken: getCachedPushToken(),
    server: null,
  });
  const [checking, setChecking] = useState(true);
  const [identity, setIdentity] = useState<PushAppIdentity>(() => getPushAppIdentity());
  const [registerError, setRegisterError] = useState<string | null>(null);

  const check = useCallback(async () => {
    setChecking(true);
    const [permission, server] = await Promise.all([
      getPushPermissionState(),
      fetchPushTokenStatus(),
    ]);
    setState({
      supported: isPushNotificationsSupported(),
      permission,
      deviceToken: getCachedPushToken(),
      server,
    });
    setIdentity(getPushAppIdentity());
    setRegisterError(getLastPushRegisterError());
    setChecking(false);
  }, []);

  useEffect(() => {
    void check();
  }, [check]);

  return { state, checking, identity, registerError, check };
}

export function NotificationDeliveryPanel() {
  const { colors } = useTheme();
  // Which app this build would mint a token for, and why the last attempt
  // failed, come with the state: "re-register" changes them, and the transport
  // is only known once a token has actually been asked for.
  const { state, checking, identity, registerError, check } = usePushDeliveryState();
  const [working, setWorking] = useState(false);
  // Split the same way the rows are: the plain half is always on screen, the
  // verbatim OS/Expo sentence only behind "Show details".
  const [outcome, setOutcome] = useState<string | null>(null);
  const [outcomeDetail, setOutcomeDetail] = useState<string | null>(null);
  /**
   * Whether the build-facing text is on screen.
   *
   * Closed by default. What was here before was an APNs credential string and
   * an EAS slug printed straight at a student, on a phone that could do
   * nothing with either.
   */
  const [showDetails, setShowDetails] = useState(false);

  const reRegister = useCallback(async () => {
    setWorking(true);
    const result = await reRegisterPushToken();
    const parts = registerOutcomeParts(result);
    setOutcome(parts.value);
    setOutcomeDetail(parts.detail ?? null);
    setWorking(false);
    await check();
  }, [check]);

  // The job sheet shows students one plain sentence when a push fails; the
  // raw Expo detail (the APNs-credentials string, a DeviceNotRegistered ticket)
  // belongs here, on the diagnostics panel, where the founder reads it.
  const latestJobPushAudit = useJobsStore(s => {
    // Jobs are kept newest-first; the first one whose audit carries a failure
    // detail is the one worth showing.
    for (const job of s.jobs) {
      const audit = (job as { pushAudit?: JobPushAudit }).pushAudit;
      if (audit && jobPushFailureDetail(audit)) return audit;
    }
    return null;
  });
  const rows = [
    ...pushDiagnosticRows(state),
    ...pushIdentityRows(identity),
    ...pushErrorRows(registerError),
    ...jobPushFailureRows(latestJobPushAudit),
  ];
  const readiness = pushReadiness(state);
  /**
   * The header tick, which is a claim about THIS phone.
   *
   * `pushReadiness` asks the server, and the server holds ONE token per
   * account — so "a token is on file" can be a token minted on another phone,
   * or a stale one from before this build. When registration has failed in
   * this process, this device demonstrably could not get a token, and a green
   * tick over that red row is the exact contradiction the screenshot showed.
   * Green means every check this panel can make agrees.
   */
  const headerReady = readiness === 'ready' && !registerError;
  const blocked = state.permission === 'denied' || state.permission === 'unavailable';

  return (
    <View className="mb-4 rounded-2xl border border-lantern-border bg-lantern-surface p-4">
      <View className="flex-row items-center gap-2">
        <AppIcon
          name={headerReady ? 'checkmark-circle' : 'alert-circle'}
          size={18}
          // Green tick ONLY when this phone will genuinely be reached. On
          // device the header showed a green tick above "Push token on this
          // device: None yet" and two red error rows. Anything short of ready
          // — "off" or "couldn't check" — is an honest amber warning, never a
          // grey that reads as neutral.
          color={headerReady ? colors.success : colors.warning}
        />
        <Text className="text-heading text-lantern-text flex-1">
          Notification delivery
        </Text>
        {checking ? <ActivityIndicator size="small" color={colors.textSecondary} /> : null}
      </View>

      <Text className="mt-1 text-caption text-lantern-text-secondary">
        {/* The sentence follows the tick: it must not promise this phone will
            be reached while this phone's own registration has just failed. */}
        {headerReady
          ? pushReadinessSummary(state)
          : readiness === 'ready'
            ? "This phone couldn't finish setting up notifications. Try re-registering it below."
            : pushReadinessSummary(state)}
      </Text>

      <View className="mt-3 gap-2">
        {rows.map((row) => (
          <View key={row.key} className="flex-row items-start gap-2">
            <AppIcon
              name={
                row.state === 'ok'
                  ? 'checkmark-circle'
                  : row.state === 'bad'
                    ? 'close-circle'
                    : 'help-circle'
              }
              size={14}
              color={
                row.state === 'ok'
                  ? colors.success
                  : row.state === 'bad'
                    ? colors.error
                    : colors.textTertiary
              }
            />
            <View className="flex-1">
              <Text className="text-caption text-lantern-text-secondary">
                <Text className="text-lantern-text">{row.label}: </Text>
                {row.value}
              </Text>
              {/* The build words, only when asked for. */}
              {row.detail && showDetails ? (
                <Text className="mt-1 text-caption text-lantern-text-tertiary" selectable>
                  {row.detail}
                </Text>
              ) : null}
            </View>
          </View>
        ))}
      </View>

      {hasPushDetails(rows) || outcomeDetail ? (
        <Pressable
          onPress={() => setShowDetails((open) => !open)}
          accessibilityRole="button"
          accessibilityState={{ expanded: showDetails }}
          className="mt-2 self-start py-1"
        >
          <Text className="text-caption font-medium text-lantern-primary-text">
            {showDetails ? 'Hide details' : 'Show details'}
          </Text>
        </Pressable>
      ) : null}

      {outcome ? (
        <View className="mt-3">
          <Text className="text-caption text-lantern-text" accessibilityLiveRegion="polite">
            {outcome}
          </Text>
          {outcomeDetail && showDetails ? (
            <Text className="mt-1 text-caption text-lantern-text-tertiary" selectable>
              {outcomeDetail}
            </Text>
          ) : null}
        </View>
      ) : null}

      <View className="mt-3 flex-row flex-wrap gap-2">
        <Pressable
          onPress={() => void reRegister()}
          disabled={working}
          accessibilityRole="button"
          className="rounded-full px-3 py-2 border border-lantern-border min-h-[36px] justify-center"
          style={{ opacity: working ? 0.6 : 1 }}
        >
          <Text className="text-caption font-medium text-lantern-primary-text">
            {working ? 'Re-registering…' : 'Re-register this device'}
          </Text>
        </Pressable>
        <Pressable
          onPress={() => void check()}
          accessibilityRole="button"
          className="rounded-full px-3 py-2 border border-lantern-border min-h-[36px] justify-center"
        >
          <Text className="text-caption font-medium text-lantern-text-secondary">Check again</Text>
        </Pressable>
        {blocked ? (
          <Pressable
            onPress={() => void Linking.openSettings().catch(() => undefined)}
            accessibilityRole="button"
            className="rounded-full px-3 py-2 border border-lantern-border min-h-[36px] justify-center"
          >
            <Text className="text-caption font-medium text-lantern-text-secondary">
              Open system settings
            </Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}
