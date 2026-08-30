import React, { useEffect, useMemo, useState } from 'react';
import { semesterOptions } from '@lantern/shared/academic';
import { ArchiveBoxIcon, TrashIcon } from '@heroicons/react/24/outline';
import { currentAcademicYear } from '@lantern/shared';
import type { Course, User, UserCourse } from '../../types';
import { useAuthStore } from '../../stores/authStore';
import { useAcademicStore } from '../../stores/academicStore';
import { useToastStore } from '../../stores/toastStore';
import { confirmDialog } from '../../stores/confirmStore';
import { fetchInstitutions, updateAcademicProfile } from '../../services/academic';
import { CampusSearchSelect } from '../marketplace/CampusSearchSelect';
import { CourseMultiSelect } from '../academic/CourseMultiSelect';
import { Button } from '../ui';
import {
  activeUserCourses,
  clearAcademicSetupDismissed,
  courseLabel,
  studyLevelOptions,
  type InstitutionOption,
} from '../../utils/academicSetup';

interface AcademicSettingsSectionProps {
  currentUser: User;
  isOpen: boolean;
}

const inputClass =
  'mt-1 w-full p-2 border border-lantern-border rounded-md bg-lantern-surface dark:bg-lantern-surface-secondary text-lantern-text';

const YEAR_MIN = 1990;
const YEAR_MAX = 2100;

function parseYear(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  if (!Number.isInteger(n) || n < YEAR_MIN || n > YEAR_MAX) return NaN;
  return n;
}

/**
 * Settings → Academic (Phase 1 contract §4): institution, programme, level,
 * entry / expected graduation year, plus "My courses" (add, remove, exam
 * date) and "Archive this semester".
 */
