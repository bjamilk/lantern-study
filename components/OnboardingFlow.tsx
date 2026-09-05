import React, { useEffect, useState } from 'react';
import { AcademicCapIcon, SparklesIcon, ArrowRightIcon, BookOpenIcon } from '@heroicons/react/24/outline';
import { Button } from './ui';
import Modal from './ui/Modal';
import { buildStarterDeckPrompt } from '../utils/academicSetup';
import { needsOnboardingAcademicStep } from '../utils/onboardingAcademic';
import { AcademicIdentityStep } from './onboarding/AcademicIdentityStep';
import { useAuthStore } from '../stores/authStore';

export type OnboardingStep = 'welcome' | 'academic' | 'starter' | 'done';

/** Defaults the removed goal/streak screens used to collect — persisted silently. */
export const ONBOARDING_DEFAULT_STUDY_GOAL = 'retention';
export const ONBOARDING_DEFAULT_STREAK_TARGET = 7;

interface OnboardingFlowProps {
  isOpen: boolean;
  onComplete: (data: { studyGoal: string; streakTarget: number }) => void;
  onSkip: () => void;
  onGenerateStarter?: (notes: string) => Promise<void>;
  onOpenLearnMode?: () => void;
  theme?: 'light' | 'dark';
  /** Academic context (Phase 1) used to pre-seed the starter deck prompt. */
  programme?: string | null;
  studyLevel?: number | null;
  firstCourse?: { code: string; title: string } | null;
}

const STARTER_STAGES = ['Reading your brief…', 'Building flashcards…', 'Saving your first deck…'];

/**
 * Onboarding: welcome → academic identity → starter deck → open Learn mode.
 *
 * The academic step is the web equivalent of what mobile's SignUpScreen asks
 * during sign-up (institution + level required, programme optional). It is
 * shown only while the account is missing one of those, and while it is showing
 * the flow cannot be dismissed — the dashboard banner it replaces was skippable
 * forever, which left the academic graph (auto-communities, campus counts,
 * Discover) with nothing to work from.
 *
 * The goal and streak screens were removed; their defaults are passed to
 * onComplete unchanged so downstream persistence keeps working.
 */
