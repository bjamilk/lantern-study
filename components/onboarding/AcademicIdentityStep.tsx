import React, { useEffect, useMemo, useState } from 'react';
import { AppIcon } from '../ui/AppIcon';
import { Button } from '../ui';
import { CampusSearchSelect } from '../marketplace/CampusSearchSelect';
import { fetchInstitutions, updateAcademicProfile } from '../../services/academic';
import { useAuthStore } from '../../stores/authStore';
import { clearAcademicSetupDismissed, studyLevelOptions, type InstitutionOption } from '../../utils/academicSetup';
import {
  PROGRAMME_MAX_LENGTH,
  buildOnboardingAcademicPatch,
  markOnboardingAcademicDone,
  validateOnboardingAcademic,
} from '../../utils/onboardingAcademic';

interface AcademicIdentityStepProps {
  /** Advance to the next onboarding step. Only called after a successful save. */
  onSaved: () => void;
  titleId: string;
}

/**
 * Onboarding step 2 — "Where do you study?".
 *
 * Institution and level are REQUIRED here (the same rule mobile's SignUpScreen
 * applies) because every compounding asset in the product — auto-communities,
 * course rows, campus counts, Discover — is fed by these two fields. There is
 * deliberately no skip.
 *
 * Saves through PUT /users/:id (services/academic.updateAcademicProfile), the
 * same endpoint mobile uses, so the server recomputes auto community
 * memberships and seeds the marketplace campus preference. A failed save keeps
 * the student on this step with the real error.
 */
