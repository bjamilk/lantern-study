import React, { useState } from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Button } from '../../components/ui';
import { useSettingsStore } from '../../stores/settingsStore';
import { useAppTheme } from '../../theme';

const ONBOARDING_KEY = 'lantern_onboarding_complete';

const GOALS = [
  { id: 'exam', label: 'Ace an upcoming exam', icon: '📝' },
  { id: 'retention', label: 'Remember long-term', icon: '🧠' },
  { id: 'daily', label: 'Build a daily habit', icon: '🔥' },
];

const STREAK_TARGETS = [7, 14, 30];

type Props = {
  onComplete?: () => void;
};

export function OnboardingScreen({ onComplete }: Props) {
  const updateSettings = useSettingsStore(s => s.updateSettings);
  const theme = useAppTheme();
  const isDark = theme === 'dark';
  const [step, setStep] = useState<'welcome' | 'goal' | 'streak' | 'done'>('welcome');
  const [studyGoal, setStudyGoal] = useState('retention');
  const [streakTarget, setStreakTarget] = useState(7);
  const [saving, setSaving] = useState(false);

  const finish = async (skipped = false) => {
    setSaving(true);
    try {
      if (!skipped) {
        await updateSettings('study', {
          dailyCardGoal: studyGoal === 'daily' ? 30 : 20,
        });
      }
      await AsyncStorage.setItem(ONBOARDING_KEY, 'true');
      await AsyncStorage.setItem('lantern_onboarding_streak_target', String(streakTarget));
      await AsyncStorage.setItem('lantern_onboarding_goal', studyGoal);
      if (!skipped) {
        void import('../../services/productAnalytics').then(({ trackOnboardingCompleted }) => {
          trackOnboardingCompleted();
        });
      }
      onComplete?.();
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView className={`flex-1 ${isDark ? 'bg-lantern-background' : 'bg-lantern-background'}`}>
      <ScrollView contentContainerClassName="flex-grow justify-center px-6 py-8">
        {step === 'welcome' && (
          <View className="items-center">
            <View className="w-16 h-16 rounded-2xl bg-lantern-primary items-center justify-center mb-4">
              <Ionicons name="sparkles" size={32} color="#fff" />
            </View>
            <Text className={`text-2xl font-bold text-center mb-2 ${isDark ? 'text-white' : 'text-lantern-text'}`}>
              Welcome to Lantern Study
            </Text>
            <Text className={`text-center mb-8 ${isDark ? 'text-lantern-text-tertiary' : 'text-lantern-text-secondary'}`}>
              Flashcards, notes, tests, and AI — all in one place. Set up in under a minute.
            </Text>
            <Button fullWidth onPress={() => setStep('goal')}>Get started</Button>
            <Pressable onPress={() => void finish(true)} className="mt-4 py-2">
              <Text className={isDark ? 'text-lantern-text-secondary' : 'text-lantern-text-tertiary'}>Skip for now</Text>
            </Pressable>
          </View>
        )}

        {step === 'goal' && (
          <View>
            <Text className={`text-xl font-bold mb-4 ${isDark ? 'text-white' : 'text-lantern-text'}`}>
              What&apos;s your main goal?
            </Text>
            {GOALS.map(g => (
              <Pressable
                key={g.id}
                onPress={() => setStudyGoal(g.id)}
                className={`flex-row items-center gap-3 p-4 rounded-2xl mb-2 border ${
                  studyGoal === g.id
                    ? 'bg-lantern-primary/30 border-lantern-primary'
                    : isDark
                      ? 'bg-lantern-surface border-lantern-border'
                      : 'bg-lantern-surface border-lantern-border'
                }`}
              >
                <Text className="text-2xl">{g.icon}</Text>
                <Text className={`font-medium flex-1 ${isDark ? 'text-white' : 'text-lantern-text'}`}>{g.label}</Text>
              </Pressable>
            ))}
            <View className="mt-6">
              <Button fullWidth onPress={() => setStep('streak')}>Continue</Button>
            </View>
          </View>
        )}

        {step === 'streak' && (
          <View>
            <Text className={`text-xl font-bold mb-2 ${isDark ? 'text-white' : 'text-lantern-text'}`}>
              Pick a streak target
            </Text>
            <Text className={`mb-4 ${isDark ? 'text-lantern-text-tertiary' : 'text-lantern-text-secondary'}`}>
              Stay consistent — we&apos;ll help you track it.
            </Text>
            <View className="flex-row gap-3 mb-6">
              {STREAK_TARGETS.map(n => (
                <Pressable
                  key={n}
                  onPress={() => setStreakTarget(n)}
                  className={`flex-1 py-4 rounded-2xl items-center border ${
                    streakTarget === n
                      ? 'bg-lantern-primary border-lantern-primary'
                      : isDark
                        ? 'bg-lantern-surface border-lantern-border'
                        : 'bg-lantern-surface border-lantern-border'
                  }`}
                >
                  <Text className={`font-bold text-lg ${streakTarget === n || isDark ? 'text-white' : 'text-lantern-text'}`}>
                    {n}
                  </Text>
                  <Text className={`text-xs ${isDark ? 'text-lantern-text-tertiary' : 'text-lantern-text-secondary'}`}>days</Text>
                </Pressable>
              ))}
            </View>
            <Button fullWidth loading={saving} onPress={() => void finish(false)}>
              Start studying
            </Button>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

export async function isOnboardingComplete(): Promise<boolean> {
  const v = await AsyncStorage.getItem(ONBOARDING_KEY);
  return v === 'true';
}
