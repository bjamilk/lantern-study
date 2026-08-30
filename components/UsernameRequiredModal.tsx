import React, { useState, useEffect, useMemo } from 'react';
import { semesterOptions } from '@lantern/shared/academic';
import { CheckCircleIcon, ExclamationCircleIcon, UserIcon } from '@heroicons/react/24/outline';
import { checkUsernameAvailability, updateUsername } from '../services/supabase';
import { fetchInstitutions, updateAcademicProfile } from '../services/academic';
import { useAcademicStore } from '../stores/academicStore';
import type { Course, User } from '../types';
import Modal from './ui/Modal';
import { CampusSearchSelect } from './marketplace/CampusSearchSelect';
import { CourseMultiSelect } from './academic/CourseMultiSelect';
import {
  USERNAME_RE,
  markAcademicSetupDismissed,
  clearAcademicSetupDismissed,
  studyLevelOptions,
  validateProfileSetup,
  type InstitutionOption,
} from '../utils/academicSetup';

interface UsernameRequiredModalProps {
  isOpen: boolean;
  currentUser: User;
  onClose: () => void;
  /** Fires with the fields that changed (username/name + academic identity). */
  onSuccess: (updates: Partial<User>) => void;
}

/**
 * "Set up your profile" — Phase 1 onboarding step (contract §4). Collects the
 * username (when missing) plus institution / programme / level / courses.
 * Opened by hooks/useAppEffects.ts when the username or institution is missing.
 */
