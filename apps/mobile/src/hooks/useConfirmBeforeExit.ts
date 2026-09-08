import { useEffect, useRef } from 'react';
import { appAlert } from '../components/ui/appDialog';
import { useNavigation } from '@react-navigation/native';

export interface ConfirmBeforeExitOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  destructive?: boolean;
  onConfirm?: () => void;
}

/**
 * Prompts before leaving a screen (hardware back, swipe dismiss, goBack).
 * On-screen Exit buttons should call navigation.goBack() to trigger this guard.
 */
export function useConfirmBeforeExit(
  enabled: boolean,
  options: ConfirmBeforeExitOptions
): void {
  const navigation = useNavigation();
  const enabledRef = useRef(enabled);
  const optionsRef = useRef(options);

  enabledRef.current = enabled;
  optionsRef.current = options;

  useEffect(() => {
    const unsubscribe = navigation.addListener('beforeRemove', e => {
      if (!enabledRef.current) return;

      e.preventDefault();

      const {
        title,
        message,
        confirmLabel = 'Exit',
        destructive = false,
        onConfirm,
      } = optionsRef.current;

      appAlert(title, message, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: confirmLabel,
          style: destructive ? 'destructive' : 'default',
          onPress: () => {
            onConfirm?.();
            navigation.dispatch(e.data.action);
          },
        },
      ]);
    });

    return unsubscribe;
  }, [navigation]);
}
