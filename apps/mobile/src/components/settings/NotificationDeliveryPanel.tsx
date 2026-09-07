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
  describeRegisterOutcome,
  pushDiagnosticRows,
  pushErrorRows,
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
export function NotificationDeliveryPanel() {
  const { colors } = useTheme();
  const [state, setState] = useState<PushReadinessInput>({
    supported: isPushNotificationsSupported(),
    permission: 'undetermined',
    deviceToken: getCachedPushToken(),
    server: null,
  });
  const [checking, setChecking] = useState(true);
  const [working, setWorking] = useState(false);
  const [outcome, setOutcome] = useState<string | null>(null);
  // Which app this build would mint a token for, and why the last attempt
  // failed. Both are read after every check, because "re-register" changes
  // them: the transport is only known once a token has actually been asked for.
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

  const reRegister = useCallback(async () => {
    setWorking(true);
    // The outcome is shown verbatim — including the server's own refusal
    // text, which is the sentence that actually explains the failure.
    const result = await reRegisterPushToken();
    setOutcome(describeRegisterOutcome(result));
    setWorking(false);
    await check();
  }, [check]);

  const rows = [
    ...pushDiagnosticRows(state),
    ...pushIdentityRows(identity),
    ...pushErrorRows(registerError),
  ];
  const readiness = pushReadiness(state);
  const blocked = state.permission === 'denied' || state.permission === 'unavailable';

  return (
    <View className="mb-4 rounded-2xl border border-lantern-border bg-lantern-surface p-4">
      <View className="flex-row items-center gap-2">
        <AppIcon
          name={readiness === 'ready' ? 'checkmark-circle' : 'alert-circle'}
          size={18}
          color={readiness === 'ready' ? colors.success : colors.textSecondary}
        />
        <Text className="text-heading text-lantern-text flex-1">
          Notification delivery
        </Text>
        {checking ? <ActivityIndicator size="small" color={colors.textSecondary} /> : null}
      </View>

      <Text className="mt-1 text-caption text-lantern-text-secondary">
        {pushReadinessSummary(state)}
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
            <Text className="text-caption text-lantern-text-secondary flex-1">
              <Text className="text-lantern-text">{row.label}: </Text>
              {row.value}
            </Text>
          </View>
        ))}
      </View>

      {outcome ? (
        <Text className="mt-3 text-caption text-lantern-text" accessibilityLiveRegion="polite">
          {outcome}
        </Text>
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
