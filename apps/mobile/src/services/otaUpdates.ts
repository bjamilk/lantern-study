import * as Updates from 'expo-updates';

export type OtaCheckResult = {
  checked: boolean;
  updated: boolean;
  isEnabled: boolean;
  updateId: string | null;
  channel: string | null;
  runtimeVersion: string | null;
  reason?: string;
};

export function getOtaDiagnostics(): Omit<OtaCheckResult, 'checked' | 'updated' | 'reason'> {
  return {
    isEnabled: Updates.isEnabled,
    updateId: Updates.updateId ?? null,
    channel: Updates.channel ?? null,
    runtimeVersion: Updates.runtimeVersion ?? null,
  };
}

/**
 * Check Expo EAS Update and reload immediately when a newer bundle is available.
 * No-ops in __DEV__ or when native updates are disabled for the binary.
 */
export async function checkAndApplyOtaUpdate(): Promise<OtaCheckResult> {
  const base = getOtaDiagnostics();

  if (__DEV__) {
    return { ...base, checked: false, updated: false, reason: 'dev-client' };
  }

  if (!Updates.isEnabled) {
    return { ...base, checked: false, updated: false, reason: 'updates-disabled' };
  }

  try {
    const result = await Updates.checkForUpdateAsync();
    if (!result.isAvailable) {
      return { ...base, checked: true, updated: false, reason: 'up-to-date' };
    }

    await Updates.fetchUpdateAsync();
    await Updates.reloadAsync();
    return { ...base, checked: true, updated: true };
  } catch (error) {
    return {
      ...base,
      checked: true,
      updated: false,
      reason: error instanceof Error ? error.message : 'check-failed',
    };
  }
}