export const OnboardingFlow: React.FC<OnboardingFlowProps> = ({
  isOpen,
  onComplete,
  onSkip,
  onGenerateStarter,
  onOpenLearnMode,
  theme = 'light',
  programme = null,
  studyLevel = null,
  firstCourse = null,
}) => {
  const [step, setStep] = useState<OnboardingStep>('welcome');
  const [mode, setMode] = useState<'seeded' | 'paste'>('seeded');
  const [starterNotes, setStarterNotes] = useState('');
  const [seededPrompt, setSeededPrompt] = useState('');
  const [seedTouched, setSeedTouched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [stage, setStage] = useState(0);
  const [generated, setGenerated] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [academicAnswered, setAcademicAnswered] = useState(false);
  const isDark = theme === 'dark';

  // Read from the store rather than props so App.tsx needs no new wiring; the
  // store object is selected whole (never built in the selector).
  const currentUser = useAuthStore((s) => s.currentUser);
  const needsAcademicStep = !academicAnswered && needsOnboardingAcademicStep(currentUser);
  // No backdrop click, no Escape, no "Skip for now" while the required
  // academic answers are still outstanding.
  const blockDismiss = needsAcademicStep && (step === 'welcome' || step === 'academic');

  // Keep the seed fresh while the user's courses load, until they edit it.
  useEffect(() => {
    if (seedTouched) return;
    setSeededPrompt(buildStarterDeckPrompt({ programme, studyLevel, course: firstCourse }));
  }, [programme, studyLevel, firstCourse, seedTouched]);

  useEffect(() => {
    if (!loading) return;
    if (stage >= STARTER_STAGES.length - 1) return;
    const t = setTimeout(() => setStage((s) => s + 1), 900);
    return () => clearTimeout(t);
  }, [loading, stage]);

  if (!isOpen) return null;

  const finish = () => {
    onComplete({ studyGoal: ONBOARDING_DEFAULT_STUDY_GOAL, streakTarget: ONBOARDING_DEFAULT_STREAK_TARGET });
    setStep('done');
  };

  const activeText = mode === 'seeded' ? seededPrompt : starterNotes;

  const handleGenerate = async () => {
    const text = activeText.trim();
    if (!text || !onGenerateStarter) {
      finish();
      return;
    }
    setLoading(true);
    setStage(0);
    setGenerateError(null);
    try {
      await onGenerateStarter(text);
      setGenerated(true);
      finish();
    } catch (err) {
      setGenerateError(err instanceof Error && err.message ? err.message : 'Could not generate your starter deck. You can try again or skip.');
    } finally {
      setLoading(false);
    }
  };

  const courseLine = firstCourse
    ? `${firstCourse.code}${firstCourse.title && firstCourse.title !== firstCourse.code ? ` — ${firstCourse.title}` : ''}`
    : null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={blockDismiss ? () => undefined : onSkip}
      ariaLabelledBy="onboarding-title"
      // The academic step carries a picker plus two fields; max-w-md crushes them.
      maxWidthClass={step === 'academic' ? 'max-w-lg' : 'max-w-md'}
      loading={loading}
      closeOnBackdrop={!loading && !blockDismiss}
      zIndexClass="z-[60]"
      panelClassName="!p-0 rounded-2xl overflow-hidden"
    >
      <div className="w-full bg-lantern-surface">
        {step === 'welcome' && (
          <div className="p-8 text-center">
            <div className="w-16 h-16 bg-lantern-primary-background dark:bg-lantern-primary-dark/40 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <SparklesIcon className="w-8 h-8 text-lantern-primary" />
            </div>
            <h2 id="onboarding-title" className="text-2xl font-bold mb-2 text-lantern-text">Welcome to Lantern Study</h2>
            <p className="text-lantern-text-secondary mb-6">
              Flashcards, notes, tests and AI — filed by course. Let&apos;s build your first deck in under a minute.
            </p>
            <Button
              onClick={() => setStep(needsAcademicStep ? 'academic' : 'starter')}
              className="w-full mb-2"
            >
              Get started <ArrowRightIcon className="w-4 h-4 ml-1" />
            </Button>
            {!needsAcademicStep && (
              <button onClick={onSkip} className="text-sm text-lantern-text-tertiary hover:text-lantern-text-secondary">Skip for now</button>
            )}
          </div>
        )}

        {step === 'academic' && (
          <AcademicIdentityStep
            titleId="onboarding-title"
            onSaved={() => {
              setAcademicAnswered(true);
              setStep('starter');
            }}
          />
        )}

        {step === 'starter' && (
          <div className="p-6">
            {loading ? (
              <div className="py-8 text-center">
                <div className="animate-spin w-10 h-10 border-4 border-lantern-primary border-t-transparent rounded-full mx-auto mb-4" />
                <p className="font-medium text-lantern-text">{STARTER_STAGES[stage]}</p>
                <p className="text-sm text-lantern-text-secondary mt-2">Turning your brief into study cards…</p>
              </div>
            ) : (
              <>
                <h2 id="onboarding-title" className="text-xl font-bold mb-1 text-lantern-text">Your starter deck</h2>
                <p className="text-sm text-lantern-text-secondary mb-4">
                  {courseLine
                    ? <>We&apos;ll generate flashcards for <span className="font-semibold text-lantern-text">{courseLine}</span>{programme ? ` (${programme})` : ''}.</>
                    : programme
                      ? <>We&apos;ll generate flashcards for your <span className="font-semibold text-lantern-text">{programme}</span> studies.</>
                      : "We'll generate your first flashcards — tweak the brief or paste your own notes."}
                </p>
                <div className="flex gap-2 mb-3" role="tablist" aria-label="Starter deck source">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={mode === 'seeded'}
                    onClick={() => setMode('seeded')}
                    className={`flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border ${
                      mode === 'seeded'
                        ? 'border-lantern-primary bg-lantern-primary-background text-lantern-text'
                        : 'border-lantern-border text-lantern-text-secondary'
                    }`}
                  >
                    <SparklesIcon className="w-4 h-4" /> From my course
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={mode === 'paste'}
                    onClick={() => setMode('paste')}
                    className={`flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border ${
                      mode === 'paste'
                        ? 'border-lantern-primary bg-lantern-primary-background text-lantern-text'
                        : 'border-lantern-border text-lantern-text-secondary'
                    }`}
                  >
                    <BookOpenIcon className="w-4 h-4" /> Paste my notes
                  </button>
                </div>
                {mode === 'seeded' ? (
                  <textarea
                    value={seededPrompt}
                    onChange={(e) => { setSeedTouched(true); setSeededPrompt(e.target.value); }}
                    rows={5}
                    aria-label="Starter deck brief"
                    className={`w-full px-3 py-2 rounded-lg border mb-3 text-sm ${isDark ? 'bg-lantern-surface-secondary border-lantern-border text-lantern-text' : 'bg-lantern-background border-lantern-border'}`}
                  />
                ) : (
                  <textarea
                    value={starterNotes}
                    onChange={(e) => setStarterNotes(e.target.value)}
                    placeholder="Paste notes, a definition list, or any study material..."
                    rows={5}
                    aria-label="Your notes"
                    className={`w-full px-3 py-2 rounded-lg border mb-3 text-sm ${isDark ? 'bg-lantern-surface-secondary border-lantern-border text-lantern-text' : 'bg-lantern-background border-lantern-border'}`}
                  />
                )}
                {generateError ? (
                  <p className="text-xs text-lantern-error mb-3" role="alert">{generateError}</p>
                ) : null}
                <Button onClick={() => void handleGenerate()} disabled={loading} className="w-full mb-2">
                  {activeText.trim() ? 'Generate my starter deck' : "Skip — I'll add cards later"}
                </Button>
                <button onClick={finish} className="w-full text-sm text-lantern-text-tertiary">Skip this step</button>
              </>
            )}
          </div>
        )}

        {step === 'done' && (
          <div className="p-8 text-center">
            <AcademicCapIcon className="w-12 h-12 text-lantern-primary mx-auto mb-4" />
            <h2 id="onboarding-title" className="text-xl font-bold mb-2 text-lantern-text">You&apos;re all set!</h2>
            <p className="text-lantern-text-secondary mb-4">
              {generated
                ? 'Your starter deck is ready. Open it in Learn mode and study your first cards.'
                : 'Open Learn mode to study, or start from the Study Hub whenever you are ready.'}
            </p>
            {onOpenLearnMode ? (
              <Button onClick={() => { onOpenLearnMode(); onSkip(); }} className="w-full mb-2">Open Learn mode</Button>
            ) : null}
            <Button variant={onOpenLearnMode ? 'secondary' : 'primary'} onClick={onSkip} className="w-full">Start studying</Button>
          </div>
        )}
      </div>
    </Modal>
  );
};

export default OnboardingFlow;
