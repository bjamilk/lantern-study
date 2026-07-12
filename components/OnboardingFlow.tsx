import React, { useState, useEffect } from 'react';
import { AcademicCapIcon, FireIcon, SparklesIcon, ArrowRightIcon } from '@heroicons/react/24/outline';
import { Button } from './ui';
import Modal from './ui/Modal';

export type OnboardingStep = 'welcome' | 'goal' | 'demo' | 'starter' | 'streak' | 'done';

interface OnboardingFlowProps {
  isOpen: boolean;
  onComplete: (data: { studyGoal: string; streakTarget: number }) => void;
  onSkip: () => void;
  onGenerateStarter?: (notes: string) => Promise<void>;
  onOpenLearnMode?: () => void;
  theme?: 'light' | 'dark';
}

const GOALS = [
  { id: 'exam', label: 'Ace an upcoming exam', icon: '📝' },
  { id: 'retention', label: 'Remember long-term', icon: '🧠' },
  { id: 'daily', label: 'Build a daily habit', icon: '🔥' },
];

const STREAK_TARGETS = [7, 14, 30];

const DEMO_SAMPLE_TEXT = `Photosynthesis converts light energy into chemical energy stored in glucose.

Key terms:
- Chlorophyll: green pigment that absorbs light
- Stroma: fluid inside the chloroplast where the Calvin cycle occurs
- Thylakoid: membrane structures where light-dependent reactions happen
- ATP and NADPH: energy carriers produced in the light reactions

The overall equation: 6CO₂ + 6H₂O + light → C₆H₁₂O₆ + 6O₂`;

const DEMO_STAGES = ['Extracting key concepts…', 'Building flashcards…', 'Creating practice questions…'];

