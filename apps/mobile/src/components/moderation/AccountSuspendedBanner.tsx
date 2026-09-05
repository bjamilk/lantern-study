/**
 * Blocking notice for a suspended account (Phase 1 · E, contract §3
 * "Enforcement" / §5). Rendered by RootNavigator whenever moderationStore
 * holds `suspendedUntil`; the API client sets it from the 403
 * ACCOUNT_SUSPENDED probe. Mirrors AccountPausedBannerMobile's amber styling.
 * Deliberately no automatic sign-out — the account comes back on the date —
 * but the user may check again, write to support, or log out themselves.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Linking, Modal, Text, View } from 'react-native';
import { SUPPORT_EMAIL, buildSupportMailtoUrl } from '@lantern/shared/contactForm';
import { Button } from '../ui';
import { useModerationStore } from '../../stores/moderationStore';
import { useAuthStore } from '../../stores/authStore';
import { formatSuspendedUntil, probeAccountSuspension } from '../../services/accountSuspension';
import { AppIcon } from '../ui/AppIcon';

export function AccountSuspendedBanner() {
  const suspendedUntil = useModerationStore((s) => s.suspendedUntil);
  const suspensionMessage = useModerationStore((s) => s.suspensionMessage);
  const clearSuspension = useModerationStore((s) => s.clearSuspension);
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const signOut = useAuthStore((s) => s.signOut);
  const [checking, setChecking] = useState(false);

  // A different account (or none) on this device must never inherit the flag:
  // clear when the signed-in user changes and when the banner unmounts on
  // sign-out — but NOT on mount, since the bootstrap requests can 403 (and set
  // the flag) before RootNavigator has a `user` to mount this under.
  const prevUserIdRef = useRef(userId);
  useEffect(() => {
    if (prevUserIdRef.current !== userId) {
      prevUserIdRef.current = userId;
      clearSuspension();
    }
  }, [userId, clearSuspension]);
  useEffect(() => () => clearSuspension(), [clearSuspension]);

  if (!userId || !suspendedUntil) return null;

  const untilLabel = formatSuspendedUntil(suspendedUntil);

  const checkAgain = async () => {
    setChecking(true);
    try {
      await probeAccountSuspension({ force: true });
    } finally {
      setChecking(false);
    }
  };

  const contactSupport = () => {
    void Linking.openURL(
      buildSupportMailtoUrl({ subject: 'Account suspension' })
    ).catch(() => undefined);
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => undefined}>
      <View className="flex-1 bg-black/60 items-center justify-center px-5">
        <View className="w-full rounded-2xl border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950 p-5 gap-3">
          <View className="flex-row items-center gap-2">
            <AppIcon name="pause-circle" size={22} color="#b45309" />
            <Text className="text-base font-semibold text-amber-950 dark:text-amber-100 flex-1">
              Your account is suspended
            </Text>
          </View>
          <Text className="text-sm text-amber-900/90 dark:text-amber-200/90 leading-relaxed">
            {suspensionMessage ||
              (untilLabel ? `Account suspended until ${untilLabel}.` : 'Your account is suspended.')}
            {untilLabel && suspensionMessage && !suspensionMessage.includes(untilLabel)
              ? ` It lifts on ${untilLabel}.`
              : ''}{' '}
            Until then you can't post, sell, message or publish. Your data is safe and the account
            comes back by itself when the suspension ends.
          </Text>
          <Text className="text-sm text-amber-900/90 dark:text-amber-200/90">
            Think this is a mistake? Write to {SUPPORT_EMAIL} and our team will review it.
          </Text>
          <View className="flex-row flex-wrap gap-2 mt-1">
            <Button size="sm" variant="secondary" onPress={contactSupport}>
              Contact support
            </Button>
            <Button size="sm" variant="primary" loading={checking} onPress={() => void checkAgain()}>
              Check again
            </Button>
          </View>
          <Button size="sm" variant="ghost" onPress={() => void signOut()}>
            Log out
          </Button>
        </View>
      </View>
    </Modal>
  );
}

export default AccountSuspendedBanner;