export const AcademicIdentityStep: React.FC<AcademicIdentityStepProps> = ({ onSaved, titleId }) => {
  const currentUser = useAuthStore((s) => s.currentUser);
  const [institutions, setInstitutions] = useState<InstitutionOption[]>([]);
  const [institutionsLoading, setInstitutionsLoading] = useState(true);
  const [institutionsFailed, setInstitutionsFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [institutionId, setInstitutionId] = useState<string | null>(currentUser?.institutionId || null);
  const [programme, setProgramme] = useState(currentUser?.programme || '');
  const [studyLevel, setStudyLevel] = useState<number | null>(currentUser?.studyLevel ?? null);
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const levelOptions = useMemo(() => studyLevelOptions(), []);

  useEffect(() => {
    let cancelled = false;
    setInstitutionsLoading(true);
    setInstitutionsFailed(false);
    void fetchInstitutions('NG')
      .then((rows) => {
        if (cancelled) return;
        setInstitutions(rows);
        setInstitutionsFailed(rows.length === 0);
      })
      .catch(() => {
        if (cancelled) return;
        setInstitutions([]);
        setInstitutionsFailed(true);
      })
      .finally(() => {
        if (!cancelled) setInstitutionsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  // The campus list could not be loaded: requiring an institution would lock
  // the student out of their own account, so the requirement degrades and the
  // legacy nudge (utils/academicSetup) picks them up on the next boot.
  const institutionsUnavailable = !institutionsLoading && institutionsFailed;

  const input = { institutionId, studyLevel, programme, institutionsUnavailable };
  const errors = validateOnboardingAcademic(input);
  const showErrors = touched;

  const campusOptions = useMemo(
    () =>
      institutions.map((c) => ({
        id: c.id,
        name: c.name,
        city: c.city,
        state: c.state || '',
        slug: c.slug || '',
      })),
    [institutions]
  );

  const handleContinue = async () => {
    setTouched(true);
    setSaveError(null);
    if (Object.keys(errors).length > 0) return;
    if (!currentUser) {
      setSaveError('You are signed out. Sign in again to finish setting up your profile.');
      return;
    }

    const patch = buildOnboardingAcademicPatch(input);
    setSaving(true);
    try {
      const saved = await updateAcademicProfile(currentUser.id, patch);
      const store = useAuthStore.getState();
      const live = store.currentUser;
      if (live && live.id === currentUser.id) {
        const picked = patch.institutionId
          ? institutions.find((i) => i.id === patch.institutionId) || null
          : null;
        store.setCurrentUser({
          ...live,
          institutionId: saved.institutionId ?? patch.institutionId,
          institution:
            saved.institution ??
            (picked ? { id: picked.id, name: picked.name, slug: picked.slug || '' } : null),
          programme: saved.programme ?? patch.programme,
          studyLevel: saved.studyLevel ?? patch.studyLevel,
          ...(saved.faculty !== undefined ? { faculty: saved.faculty } : {}),
        });
      }
      if (patch.institutionId) {
        // Answered in full: retire the legacy nudge for good, and clear any
        // "Skip for now" left behind by the older profile-setup step.
        markOnboardingAcademicDone(currentUser.id);
        clearAcademicSetupDismissed(currentUser.id);
      }
      // Deliberately NOT marked on the campus-list-outage path: that student
      // still has no institution, so the dashboard banner stays available to
      // them as the fallback.
      onSaved();
    } catch (err) {
      console.error('Failed to save academic identity during onboarding:', err);
      const message = err instanceof Error && err.message ? err.message : '';
      setSaveError(
        message || 'Could not save your institution. Check your connection and try again.'
      );
    } finally {
      setSaving(false);
    }
  };

  const inputClass =
    'w-full min-h-[44px] px-3 py-2.5 border border-lantern-border rounded-lg bg-lantern-surface text-lantern-text placeholder:text-lantern-text-tertiary focus:outline-none focus:ring-2 focus:ring-lantern-primary text-sm';

  return (
    <div className="p-6">
      <div className="flex items-start gap-3 mb-4">
        <div className="w-10 h-10 shrink-0 bg-lantern-primary-background dark:bg-lantern-primary-dark/40 rounded-xl flex items-center justify-center">
          <AppIcon name="school" size={24} className="text-lantern-primary" aria-hidden />
        </div>
        <div className="min-w-0">
          <h2 id={titleId} className="text-xl font-bold text-lantern-text">
            Where do you study?
          </h2>
          <p className="text-sm text-lantern-text-secondary mt-0.5">
            Tell us where you study so Lantern can file your notes, decks and tests by course — and
            put you in your campus and course groups.
          </p>
        </div>
      </div>

      <div className="space-y-4">
        {/* The picker's control is a disclosure button, which <label for> cannot
            name — so the field is a labelled group instead. */}
        <div
          role="group"
          aria-labelledby="onboarding-institution-label"
          aria-describedby={
            showErrors && errors.institutionId && !institutionsUnavailable
              ? 'onboarding-institution-error'
              : undefined
          }
        >
          <span
            id="onboarding-institution-label"
            className="block text-sm font-medium text-lantern-text mb-1"
          >
            University / Polytechnic <span className="text-lantern-error" aria-hidden>*</span>
            <span className="sr-only"> (required)</span>
          </span>
          <CampusSearchSelect
            id="onboarding-institution"
            campuses={campusOptions}
            value={institutionId || ''}
            onChange={(campusId) => setInstitutionId(campusId)}
            emptyLabel={institutionsLoading ? 'Loading institutions…' : 'Choose your institution'}
            noneLabel="Clear selection"
            noMatchHint="No matches. Try the short form (e.g. “Unilag”, “ABU”) or your city."
          />
          {institutionsUnavailable ? (
            <div className="mt-2 flex flex-wrap items-center gap-2" role="alert">
              <p className="text-xs text-lantern-error">
                We couldn’t load the list of institutions.
              </p>
              <button
                type="button"
                onClick={() => setReloadKey((k) => k + 1)}
                className="text-xs font-semibold text-lantern-primary underline underline-offset-2"
              >
                Try again
              </button>
              <span className="text-xs text-lantern-text-secondary">
                You can continue and add your school later.
              </span>
            </div>
          ) : showErrors && errors.institutionId ? (
            <p id="onboarding-institution-error" className="mt-1 text-xs text-lantern-error" role="alert">
              {errors.institutionId}
            </p>
          ) : null}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label
              htmlFor="onboarding-level"
              className="block text-sm font-medium text-lantern-text mb-1"
            >
              Level <span className="text-lantern-error" aria-hidden>*</span>
              <span className="sr-only"> (required)</span>
            </label>
            <select
              id="onboarding-level"
              value={studyLevel ?? ''}
              onChange={(e) => setStudyLevel(e.target.value ? Number(e.target.value) : null)}
              aria-invalid={showErrors && !!errors.studyLevel}
              aria-describedby={showErrors && errors.studyLevel ? 'onboarding-level-error' : undefined}
              className={inputClass}
            >
              <option value="">Select level</option>
              {levelOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            {showErrors && errors.studyLevel ? (
              <p id="onboarding-level-error" className="mt-1 text-xs text-lantern-error" role="alert">
                {errors.studyLevel}
              </p>
            ) : null}
          </div>
          <div>
            <label
              htmlFor="onboarding-programme"
              className="block text-sm font-medium text-lantern-text mb-1"
            >
              Programme <span className="text-lantern-text-tertiary font-normal">(optional)</span>
            </label>
            <input
              id="onboarding-programme"
              type="text"
              value={programme}
              onChange={(e) => setProgramme(e.target.value)}
              placeholder="e.g. Biochemistry"
              maxLength={PROGRAMME_MAX_LENGTH}
              className={inputClass}
            />
          </div>
        </div>

        {saveError ? (
          <div
            className="flex items-start gap-2 text-sm text-lantern-error bg-lantern-error/10 p-3 rounded-lg"
            role="alert"
          >
            <AppIcon name="alert-circle" size={20} className="shrink-0" aria-hidden />
            <span className="min-w-0">{saveError}</span>
          </div>
        ) : null}

        <Button onClick={() => void handleContinue()} loading={saving} className="w-full">
          {saving ? 'Saving…' : 'Save and continue'}
        </Button>
        <p className="text-xs text-lantern-text-tertiary text-center">
          You can change this any time in Settings.
        </p>
      </div>
    </div>
  );
};

export default AcademicIdentityStep;