export const OnboardingFlow: React.FC<OnboardingFlowProps> = ({
  isOpen,
  onComplete,
  onSkip,
  onGenerateStarter,
  onOpenLearnMode,
  theme = 'light',
}) => {
  const [step, setStep] = useState<OnboardingStep>('welcome');
  const [studyGoal, setStudyGoal] = useState('retention');
  const [starterNotes, setStarterNotes] = useState('');
  const [streakTarget, setStreakTarget] = useState(7);
  const [loading, setLoading] = useState(false);
  const [demoStage, setDemoStage] = useState(0);
  const [demoProcessing, setDemoProcessing] = useState(false);
  const isDark = theme === 'dark';

  useEffect(() => {
    if (!demoProcessing) return;
    if (demoStage >= DEMO_STAGES.length - 1) return;
    const t = setTimeout(() => setDemoStage((s) => s + 1), 900);
    return () => clearTimeout(t);
  }, [demoProcessing, demoStage]);

  if (!isOpen) return null;

  const handleFinish = () => {
    onComplete({ studyGoal, streakTarget });
    setStep('done');
  };

  const handleStarter = async () => {
    if (starterNotes.trim() && onGenerateStarter) {
      setLoading(true);
      try {
        await onGenerateStarter(starterNotes.trim());
      } finally {
        setLoading(false);
      }
    }
    setStep('streak');
  };

  const handleTryDemo = async () => {
    setDemoProcessing(true);
    setDemoStage(0);
    if (onGenerateStarter) {
      try {
        await onGenerateStarter(DEMO_SAMPLE_TEXT);
      } catch {
        // demo is best-effort
      }
    }
    await new Promise((r) => setTimeout(r, 2800));
    setDemoProcessing(false);
    setStep('streak');
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onSkip}
      ariaLabelledBy="onboarding-title"
      maxWidthClass="max-w-md"
      loading={loading || demoProcessing}
      closeOnBackdrop={!loading && !demoProcessing}
      zIndexClass="z-[60]"
      panelClassName="!p-0 rounded-2xl overflow-hidden"
    >
      <div className={`w-full ${isDark ? 'bg-lantern-surface' : 'bg-lantern-surface'}`}>
        {step === 'welcome' && (
          <div className="p-8 text-center">
            <div className="w-16 h-16 bg-lantern-primary-background dark:bg-lantern-primary-dark/40 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <SparklesIcon className="w-8 h-8 text-lantern-primary" />
            </div>
            <h2 className="text-2xl font-bold mb-2 text-lantern-text">Welcome to Lantern Study</h2>
            <p className="text-lantern-text-secondary mb-6">Flashcards, notes, tests, and AI — all in one place. Let's set you up in 60 seconds.</p>
            <Button onClick={() => setStep('goal')} className="w-full mb-2">
              Get started <ArrowRightIcon className="w-4 h-4 ml-1" />
            </Button>
            <button onClick={onSkip} className="text-sm text-lantern-text-tertiary hover:text-lantern-text-secondary">Skip for now</button>
          </div>
        )}

        {step === 'goal' && (
          <div className="p-6">
            <h2 className="text-xl font-bold mb-4 text-lantern-text">What's your main goal?</h2>
            <div className="space-y-2 mb-6">
              {GOALS.map((g) => (
                <button
                  key={g.id}
                  onClick={() => setStudyGoal(g.id)}
                  className={`w-full flex items-center gap-3 p-4 rounded-xl border-2 text-left transition-colors ${
                    studyGoal === g.id
                      ? 'border-lantern-primary bg-lantern-primary-background'
                      : 'border-lantern-border hover:border-lantern-primary/30'
                  }`}
                >
                  <span className="text-2xl">{g.icon}</span>
                  <span className="font-medium text-lantern-text">{g.label}</span>
                </button>
              ))}
            </div>
            <Button onClick={() => setStep('demo')} className="w-full">Continue</Button>
          </div>
        )}

        {step === 'demo' && (
          <div className="p-6">
            {demoProcessing ? (
              <div className="py-8 text-center">
                <div className="animate-spin w-10 h-10 border-4 border-lantern-primary border-t-transparent rounded-full mx-auto mb-4" />
                <p className="font-medium text-lantern-text">{DEMO_STAGES[demoStage]}</p>
                <p className="text-sm text-lantern-text-secondary mt-2">Turning sample notes into study materials…</p>
              </div>
            ) : (
              <>
                <h2 className="text-xl font-bold mb-2 text-lantern-text">See it in action</h2>
                <p className="text-sm text-lantern-text-secondary mb-4">
                  Try a sample biology note — we'll generate flashcards and quiz questions instantly.
                </p>
                <div className={`text-xs p-3 rounded-lg mb-4 max-h-32 overflow-y-auto ${isDark ? 'bg-lantern-surface-secondary text-lantern-text-tertiary' : 'bg-lantern-background text-lantern-text-secondary'}`}>
                  {DEMO_SAMPLE_TEXT.slice(0, 200)}…
                </div>
                <Button onClick={() => void handleTryDemo()} className="w-full mb-2">
                  Try sample demo
                </Button>
                <button onClick={() => setStep('starter')} className="w-full text-sm text-lantern-text-tertiary">Use my own notes instead</button>
              </>
            )}
          </div>
        )}

        {step === 'starter' && (
          <div className="p-6">
            <h2 className="text-xl font-bold mb-2 text-lantern-text">Paste something to study</h2>
            <p className="text-sm text-lantern-text-secondary mb-4">We'll generate your first flashcards automatically (optional).</p>
            <textarea
              value={starterNotes}
              onChange={(e) => setStarterNotes(e.target.value)}
              placeholder="Paste notes, a definition list, or any study material..."
              rows={5}
              className={`w-full px-3 py-2 rounded-lg border mb-4 text-sm ${isDark ? 'bg-lantern-surface-secondary border-lantern-border text-lantern-text' : 'bg-lantern-background border-lantern-border'}`}
            />
            <Button onClick={handleStarter} disabled={loading} className="w-full mb-2">
              {loading ? 'Generating...' : starterNotes.trim() ? 'Generate flashcards & continue' : "Skip — I'll add cards later"}
            </Button>
            <button onClick={() => setStep('streak')} className="w-full text-sm text-lantern-text-tertiary">Skip this step</button>
          </div>
        )}

        {step === 'streak' && (
          <div className="p-6">
            <div className="flex items-center gap-2 mb-4">
              <FireIcon className="w-6 h-6 text-orange-500" />
              <h2 className="text-xl font-bold text-lantern-text">Commit to a streak</h2>
            </div>
            <p className="text-sm text-lantern-text-secondary mb-4">Students with 7-day streaks are 3× more likely to keep studying.</p>
            <div className="flex gap-3 mb-6">
              {STREAK_TARGETS.map((t) => (
                <button
                  key={t}
                  onClick={() => setStreakTarget(t)}
                  className={`flex-1 py-4 rounded-xl border-2 font-bold text-lg transition-colors ${
                    streakTarget === t
                      ? 'border-orange-500 bg-orange-50 dark:bg-orange-900/20 text-orange-600'
                      : 'border-lantern-border text-lantern-text-secondary'
                  }`}
                >
                  {t} days
                </button>
              ))}
            </div>
            <Button onClick={handleFinish} className="w-full">
              <FireIcon className="w-4 h-4 mr-1" /> Start my {streakTarget}-day streak
            </Button>
          </div>
        )}

        {step === 'done' && (
          <div className="p-8 text-center">
            <AcademicCapIcon className="w-12 h-12 text-lantern-primary mx-auto mb-4" />
            <h2 className="text-xl font-bold mb-2">You're all set!</h2>
            <p className="text-lantern-text-secondary mb-4">Your {streakTarget}-day streak starts today. Open your first deck in Learn mode!</p>
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
