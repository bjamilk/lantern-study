/**
 * Bottom-sheet modal that walks a new seller through setup tips and then
 * completes onboarding to unlock boost credits.
 *
 * Exports: SellerOnboardingModal.
 * Touches: completeSellerOnboarding in ../../../services/api; tips come from
 * the SellerOnboardingStatus prop, with a hard-coded fallback list.
 *
 * Gotchas: step state is not reset when the modal is dismissed, so reopening
 * resumes where the seller left off within the same mount. A failed
 * completeSellerOnboarding is swallowed and onComplete is not called, so the
 * modal simply stays open with no error shown.
 */
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import React, { useState } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import { completeSellerOnboarding } from '../../../services/api';
import type { SellerOnboardingStatus } from '@lantern/shared/types';
import { Button } from '../../../components/ui';
import { AppIcon } from '../../../components/ui/AppIcon';
import { brand } from '../../../theme';

interface Props {
  visible: boolean;
  status: SellerOnboardingStatus;
  onComplete: () => void;
  onDismiss: () => void;
}

export function SellerOnboardingModal({ visible, status, onComplete, onDismiss }: Props) {
  const [step, setStep] = useState(0);
  const insets = useSafeAreaInsets();
  const [saving, setSaving] = useState(false);
  const tips = status.tips?.length ? status.tips : [
    'Add clear photos — listings with 3+ images get more views.',
    'Set a campus, city, pickup point, or delivery area buyers recognize.',
    'Enable offers so buyers can negotiate fairly.',
  ];
  const isLast = step >= tips.length;

  const handleComplete = async () => {
    setSaving(true);
    try {
      await completeSellerOnboarding();
      onComplete();
    } catch (e: unknown) {
      // parent can reload
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onDismiss}>
      <View className="flex-1 justify-end bg-black/40">
        <View className="bg-lantern-surface rounded-t-3xl p-5" style={{ paddingBottom: insets.bottom + 20 }}>
          <View className="flex-row items-center gap-2 mb-2">
            <AppIcon name="rocket" size={22} color={brand.text} />
            <Text className="text-lg font-bold text-lantern-text">Seller setup</Text>
          </View>
          {!isLast ? (
            <>
              <Text className="text-xs font-semibold text-lantern-primary-text mb-2">
                Tip {step + 1} of {tips.length}
              </Text>
              <Text className="text-lantern-text mb-4">{tips[step]}</Text>
              <Button onPress={() => setStep(s => s + 1)}>Next</Button>
            </>
          ) : (
            <>
              <Text className="text-center font-semibold text-lantern-text mb-2">
                You&apos;re ready to sell
              </Text>
              <Text className="text-center text-sm text-lantern-text-secondary mb-4">
                Complete setup to unlock 3 free boost credits. Current: {status.boostCredits}
              </Text>
              <Button loading={saving} onPress={() => void handleComplete()}>
                Complete & claim boosts
              </Button>
            </>
          )}
          <Pressable onPress={onDismiss} className="mt-3 py-2 items-center">
            <Text className="text-sm text-lantern-text-secondary">Later</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}
