import React, { useState } from 'react';
import { completeSellerOnboarding } from '../../services/supabase';
import type { SellerOnboardingStatus } from '../../types';
import Button from '../ui/Button';
import { SparklesIcon, RocketLaunchIcon } from '@heroicons/react/24/outline';
import Modal from '../ui/Modal';

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
    'Add clear pickup or delivery details buyers recognize.',
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
    <Modal
      isOpen
      onClose={onDismiss ?? (() => {})}
      ariaLabelledBy="seller-onboarding-title"
      maxWidthClass="max-w-md"
      loading={saving}
      closeOnBackdrop={Boolean(onDismiss) && !saving}
      alignClass="items-end sm:items-center justify-center"
      paddingClass="p-0 sm:p-4"
      panelClassName="!p-0 rounded-t-2xl sm:rounded-2xl border border-lantern-border"
    >
        <div className="p-5 border-b border-lantern-border">
          <div className="flex items-center gap-2">
            <RocketLaunchIcon className="w-6 h-6 text-lantern-primary" aria-hidden />
            <h2 id="seller-onboarding-title" className="text-lg font-bold text-lantern-text">Seller setup</h2>
          </div>
          <p className="text-sm text-lantern-text-muted mt-1">
            {status.listingCount === 0
              ? 'Welcome! A few tips before your first sale.'
              : 'Quick tips to grow your shop across Nigeria.'}
          </p>
        </div>

        <div className="p-5 space-y-4">
          {!isLastStep ? (
            <>
              <p className="text-xs font-semibold text-lantern-primary uppercase tracking-wide">
                Tip {step + 1} of {tips.length}
              </p>
              <p className="text-lantern-text">{tips[step]}</p>
              <div className="flex gap-1" role="progressbar" aria-valuenow={step + 1} aria-valuemin={1} aria-valuemax={tips.length}>
                {tips.map((_, i) => (
                  <div
                    key={i}
                    className={`h-1 flex-1 rounded-full ${i <= step ? 'bg-lantern-primary' : 'bg-lantern-border'}`}
                  />
                ))}
              </div>
            </>
          ) : (
            <div className="text-center space-y-3 py-2">
              <SparklesIcon className="w-10 h-10 mx-auto text-amber-500" aria-hidden />
              <p className="font-semibold text-lantern-text">You&apos;re ready to sell</p>
              <p className="text-sm text-lantern-text-muted">
                Complete setup to unlock <strong>3 free boost credits</strong> for listing visibility.
              </p>
              <p className="text-xs text-lantern-text-muted">
                Current credits: {status.boostCredits}
              </p>
            </div>
          )}

          {error && <p className="text-sm text-lantern-error">{error}</p>}

          <div className="flex gap-2 pt-1">
            {onDismiss && (
              <Button type="button" variant="ghost" size="sm" onClick={onDismiss} disabled={saving}>
                Later
              </Button>
            )}
            {!isLastStep ? (
              <Button
                type="button"
                size="sm"
                className="flex-1 min-h-[44px]"
                onClick={() => setStep((s) => s + 1)}
              >
                Next
              </Button>
            ) : (
              <Button
                type="button"
                size="sm"
                className="flex-1 min-h-[44px]"
                disabled={saving}
                onClick={() => void handleComplete()}
              >
                {saving ? 'Saving…' : 'Complete & claim boosts'}
              </Button>
            )}
          </div>
        </div>
    </Modal>
  );
};

export default SellerOnboardingWizard;
