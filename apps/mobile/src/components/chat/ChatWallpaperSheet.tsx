/**
 * "Chat background" — the one place a wallpaper is chosen, cleared, or reset.
 *
 * Opened from the chat's own overflow menu with `scope` set to that chat, and
 * from Settings ▸ Appearance with `scope="default"`. Built on the shared
 * ActionSheet, whose `select()` already closes before firing `onPress` — the
 * guard that keeps iOS from trying to present the picker under a dismissing
 * modal.
 */
import React, { useMemo } from 'react';
import { AccessibilityInfo, Alert } from 'react-native';
import { ActionSheet, type ActionSheetItem } from '../ui';
import { useChatWallpaperStore } from '../../stores/chatWallpaperStore';
import { useToastStore } from '../../stores/toastStore';
import { hasChatOverride, resolveChatWallpaper } from '../../utils/chatWallpaper';

interface ChatWallpaperSheetProps {
  visible: boolean;
  onClose: () => void;
  /** 'default' for the app-wide background, or a chat scope key. */
  scope: 'default' | string;
  scopeLabel: 'this chat' | 'all your chats';
}

export function ChatWallpaperSheet({
  visible,
  onClose,
  scope,
  scopeLabel,
}: ChatWallpaperSheetProps) {
  const manifest = useChatWallpaperStore((s) => s.manifest);
  const pickAndApply = useChatWallpaperStore((s) => s.pickAndApply);
  const setNone = useChatWallpaperStore((s) => s.setNone);
  const inheritDefault = useChatWallpaperStore((s) => s.inheritDefault);
  const busy = useChatWallpaperStore((s) => s.busy);
  const showToast = useToastStore((s) => s.showToast);

  const isDefaultScope = scope === 'default';

  const items = useMemo<ActionSheetItem[]>(() => {
    const announce = (message: string) => {
      showToast(message, 'success');
      AccessibilityInfo.announceForAccessibility(message);
    };
    const note = (message: string) => {
      showToast(message, 'info');
      AccessibilityInfo.announceForAccessibility(message);
    };

    const overridden = !isDefaultScope && hasChatOverride(manifest, scope);
    const resolved = isDefaultScope ? manifest.default : resolveChatWallpaper(manifest, scope);

    const rows: ActionSheetItem[] = [
      {
        label: 'Choose a photo',
        icon: 'image-outline',
        // Preparing a large photo takes seconds on a cheap Android. A second
        // run would race the first and could delete the winner's file, so the
        // row is closed until the current one finishes.
        disabled: busy,
        hint: busy
          ? 'Still saving your last photo…'
          : 'Saved on this phone only — costs no data',
        accessibilityLabel: `Choose a photo for the background of ${scopeLabel}`,
        onPress: () => {
          void (async () => {
            const outcome = await pickAndApply(scope);
            if (outcome === 'applied') {
              announce(
                isDefaultScope ? 'Default chat background updated' : 'Chat background updated',
              );
            } else if (outcome === 'denied') {
              Alert.alert(
                'Permission needed',
                'Allow photo library access to set a chat background.',
              );
            } else if (outcome === 'busy') {
              note('Still saving your last background — one moment');
            } else if (outcome === 'failed') {
              showToast(
                "Couldn't save that background. Check your phone's storage and try again.",
                'error',
              );
            }
            // 'cancelled': the student backed out — say nothing.
          })();
        },
      },
    ];

    if (!isDefaultScope && overridden && manifest.default) {
      rows.push({
        label: 'Use my default background',
        icon: 'refresh-outline',
        hint: 'Match the rest of your chats',
        accessibilityLabel: 'Use my default background in this chat',
        onPress: () => {
          void inheritDefault(scope).then(() => note('Using your default background'));
        },
      });
    }

    rows.push({
      label: 'No background',
      icon: 'close-circle-outline',
      hint: 'Back to the plain chat colour',
      // Nothing to undo: this scope already resolves to plain and carries no
      // override to clear.
      disabled: !resolved && !overridden,
      accessibilityLabel: isDefaultScope
        ? 'Remove my default chat background'
        : 'Remove the background from this chat',
      onPress: () => {
        void setNone(scope).then(() => note('Chat background removed'));
      },
    });

    return rows;
  }, [
    busy,
    inheritDefault,
    isDefaultScope,
    manifest,
    pickAndApply,
    scope,
    scopeLabel,
    setNone,
    showToast,
  ]);

  return (
    <ActionSheet visible={visible} title="Chat background" items={items} onClose={onClose} />
  );
}
