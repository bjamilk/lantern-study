/**
 * Onboarding: welcome → starter deck → done (contract §5 / plan §4 F).
 *
 * The old goal + streak screens are gone; their defaults (20 cards/day,
 * 7-day streak target, "retention" goal) are persisted silently. The starter
 * step calls the same AI generate-flashcards endpoint the web uses, pre-seeded
 * with the student's programme + first course, and files the deck under that
 * course.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';
import { ScreenScroll } from '../../components/layout';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { FlashcardType } from '@lantern/shared';
import { normalizeFlashcardCount } from '@lantern/shared/utils';
import type { Course } from '@lantern/shared/types';
import { Button } from '../../components/ui';
import { useSettingsStore } from '../../stores/settingsStore';
import { useAuthStore } from '../../stores/authStore';
import { useFlashcardStore } from '../../stores/flashcardStore';
import { aiGenerateFlashcards } from '../../services/ai';
import { getMyActiveCourses, loadAcademicProfile } from '../../services/academic';
import { navigateToDeckDetail } from '../../navigation/navigationRef';
import { useAppTheme } from '../../theme';
import { formatCourseLabel } from '../../utils/courseSelection';
import type { AcademicProfile } from '../../utils/academicProfile';

import {
  ONBOARDING_COMPLETE_STORAGE_KEY,
  ONBOARDING_COMPLETE_VALUE,
  isOnboardingCompleteFlag,
} from '@lantern/shared/settings';
import { AppIcon } from '../../components/ui/AppIcon';
/** Silent defaults the removed goal/streak screens used to write. */
const DEFAULT_STREAK_TARGET = 7;
const DEFAULT_STUDY_GOAL = 'retention';
const DEFAULT_DAILY_CARD_GOAL = 20;

type Step = 'welcome' | 'starter' | 'done';

type Props = {
  onComplete?: () => void;
};

/** Seed text for the AI: programme + first course when known, else a generic nudge. */
export function buildStarterPrompt(profile: AcademicProfile | null, firstCourse: Course | null): string {
  const subject = [profile?.programme?.trim() || null, firstCourse ? formatCourseLabel(firstCourse) : null]
    .filter(Boolean)
    .join(' — ');
  if (!subject) return '';
  const level = profile?.studyLevel ? ` at ${profile.studyLevel} level` : '';
  return `Starter flashcards for ${subject}${level}: key definitions, core concepts, and the questions lecturers ask most in the first weeks of the course.`;
}

