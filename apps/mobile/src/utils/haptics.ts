import * as Haptics from 'expo-haptics';
import { useSettingsStore } from '../stores/settingsStore';

export function withHaptic(fn: () => void | Promise<void>) {
  if (useSettingsStore.getState().settings.accessibility.hapticFeedback) {
    void fn();
  }
}

export function hapticSelection() {
  withHaptic(() => Haptics.selectionAsync());
}

export function hapticSuccess() {
  withHaptic(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success));
}

export function hapticWarning() {
  withHaptic(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning));
}

export function hapticError() {
  withHaptic(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error));
}
