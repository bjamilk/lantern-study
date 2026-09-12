import React, { useEffect, useState } from 'react';
import { EXAM_DATE_UNSUPPORTED_COPY, examDateSaveOutcome } from '@lantern/shared';
import { Button, Input } from '../ui';
import { updateStudySet } from '../../services/academic';
import { useAcademicStore } from '../../stores/academicStore';
import { useStudySetStore } from '../../stores/studySetStore';
import { useToastStore } from '../../stores/toastStore';

/** The one sentence shown when the draft is not a calendar day. */
export const EXAM_DATE_FORMAT_COPY = 'Exam date must be YYYY-MM-DD.';

/**
 * May this draft be sent?
 *
 * An empty draft is a deliberate clear. A native `type="date"` input already
 * refuses anything else, but the guard stays because the value also arrives
 * from props and from a browser that renders the control as plain text.
 */
export function isSendableExamDraft(draft: string): boolean {
  const next = draft.trim();
  return next === '' || /^\d{4}-\d{2}-\d{2}$/.test(next);
}

export interface ExamDateFieldProps {
  studySetId?: string | null;
  courseId?: string | null;
  /** The date the container currently holds, or null. */
  value: string | null;
  onSaved: (outcome: 'saved' | 'unsupported', value: string | null) => void;
}

/**
 * The exam date a study plan is built from.
 *
 * It lived inline in `StudyCalendar`, which a study set's Plan tab never
 * renders, so a set-scoped student had no field at all. Extracting it lets the
 * set's plan panel and the course calendar show the same control with the same
 * honesty rule: a "saved" toast only fires when the server echoes the date
 * back, because the production API can answer a set PATCH without storing it.
 */
export const ExamDateField: React.FC<ExamDateFieldProps> = ({
  studySetId,
  courseId,
  value,
  onSaved,
}) => {
  const myCourses = useAcademicStore((s) => s.myCourses);
  const updateMyCourse = useAcademicStore((s) => s.updateMyCourse);
  const loadStudySets = useStudySetStore((s) => s.loadSets);
  const showToast = useToastStore((s) => s.showToast);

  const [draft, setDraft] = useState(value || '');
  const [saving, setSaving] = useState(false);
  const [unsupported, setUnsupported] = useState(false);
  const [formatError, setFormatError] = useState(false);

  useEffect(() => {
    setDraft(value || '');
  }, [value]);

  const enrolment = courseId ? myCourses.find((row) => row.course.id === courseId) ?? null : null;

  const save = async () => {
    const next = draft.trim();
    if (!isSendableExamDraft(next)) {
      setFormatError(true);
      showToast(EXAM_DATE_FORMAT_COPY, 'error');
      return;
    }
    setFormatError(false);
    setSaving(true);
    try {
      // The set is the primary container, so its own date is what a set-scoped
      // Plan tab writes. A course room has no set and still writes the
      // enrolment, which is what exam reminders read.
      if (studySetId) {
        const updated = await updateStudySet(studySetId, { examDate: next || null });
        await loadStudySets({ force: true }).catch(() => undefined);
        // A 200 is not evidence: the production API can answer without storing
        // the date, so the returned row has to echo it back.
        if (examDateSaveOutcome(next || null, updated) === 'unsupported') {
          setUnsupported(true);
          onSaved('unsupported', next || null);
          return;
        }
        setUnsupported(false);
        showToast(next ? 'Exam date saved.' : 'Exam date cleared.', 'success');
        onSaved('saved', next || null);
        return;
      }
      if (!courseId || !enrolment) {
        showToast('Open this plan from a study set or a course to save a date.', 'info');
        return;
      }
      await updateMyCourse(courseId, {
        examDate: next || null,
        academicYear: enrolment.academicYear,
      });
      setUnsupported(false);
      showToast(
        next ? 'Exam date saved. Reminders still use this date.' : 'Exam date cleared.',
        'success'
      );
      onSaved('saved', next || null);
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not save the exam date.', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <label className="block">
        <span className="text-caption text-lantern-text-secondary">Exam date</span>
        <div className="mt-1 flex gap-2">
          <Input
            type="date"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            className="text-body flex-1"
          />
          <Button size="sm" variant="secondary" loading={saving} onClick={() => void save()}>
            Save
          </Button>
        </div>
      </label>
      {formatError ? (
        <p className="text-caption text-lantern-error mt-1">{EXAM_DATE_FORMAT_COPY}</p>
      ) : null}
      {unsupported ? (
        <p className="text-caption text-lantern-text-secondary mt-1">{EXAM_DATE_UNSUPPORTED_COPY}</p>
      ) : null}
    </div>
  );
};

export default ExamDateField;