export function OnboardingScreen({ onComplete }: Props) {
  const updateSettings = useSettingsStore(s => s.updateSettings);
  const user = useAuthStore(s => s.user);
  const createDeck = useFlashcardStore(s => s.createDeck);
  const createFlashcard = useFlashcardStore(s => s.createFlashcard);
  const theme = useAppTheme();
  const isDark = theme === 'dark';

  const [step, setStep] = useState<Step>('welcome');
  const [saving, setSaving] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [notes, setNotes] = useState('');
  const [firstCourse, setFirstCourse] = useState<Course | null>(null);
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [createdDeck, setCreatedDeck] = useState<{ id: string; name: string; cards: number } | null>(null);
  const userEditedNotes = useRef(false);

  // Pre-seed the starter prompt from the academic profile + first active
  // course. Runs once per entry into the 'starter' step. It reads the store via
  // getState() rather than depending on the academicProfile selector: this
  // effect calls loadAcademicProfile, which setAcademicProfile(newObject) —
  // depending on that selector would change the effect's identity and refire
  // it, looping a GET /users/:id + GET /users/me/courses storm on this step.
  useEffect(() => {
    if (step !== 'starter' || !user?.id) return;
    const userId = user.id;
    let cancelled = false;
    void (async () => {
      setSeeding(true);
      try {
        const [profile, courses] = await Promise.all([
          loadAcademicProfile(userId).catch(() => useAuthStore.getState().academicProfile),
          getMyActiveCourses({ force: true }).catch(() => []),
        ]);
        if (cancelled) return;
        const course = courses[0]?.course ?? null;
        setFirstCourse(course);
        if (!userEditedNotes.current) {
          setNotes(buildStarterPrompt(profile ?? useAuthStore.getState().academicProfile, course));
        }
      } finally {
        if (!cancelled) setSeeding(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [step, user?.id]);

  const persistDefaults = useCallback(async (skipped: boolean) => {
    try {
      if (!skipped) {
        await updateSettings('study', { dailyCardGoal: DEFAULT_DAILY_CARD_GOAL });
      }
      await AsyncStorage.setItem(ONBOARDING_COMPLETE_STORAGE_KEY, ONBOARDING_COMPLETE_VALUE);
      await AsyncStorage.setItem('lantern_onboarding_streak_target', String(DEFAULT_STREAK_TARGET));
      await AsyncStorage.setItem('lantern_onboarding_goal', DEFAULT_STUDY_GOAL);
    } catch {
      // Never block onboarding on local persistence.
    }
  }, [updateSettings]);

  const finish = useCallback(
    async (skipped = false) => {
      setSaving(true);
      try {
        await persistDefaults(skipped);
        if (!skipped) {
          void import('../../services/productAnalytics').then(({ trackOnboardingCompleted }) => {
            trackOnboardingCompleted();
          });
        }
        const deck = createdDeck;
        onComplete?.();
        if (deck) {
          // Main mounts once onComplete flips the gate; hop to the new deck then.
          setTimeout(() => navigateToDeckDetail({ deckId: deck.id, deckName: deck.name }), 350);
        }
      } finally {
        setSaving(false);
      }
    },
    [createdDeck, onComplete, persistDefaults]
  );

  const handleGenerate = useCallback(async () => {
    const prompt = notes.trim();
    if (!prompt || !user?.id) {
      setStep('done');
      return;
    }
    setGenerating(true);
    setGenerateError(null);
    try {
      const { flashcards } = await aiGenerateFlashcards(prompt, { count: normalizeFlashcardCount() });
      if (!flashcards?.length) {
        setGenerateError('No flashcards came back. Try a more specific topic, or skip for now.');
        return;
      }
      const deckName = firstCourse ? `${firstCourse.code} starter deck` : 'My First Deck';
      const deck = await createDeck(deckName, 'From onboarding', user.id, {
        courseId: firstCourse?.id ?? null,
      });
      let created = 0;
      for (const card of flashcards) {
        try {
          await createFlashcard({
            deckId: deck.id,
            type: FlashcardType.BASIC,
            front: card.front,
            back: card.back,
            userId: user.id,
          });
          created += 1;
        } catch (cardError) {
          console.warn('[Onboarding] Could not save a starter card:', cardError);
        }
      }
      setCreatedDeck({ id: deck.id, name: deck.name, cards: created });
      void import('../../services/productAnalytics').then(({ trackAIToolUsed }) => {
        trackAIToolUsed('generate_flashcards');
      });
      setStep('done');
    } catch (e: unknown) {
      setGenerateError(e instanceof Error ? e.message : 'Could not generate flashcards right now.');
    } finally {
      setGenerating(false);
    }
  }, [notes, user?.id, firstCourse, createDeck, createFlashcard]);

  const subtleText = isDark ? 'text-lantern-text-tertiary' : 'text-lantern-text-secondary';
  const headingText = isDark ? 'text-white' : 'text-lantern-text';

  return (
    // The starter step's topic box is the first TextInput a new user ever sees,
    // and its "Generate flashcards & continue" button sits directly under it.
    // ScreenScroll supplies the KeyboardAvoidingView, the persist-taps and the
    // scroll-to-focused-input pass together; the horizontal padding moved to an
    // inner View so the content container can own the bottom clearance.
    <ScreenScroll contentContainerStyle={{ flexGrow: 1, justifyContent: 'center' }}>
      <View className="px-6 pt-8">
        {step === 'welcome' && (
          <View className="items-center">
            <View className="w-16 h-16 rounded-2xl bg-lantern-primary items-center justify-center mb-4">
              <AppIcon name="sparkles" size={32} color="#fff" />
            </View>
            <Text className={`text-2xl font-bold text-center mb-2 ${headingText}`}>Welcome to Lantern Study</Text>
            <Text className={`text-center mb-8 ${subtleText}`}>
              Flashcards, notes, tests and AI — filed under your courses, all in one place. Set up in under a minute.
            </Text>
            <Button fullWidth onPress={() => setStep('starter')}>Get started</Button>
            <Pressable onPress={() => void finish(true)} className="mt-4 py-2" accessibilityRole="button">
              <Text className={subtleText}>Skip for now</Text>
            </Pressable>
          </View>
        )}

        {step === 'starter' && (
          <View>
            <Text className={`text-xl font-bold mb-2 ${headingText}`}>Your first deck</Text>
            <Text className={`mb-4 ${subtleText}`}>
              We’ll generate your first flashcards with AI. Tweak the topic, or paste a few lines from your notes.
            </Text>
            {firstCourse ? (
              <View className="flex-row items-center gap-2 mb-3">
                <AppIcon name="school" size={16} color="#6366f1" />
                <Text className="text-xs font-semibold text-lantern-primary">
                  Filed under {formatCourseLabel(firstCourse)}
                </Text>
              </View>
            ) : null}
            <View className="rounded-2xl border border-lantern-border bg-lantern-surface p-3 mb-3">
              {seeding && !notes ? (
                <View className="flex-row items-center gap-2 py-2">
                  <ActivityIndicator size="small" color="#6366f1" />
                  <Text className={`text-sm ${subtleText}`}>Looking up your programme…</Text>
                </View>
              ) : null}
              <TextInput
                value={notes}
                onChangeText={text => {
                  userEditedNotes.current = true;
                  setNotes(text);
                }}
                placeholder="e.g. BIO 201 — Genetics: Mendel’s laws, alleles, Punnett squares…"
                placeholderTextColor="#94a3b8"
                multiline
                textAlignVertical="top"
                editable={!generating}
                className={`min-h-[120px] text-sm ${headingText}`}
                accessibilityLabel="Starter deck topic or notes"
              />
            </View>
            {generateError ? (
              <Text className="text-xs text-red-500 mb-3">{generateError}</Text>
            ) : null}
            <Button fullWidth loading={generating} onPress={() => void handleGenerate()}>
              {notes.trim() ? 'Generate flashcards & continue' : "Skip — I'll add cards later"}
            </Button>
            <Pressable
              onPress={() => setStep('done')}
              disabled={generating}
              className="mt-4 py-2 items-center"
              accessibilityRole="button"
            >
              <Text className={subtleText}>Skip this step</Text>
            </Pressable>
          </View>
        )}

        {step === 'done' && (
          <View className="items-center">
            <View className="w-16 h-16 rounded-2xl bg-lantern-primary items-center justify-center mb-4">
              <AppIcon name="checkmark" size={32} color="#fff" />
            </View>
            <Text className={`text-2xl font-bold text-center mb-2 ${headingText}`}>You’re all set</Text>
            <Text className={`text-center mb-8 ${subtleText}`}>
              {createdDeck
                ? `“${createdDeck.name}” is ready with ${createdDeck.cards} card${createdDeck.cards === 1 ? '' : 's'}. Open it to start learning.`
                : 'Create decks, take notes and run tests — everything files under your courses in the Library.'}
            </Text>
            <Button fullWidth loading={saving} onPress={() => void finish(false)}>
              {createdDeck ? 'Open Learn mode' : 'Start studying'}
            </Button>
          </View>
        )}
      </View>
    </ScreenScroll>
  );
}

export async function isOnboardingComplete(): Promise<boolean> {
  const v = await AsyncStorage.getItem(ONBOARDING_COMPLETE_STORAGE_KEY);
  return isOnboardingCompleteFlag(v);
}