export const AcademicSettingsSection: React.FC<AcademicSettingsSectionProps> = ({ currentUser, isOpen }) => {
  const { showToast } = useToastStore();
  const setCurrentUser = useAuthStore((s) => s.setCurrentUser);
  const myCourses = useAcademicStore((s) => s.myCourses);
  const coursesLoaded = useAcademicStore((s) => s.loaded);
  const coursesLoading = useAcademicStore((s) => s.loading);
  const loadMyCourses = useAcademicStore((s) => s.loadMyCourses);
  const addMyCourse = useAcademicStore((s) => s.addMyCourse);
  const removeMyCourse = useAcademicStore((s) => s.removeMyCourse);
  const updateMyCourse = useAcademicStore((s) => s.updateMyCourse);
  const archiveSemesterAction = useAcademicStore((s) => s.archiveSemester);

  const [institutions, setInstitutions] = useState<InstitutionOption[]>([]);
  const [institutionId, setInstitutionId] = useState<string | null>(currentUser.institutionId ?? null);
  const [programme, setProgramme] = useState(currentUser.programme ?? '');
  const [studyLevel, setStudyLevel] = useState<number | null>(currentUser.studyLevel ?? null);
  const [currentSemester, setCurrentSemester] = useState<1 | 2 | null>(
    currentUser.currentSemester ?? null
  );
  const [entryYear, setEntryYear] = useState(currentUser.entryYear != null ? String(currentUser.entryYear) : '');
  const [gradYear, setGradYear] = useState(
    currentUser.expectedGraduationYear != null ? String(currentUser.expectedGraduationYear) : ''
  );
  const [saving, setSaving] = useState(false);
  const [addSelection, setAddSelection] = useState<Course[]>([]);
  const [addingCourses, setAddingCourses] = useState(false);
  const [busyCourseId, setBusyCourseId] = useState<string | null>(null);
  const [archiving, setArchiving] = useState(false);

  const levelOptions = useMemo(() => studyLevelOptions(), []);
  const academicYear = currentAcademicYear();
  const activeCourses = useMemo(() => activeUserCourses(myCourses), [myCourses]);
  const archivedCount = myCourses.length - activeCourses.length;

  // Re-sync the draft whenever the dialog (re)opens or the profile changes underneath.
  useEffect(() => {
    if (!isOpen) return;
    setInstitutionId(currentUser.institutionId ?? null);
    setProgramme(currentUser.programme ?? '');
    setStudyLevel(currentUser.studyLevel ?? null);
    setCurrentSemester(currentUser.currentSemester ?? null);
    setEntryYear(currentUser.entryYear != null ? String(currentUser.entryYear) : '');
    setGradYear(currentUser.expectedGraduationYear != null ? String(currentUser.expectedGraduationYear) : '');
  }, [
    isOpen,
    currentUser.id,
    currentUser.institutionId,
    currentUser.programme,
    currentUser.studyLevel,
    currentUser.currentSemester,
    currentUser.entryYear,
    currentUser.expectedGraduationYear,
  ]);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    void fetchInstitutions('NG')
      .then((rows) => {
        if (!cancelled) setInstitutions(rows);
      })
      .catch(() => {
        if (!cancelled) setInstitutions([]);
      });
    if (!coursesLoaded) void loadMyCourses();
    return () => {
      cancelled = true;
    };
  }, [isOpen, coursesLoaded, loadMyCourses]);

  const isDirty =
    (institutionId ?? null) !== (currentUser.institutionId ?? null) ||
    programme.trim() !== (currentUser.programme ?? '') ||
    (studyLevel ?? null) !== (currentUser.studyLevel ?? null) ||
    (currentSemester ?? null) !== (currentUser.currentSemester ?? null) ||
    entryYear.trim() !== (currentUser.entryYear != null ? String(currentUser.entryYear) : '') ||
    gradYear.trim() !== (currentUser.expectedGraduationYear != null ? String(currentUser.expectedGraduationYear) : '');

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsedEntry = parseYear(entryYear);
    const parsedGrad = parseYear(gradYear);
    if (Number.isNaN(parsedEntry) || Number.isNaN(parsedGrad)) {
      showToast(`Years must be between ${YEAR_MIN} and ${YEAR_MAX}.`, 'error');
      return;
    }
    if (parsedEntry != null && parsedGrad != null && parsedGrad < parsedEntry) {
      showToast('Expected graduation year cannot be before your entry year.', 'error');
      return;
    }
    setSaving(true);
    try {
      const saved = await updateAcademicProfile(currentUser.id, {
        institutionId,
        programme: programme.trim() || null,
        studyLevel,
        currentSemester,
        entryYear: parsedEntry,
        expectedGraduationYear: parsedGrad,
      });
      const latest = useAuthStore.getState().currentUser;
      if (latest && latest.id === currentUser.id) {
        const fallbackInstitution = institutionId
          ? (() => {
              const hit = institutions.find((i) => i.id === institutionId);
              return hit ? { id: hit.id, name: hit.name, slug: hit.slug || '' } : null;
            })()
          : null;
        setCurrentUser({
          ...latest,
          institutionId: saved.institutionId ?? institutionId,
          institution: saved.institution ?? fallbackInstitution,
          faculty: saved.faculty ?? latest.faculty ?? null,
          programme: saved.programme ?? (programme.trim() || null),
          studyLevel: saved.studyLevel ?? studyLevel,
          currentSemester: saved.currentSemester ?? currentSemester,
          entryYear: saved.entryYear ?? parsedEntry,
          expectedGraduationYear: saved.expectedGraduationYear ?? parsedGrad,
        });
      }
      if (institutionId) clearAcademicSetupDismissed(currentUser.id);
      showToast('Academic profile updated.', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not save your academic profile.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleAddCourses = async () => {
    if (addSelection.length === 0) return;
    setAddingCourses(true);
    try {
      for (const course of addSelection) {
        await addMyCourse(course.id, academicYear);
      }
      setAddSelection([]);
      showToast(addSelection.length === 1 ? 'Course added.' : `${addSelection.length} courses added.`, 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not add that course.', 'error');
    } finally {
      setAddingCourses(false);
    }
  };

  const handleRemove = async (uc: UserCourse) => {
    const ok = await confirmDialog({
      title: 'Remove course?',
      message: `Remove ${uc.course.code} from your ${uc.academicYear} courses? Notes, decks and tests filed under it are kept.`,
      confirmLabel: 'Remove',
      danger: true,
    });
    if (!ok) return;
    setBusyCourseId(uc.course.id);
    try {
      await removeMyCourse(uc.course.id, uc.academicYear);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not remove that course.', 'error');
    } finally {
      setBusyCourseId(null);
    }
  };

  const handleExamDate = async (uc: UserCourse, value: string) => {
    const next = value || null;
    if ((uc.examDate || null) === next) return;
    setBusyCourseId(uc.course.id);
    try {
      await updateMyCourse(uc.course.id, { examDate: next, academicYear: uc.academicYear });
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not save the exam date.', 'error');
    } finally {
      setBusyCourseId(null);
    }
  };

  const handleArchiveSemester = async () => {
    const ok = await confirmDialog({
      title: 'Archive this semester?',
      message: `Every course in ${academicYear} moves to your archive. Nothing is deleted — notes, decks and tests stay filed under each course and you can still open them from the Library.`,
      confirmLabel: 'Archive semester',
      danger: true,
    });
    if (!ok) return;
    setArchiving(true);
    try {
      const archived = await archiveSemesterAction(academicYear);
      showToast(archived > 0 ? `Archived ${archived} course${archived === 1 ? '' : 's'}.` : 'Nothing to archive for this year.', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not archive the semester.', 'error');
    } finally {
      setArchiving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-lantern-text">Academic</h3>
        <p className="text-sm text-lantern-text-secondary">
          Where you study and what you&apos;re taking. Lantern files your notes, decks and tests by course.
        </p>
      </div>

      <form onSubmit={handleSaveProfile} className="space-y-4">
        <div>
          <label htmlFor="academic-institution" className="block text-sm font-medium text-lantern-text mb-1">
            University / Polytechnic
          </label>
          <CampusSearchSelect
            id="academic-institution"
            campuses={institutions.map((c) => ({
              id: c.id,
              name: c.name,
              city: c.city,
              state: c.state || '',
              slug: c.slug || '',
            }))}
            value={institutionId || ''}
            onChange={(campusId) => setInstitutionId(campusId)}
            emptyLabel="Choose your institution"
          />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="academic-programme" className="block text-sm font-medium text-lantern-text">Programme</label>
            <input
              id="academic-programme"
              type="text"
              value={programme}
              onChange={(e) => setProgramme(e.target.value)}
              placeholder="e.g. Biochemistry"
              maxLength={120}
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="academic-level" className="block text-sm font-medium text-lantern-text">Level</label>
            <select
              id="academic-level"
              value={studyLevel ?? ''}
              onChange={(e) => setStudyLevel(e.target.value ? Number(e.target.value) : null)}
              className={inputClass}
            >
              <option value="">Not set</option>
              {levelOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="academic-semester" className="block text-sm font-medium text-lantern-text">Semester</label>
            <select
              id="academic-semester"
              value={currentSemester ?? ''}
              onChange={(e) =>
                setCurrentSemester(e.target.value ? (Number(e.target.value) as 1 | 2) : null)
              }
              className={inputClass}
            >
              <option value="">Not set</option>
              {semesterOptions().map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="academic-entry-year" className="block text-sm font-medium text-lantern-text">Entry year</label>
            <input
              id="academic-entry-year"
              type="number"
              inputMode="numeric"
              min={YEAR_MIN}
              max={YEAR_MAX}
              value={entryYear}
              onChange={(e) => setEntryYear(e.target.value)}
              placeholder="e.g. 2024"
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="academic-grad-year" className="block text-sm font-medium text-lantern-text">Expected graduation year</label>
            <input
              id="academic-grad-year"
              type="number"
              inputMode="numeric"
              min={YEAR_MIN}
              max={YEAR_MAX}
              value={gradYear}
              onChange={(e) => setGradYear(e.target.value)}
              placeholder="e.g. 2028"
              className={inputClass}
            />
          </div>
        </div>
        {isDirty ? (
          <Button type="submit" disabled={saving} className="w-full">
            {saving ? 'Saving…' : 'Save changes'}
          </Button>
        ) : null}
      </form>

      <div className="border-t border-lantern-border pt-6 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-lantern-text">My courses</h3>
            <p className="text-sm text-lantern-text-secondary">
              {academicYear} session · {activeCourses.length} active{archivedCount > 0 ? ` · ${archivedCount} archived` : ''}
            </p>
          </div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => void handleArchiveSemester()}
            disabled={archiving || activeCourses.length === 0}
            title="Move every course of this year to the archive"
          >
            <ArchiveBoxIcon className="w-4 h-4" aria-hidden />
            {archiving ? 'Archiving…' : 'Archive this semester'}
          </Button>
        </div>

        {coursesLoading && !coursesLoaded ? (
          <p className="text-sm text-lantern-text-secondary">Loading your courses…</p>
        ) : activeCourses.length === 0 ? (
          <p className="text-sm text-lantern-text-secondary rounded-lg border border-dashed border-lantern-border p-3">
            No courses yet. Add the ones you&apos;re taking this semester below.
          </p>
        ) : (
          <ul className="divide-y divide-lantern-border rounded-lg border border-lantern-border overflow-hidden">
            {activeCourses.map((uc) => (
              <li key={`${uc.course.id}-${uc.academicYear}`} className="flex flex-wrap items-center gap-2 px-3 py-2.5 bg-lantern-surface">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-lantern-text truncate" title={courseLabel(uc.course)}>
                    {uc.course.code}
                    {uc.course.title && uc.course.title !== uc.course.code ? (
                      <span className="text-lantern-text-secondary font-normal"> — {uc.course.title}</span>
                    ) : null}
                  </p>
                  <p className="text-xs text-lantern-text-tertiary">{uc.academicYear}{uc.semester ? ` · Semester ${uc.semester}` : ''}</p>
                </div>
                <label className="flex items-center gap-1.5 text-xs text-lantern-text-secondary">
                  <span>Exam</span>
                  <input
                    type="date"
                    defaultValue={uc.examDate || ''}
                    key={`${uc.course.id}-${uc.examDate || ''}`}
                    onBlur={(e) => void handleExamDate(uc, e.target.value)}
                    onChange={(e) => {
                      // Native pickers commit on change (no blur) — save immediately when a full date is set or cleared.
                      if (!e.target.value || e.target.value.length === 10) void handleExamDate(uc, e.target.value);
                    }}
                    disabled={busyCourseId === uc.course.id}
                    className="p-1.5 border border-lantern-border rounded-md bg-lantern-surface dark:bg-lantern-surface-secondary text-lantern-text text-xs"
                    aria-label={`Exam date for ${uc.course.code}`}
                  />
                </label>
                <button
                  type="button"
                  onClick={() => void handleRemove(uc)}
                  disabled={busyCourseId === uc.course.id}
                  className="p-1.5 rounded-md text-lantern-text-secondary hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50"
                  aria-label={`Remove ${uc.course.code}`}
                >
                  <TrashIcon className="w-4 h-4" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="space-y-2">
          <CourseMultiSelect
            id="academic-add-courses"
            label="Add courses"
            value={addSelection}
            onChange={setAddSelection}
            institutionId={institutionId}
            hint="Search by code (BIO 201) or title. Can’t find one? Type the code and add it."
          />
          {addSelection.length > 0 ? (
            <Button type="button" size="sm" onClick={() => void handleAddCourses()} disabled={addingCourses}>
              {addingCourses ? 'Adding…' : `Add ${addSelection.length} course${addSelection.length === 1 ? '' : 's'}`}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
};

export default AcademicSettingsSection;
