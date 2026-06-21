import React, { useState } from 'react';
import { completeSellerOnboarding } from '../../services/supabase';
import type { SellerOnboardingStatus } from '../../types';
import Button from '../ui/Button';
import { SparklesIcon, RocketLaunchIcon } from '@heroicons/react/24/outline';

interface SellerOnboardingWizardProps {
  status: SellerOnboardingStatus;
  onComplete: () => void;
  onDismiss?: () => void;
}

const SellerOnboardingWizard: React.FC<SellerOnboardingWizardProps> = ({
  status,
  onComplete,
  onDismiss,
}) => {
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const tips = status.tips?.length ? status.tips : [
    'Add clear photos — listings with 3+ images get more views.',
    'Set a campus meetup location buyers recognize.',
    'Enable offers so buyers can negotiate fairly.',
  ];

  const handleComplete = async () => {
    setSaving(true);
    setError('');
    try {
      await completeSellerOnboarding();
      onComplete();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to complete onboarding');
    } finally {
      setSaving(false);
    }
  };

  const isLastStep = step >= tips.length;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4">
      <div className="w-full sm:max-w-md bg-white dark:bg-slate-900 rounded-t-2xl sm:rounded-2xl border border-slate-200 dark:border-slate-700 shadow-xl">
        <div className="p-5 border-b border-slate-200 dark:border-slate-700">
          <div className="flex items-center gap-2">
            <RocketLaunchIcon className="w-6 h-6 text-indigo-600" />
            <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100">Seller setup</h2>
          </div>
          <p className="text-sm text-slate-500 mt-1">
            {status.listingCount === 0
              ? 'Welcome! A few tips before your first sale.'
              : 'Quick tips to grow your campus shop.'}
          </p>
        </div>

        <div className="p-5 space-y-4">
          {!isLastStep ? (
            <>
              <p className="text-xs font-semibold text-indigo-600 uppercase tracking-wide">
                Tip {step + 1} of {tips.length}
              </p>
              <p className="text-slate-700 dark:text-slate-200">{tips[step]}</p>
              <div className="flex gap-1">
                {tips.map((_, i) => (
                  <div
                    key={i}
                    className={`h-1 flex-1 rounded-full ${i <= step ? 'bg-indigo-500' : 'bg-slate-200 dark:bg-slate-700'}`}
                  />
                ))}
              </div>
            </>
          ) : (
            <div className="text-center space-y-3 py-2">
              <SparklesIcon className="w-10 h-10 mx-auto text-amber-500" />
              <p className="font-semibold text-slate-800 dark:text-slate-100">You&apos;re ready to sell</p>
              <p className="text-sm text-slate-500">
                Complete setup to unlock <strong>3 free boost credits</strong> for listing visibility.
              </p>
              <p className="text-xs text-slate-400">
                Current credits: {status.boostCredits}
              </p>
            </div>
          )}

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex gap-2 pt-1">
            {onDismiss && (
              <Button type="button" variant="ghost" size="sm" onClick={onDismiss}>
                Later
              </Button>
            )}
            {!isLastStep ? (
              <Button
                type="button"
                size="sm"
                className="flex-1"
                onClick={() => setStep((s) => s + 1)}
              >
                Next
              </Button>
            ) : (
              <Button
                type="button"
                size="sm"
                className="flex-1"
                disabled={saving}
                onClick={() => void handleComplete()}
              >
                {saving ? 'Saving…' : 'Complete & claim boosts'}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default SellerOnboardingWizard;
