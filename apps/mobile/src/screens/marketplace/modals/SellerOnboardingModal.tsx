import React, { useState } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { completeSellerOnboarding } from '../../../services/api';
import type { SellerOnboardingStatus } from '@lantern/shared/types';
import { Button } from '../../../components/ui';

interface Props {
  visible: boolean;
  status: SellerOnboardingStatus;
  onComplete: () => void;
  onDismiss: () => void;
}

export function SellerOnboardingModal({ visible, status, onComplete, onDismiss }: Props) {
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const tips = status.tips?.length ? status.tips : [
    'Add clear photos — listings with 3+ images get more views.',
    'Set a campus meetup location buyers recognize.',
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
        <View className="bg-lantern-surface rounded-t-3xl p-5">
          <View className="flex-row items-center gap-2 mb-2">
            <Ionicons name="rocket-outline" size={22} color="#6366f1" />
            <Text className="text-lg font-bold text-lantern-text">Seller setup</Text>
          </View>
          {!isLast ? (
            <>
              <Text className="text-xs font-semibold text-lantern-primary mb-2">
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