const UsernameRequiredModal: React.FC<UsernameRequiredModalProps> = ({
  isOpen,
  currentUser,
  onClose,
  onSuccess,
}) => {
  const hasUsername = Boolean(currentUser.username);
  const [username, setUsername] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [usernameError, setUsernameError] = useState('');
  const [usernameAvailable, setUsernameAvailable] = useState<boolean | null>(null);
  const [checkingUsername, setCheckingUsername] = useState(false);
  const [institutionId, setInstitutionId] = useState<string | null>(null);
  const [programme, setProgramme] = useState('');
  const [studyLevel, setStudyLevel] = useState<number | null>(null);
  const [currentSemester, setCurrentSemester] = useState<1 | 2 | null>(null);
  const [courses, setCourses] = useState<Course[]>([]);
  const [institutions, setInstitutions] = useState<InstitutionOption[]>([]);
  const [institutionsLoading, setInstitutionsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [touched, setTouched] = useState(false);

  const levelOptions = useMemo(() => studyLevelOptions(), []);

  // Prefill from the current profile every time the step opens.
  useEffect(() => {
    if (!isOpen) return;
    setUsername(currentUser.username || '');
    const currentName = currentUser.name || '';
    if (currentUser.firstName || currentUser.lastName) {
      setFirstName(currentUser.firstName || '');
      setLastName(currentUser.lastName || '');
    } else if (currentName) {
      const parts = currentName.trim().split(' ');
      setFirstName(parts[0] || '');
      setLastName(parts.length >= 2 ? parts.slice(1).join(' ') : '');
    }
    setInstitutionId(currentUser.institutionId || null);
    setProgramme(currentUser.programme || '');
    setStudyLevel(currentUser.studyLevel ?? null);
    setCurrentSemester(currentUser.currentSemester ?? null);
    setError('');
    setTouched(false);
    setUsernameError('');
    setUsernameAvailable(null);
  }, [isOpen, currentUser.id]);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setInstitutionsLoading(true);
    void fetchInstitutions('NG')
      .then((rows) => {
        if (!cancelled) setInstitutions(rows);
      })
      .catch(() => {
        if (!cancelled) setInstitutions([]);
      })
      .finally(() => {
        if (!cancelled) setInstitutionsLoading(false);
      });
    // Pre-seed the course chips with the enrolments already on file.
    void useAcademicStore
      .getState()
      .loadMyCourses()
      .then((rows) => {
        if (cancelled) return;
        const active = rows.filter((uc) => uc.status === 'active' && uc.course).map((uc) => uc.course);
        if (active.length) setCourses(active);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  // Username availability probe (only while the username is editable).
  useEffect(() => {
    if (hasUsername || !username) return;

    const normalizedUsername = username.toLowerCase().trim();

    if (!USERNAME_RE.test(normalizedUsername)) {
      setUsernameError('3-20 characters: letters, numbers, underscore only');
      setUsernameAvailable(null);
      return;
    }

    setUsernameError('');
    setCheckingUsername(true);
    let cancelled = false;

    const timeoutId = setTimeout(async () => {
      try {
        const available = await Promise.race([
          checkUsernameAvailability(normalizedUsername),
          new Promise<boolean>((_, reject) =>
            setTimeout(() => reject(new Error('Username availability check timed out')), 8000)
          ),
        ]);
        if (cancelled) return;
        setUsernameAvailable(available);
        if (!available) {
          setUsernameError('Username is already taken');
        }
      } catch (err) {
        console.error('Username check failed:', err);
        // Don't hard-block Save if the availability probe fails; server still validates.
        if (!cancelled) setUsernameAvailable(null);
      } finally {
        if (!cancelled) setCheckingUsername(false);
      }
    }, 500);

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, [username, hasUsername]);

  const fieldErrors = useMemo(
    () =>
      validateProfileSetup({
        username: hasUsername ? currentUser.username || '' : username,
        institutionId,
        studyLevel,
        usernameAvailable: hasUsername ? null : usernameAvailable,
      }),
    [hasUsername, currentUser.username, username, institutionId, studyLevel, usernameAvailable]
  );
  const isValid = Object.keys(fieldErrors).length === 0;

  const handleSkip = () => {
    markAcademicSetupDismissed(currentUser.id);
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setTouched(true);
    if (!isValid) {
      setError(fieldErrors.username || fieldErrors.institutionId || fieldErrors.studyLevel || 'Please complete the required fields.');
      return;
    }

    const normalizedUsername = (hasUsername ? currentUser.username || '' : username).toLowerCase().trim();
    const trimmedFirst = firstName.trim();
    const trimmedLast = lastName.trim();
    const trimmedProgramme = programme.trim();

    setIsSubmitting(true);
    try {
      const updates: Partial<User> = {};

      // 1. Username (existing path) — only when it is new or the name changed.
      const nameChanged =
        trimmedFirst !== (currentUser.firstName || '') || trimmedLast !== (currentUser.lastName || '');
      if (!hasUsername || nameChanged) {
        await updateUsername(currentUser.id, normalizedUsername, trimmedFirst, trimmedLast);
        updates.username = normalizedUsername;
        if (trimmedFirst) updates.firstName = trimmedFirst;
        if (trimmedLast) updates.lastName = trimmedLast;
      }

      // 2. Academic identity via PUT /users/:id.
      const saved = await updateAcademicProfile(currentUser.id, {
        institutionId,
        programme: trimmedProgramme || null,
        studyLevel,
        currentSemester,
      });
      updates.institutionId = saved.institutionId ?? institutionId;
      updates.institution =
        saved.institution ??
        (institutionId
          ? (() => {
              const hit = institutions.find((i) => i.id === institutionId);
              return hit ? { id: hit.id, name: hit.name, slug: hit.slug || '' } : null;
            })()
          : null);
      updates.programme = saved.programme ?? (trimmedProgramme || null);
      updates.studyLevel = saved.studyLevel ?? studyLevel;
      updates.currentSemester = saved.currentSemester ?? currentSemester;
      if (saved.faculty !== undefined) updates.faculty = saved.faculty;

      // 3. Courses via PUT /users/me/courses (only when the user picked some —
      //    an empty list would wipe enrolments made elsewhere).
      if (courses.length > 0) {
        await useAcademicStore.getState().replaceMyCourses(courses.map((c) => c.id));
      }

      // Saving with an institution fully clears the nudge. Saving WITHOUT one
      // ("My institution isn't listed") is an explicit choice to continue — mark
      // it dismissed so shouldOpenAcademicSetup (institutionId === null) doesn't
      // immediately re-open this step in a loop.
      if (updates.institutionId) {
        clearAcademicSetupDismissed(currentUser.id);
      } else {
        markAcademicSetupDismissed(currentUser.id);
      }
      onSuccess(updates);
    } catch (err: unknown) {
      console.error('Failed to save profile setup:', err);
      const message = err instanceof Error ? err.message : '';
      if (message.includes('already taken') || message.includes('23505')) {
        setError('This username is already taken. Please choose another.');
      } else {
        setError(message || 'Failed to save your profile. Please try again.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const inputClass =
    'w-full min-h-[44px] px-3 py-2.5 border border-lantern-border rounded-lg bg-lantern-surface text-lantern-text placeholder:text-lantern-text-tertiary focus:outline-none focus:ring-2 focus:ring-lantern-primary text-sm';

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      ariaLabelledBy="username-required-title"
      maxWidthClass="max-w-lg"
      loading={isSubmitting}
      closeOnBackdrop={!isSubmitting}
      panelClassName="!p-0 overflow-hidden"
    >
      <div className="bg-lantern-primary-background px-6 py-4 border-b border-lantern-border">
        <h2 id="username-required-title" className="text-xl font-bold text-lantern-text">
          Set up your profile
        </h2>
        <p className="text-sm text-lantern-text-secondary mt-1">
          Tell us where you study so Lantern can file your notes, decks and tests by course.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="p-6 space-y-5 bg-lantern-surface" noValidate>
        <div className="flex gap-2 sm:gap-4 min-w-0">
          <div className="w-1/2 min-w-0">
            <label htmlFor="modalFirstName" className="block text-sm font-medium text-lantern-text mb-1">
              First name <span className="text-lantern-text-tertiary font-normal">(optional)</span>
            </label>
            <div className="relative min-w-0">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <UserIcon className="h-5 w-5 text-lantern-text-muted" aria-hidden />
              </div>
              <input
                id="modalFirstName"
                type="text"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                title={firstName}
                className={`${inputClass} pl-10`}
                placeholder="First"
                autoComplete="given-name"
              />
            </div>
          </div>
          <div className="w-1/2 min-w-0">
            <label htmlFor="modalLastName" className="block text-sm font-medium text-lantern-text mb-1">
              Last name <span className="text-lantern-text-tertiary font-normal">(optional)</span>
            </label>
            <div className="relative min-w-0">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <UserIcon className="h-5 w-5 text-lantern-text-muted" aria-hidden />
              </div>
              <input
                id="modalLastName"
                type="text"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                title={lastName}
                className={`${inputClass} pl-10`}
                placeholder="Last"
                autoComplete="family-name"
              />
            </div>
          </div>
        </div>

        <div>
          <label htmlFor="modalUsername" className="block text-sm font-medium text-lantern-text mb-1">
            Username <span className="text-lantern-error">*</span>
          </label>
          <div className="relative">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <span className="text-lantern-text-muted font-medium">@</span>
            </div>
            <input
              id="modalUsername"
              type="text"
              value={username}
              readOnly={hasUsername}
              onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
              className={`w-full min-h-[44px] pl-8 pr-10 py-2.5 border rounded-lg bg-lantern-surface text-lantern-text placeholder:text-lantern-text-tertiary focus:outline-none focus:ring-2 ${
                hasUsername
                  ? 'border-lantern-border text-lantern-text-secondary cursor-default focus:ring-lantern-border'
                  : usernameError
                    ? 'border-lantern-error focus:ring-lantern-error'
                    : usernameAvailable === true
                      ? 'border-lantern-success focus:ring-lantern-success'
                      : 'border-lantern-border focus:ring-lantern-primary'
              }`}
              placeholder="your_username"
              maxLength={20}
              autoComplete="username"
            />
            <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
              {!hasUsername && checkingUsername && (
                <svg className="animate-spin h-5 w-5 text-lantern-text-muted" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" aria-hidden>
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
              )}
              {!hasUsername && !checkingUsername && usernameAvailable === true && (
                <CheckCircleIcon className="h-5 w-5 text-lantern-success" aria-hidden />
              )}
              {!hasUsername && !checkingUsername && usernameError && (
                <ExclamationCircleIcon className="h-5 w-5 text-lantern-error" aria-hidden />
              )}
            </div>
          </div>
          {!hasUsername && usernameError && <p className="mt-1 text-xs text-lantern-error">{usernameError}</p>}
          {!hasUsername && !usernameError && username && usernameAvailable === true && (
            <p className="mt-1 text-xs text-lantern-success">@{username} is available!</p>
          )}
          <p className="mt-1 text-xs text-lantern-text-muted">
            {hasUsername
              ? 'Your username is set. Friends find you as @' + currentUser.username + '.'
              : '3-20 characters: lowercase letters, numbers, and underscores only'}
          </p>
        </div>

        <div>
          <label htmlFor="profile-setup-institution" className="block text-sm font-medium text-lantern-text mb-1">
            University / Polytechnic <span className="text-lantern-text-tertiary font-normal">(optional)</span>
          </label>
          <CampusSearchSelect
            id="profile-setup-institution"
            campuses={institutions.map((c) => ({
              id: c.id,
              name: c.name,
              city: c.city,
              state: c.state || '',
              slug: c.slug || '',
            }))}
            value={institutionId || ''}
            onChange={(campusId) => setInstitutionId(campusId)}
            emptyLabel={institutionsLoading ? 'Loading institutions…' : 'Choose your institution'}
            noneLabel="My institution isn't listed"
            noMatchHint={'Can’t find your school? Pick “My institution isn’t listed” above and add your programme below — you can set your school later in Settings.'}
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label htmlFor="profile-setup-programme" className="block text-sm font-medium text-lantern-text mb-1">
              Programme <span className="text-lantern-text-tertiary font-normal">(optional)</span>
            </label>
            <input
              id="profile-setup-programme"
              type="text"
              value={programme}
              onChange={(e) => setProgramme(e.target.value)}
              placeholder="e.g. Biochemistry"
              className={inputClass}
              maxLength={120}
            />
          </div>
          <div>
            <label htmlFor="profile-setup-level" className="block text-sm font-medium text-lantern-text mb-1">
              Level <span className="text-lantern-error">*</span>
            </label>
            <select
              id="profile-setup-level"
              value={studyLevel ?? ''}
              onChange={(e) => setStudyLevel(e.target.value ? Number(e.target.value) : null)}
              className={inputClass}
            >
              <option value="">Select level</option>
              {levelOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            {touched && fieldErrors.studyLevel ? (
              <p className="mt-1 text-xs text-lantern-error">{fieldErrors.studyLevel}</p>
            ) : null}
          </div>
          <div>
            <label htmlFor="profile-setup-semester" className="block text-sm font-medium text-lantern-text mb-1">
              Semester
            </label>
            <select
              id="profile-setup-semester"
              value={currentSemester ?? ''}
              onChange={(e) =>
                setCurrentSemester(e.target.value ? (Number(e.target.value) as 1 | 2) : null)
              }
              className={inputClass}
            >
              <option value="">Not set</option>
              {semesterOptions().map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <CourseMultiSelect
          id="profile-setup-courses"
          label={
            <>
              Your courses this semester <span className="text-lantern-text-tertiary font-normal">(optional)</span>
            </>
          }
          value={courses}
          onChange={setCourses}
          institutionId={institutionId}
          hint="Search by code (BIO 201) or title. Can’t find one? Type the code and add it."
        />

        {error && (
          <div className="flex items-center text-sm text-lantern-error bg-lantern-error/10 p-3 rounded-lg" role="alert">
            <ExclamationCircleIcon className="w-5 h-5 mr-2 flex-shrink-0" aria-hidden />
            {error}
          </div>
        )}

        <div className="space-y-2">
          <button
            type="submit"
            disabled={isSubmitting || (!hasUsername && (usernameAvailable === false || !username.trim()))}
            className="w-full min-h-[44px] flex justify-center py-3 px-4 text-sm font-semibold rounded-lg text-white bg-lantern-primary hover:bg-lantern-primary-dark focus:outline-none focus:ring-2 focus:ring-lantern-primary transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting ? (
              <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" aria-hidden>
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
            ) : (
              'Save & Continue'
            )}
          </button>
          <button
            type="button"
            onClick={handleSkip}
            disabled={isSubmitting}
            className="w-full min-h-[44px] text-sm text-lantern-text-tertiary hover:text-lantern-text-secondary disabled:opacity-50"
          >
            Skip for now
          </button>
        </div>
      </form>
    </Modal>
  );
};

export default UsernameRequiredModal;
