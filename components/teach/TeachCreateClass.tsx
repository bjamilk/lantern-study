import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Course, CourseTopic } from '@lantern/shared';
import { TOPIC_TITLE_MAX } from '@lantern/shared';
import {
  COURSE_CODE_MAX_LENGTH,
  COURSE_TITLE_MAX_LENGTH,
  currentAcademicYear,
  defaultClassTitle,
  isValidCourseCode,
  normalizeCourseCode,
  suggestCourseCodeFromTitle,
  teachClassPath,
} from '@lantern/shared/academic';
import { Button, Input, ScreenHeader } from '../ui';
import { CoursePicker } from '../academic/CoursePicker';
import { TopicPicker } from '../academic/TopicPicker';
import { createClass } from '../../services/classes';
import { createCourse } from '../../services/academic';
import { useAuthStore } from '../../stores/authStore';
import { TeachAffiliationForm } from './TeachAffiliationForm';

type TeachScope = 'course' | 'topic';

export const TeachCreateClass: React.FC = () => {
  const navigate = useNavigate();
  const institutionId = useAuthStore((s) => s.currentUser?.institutionId ?? null);
  const [scope, setScope] = useState<TeachScope>('course');
  const [course, setCourse] = useState<Course | null>(null);
  const [courseTitle, setCourseTitle] = useState('');
  const [courseCode, setCourseCode] = useState('');
  const [codeTouched, setCodeTouched] = useState(false);
  const [topic, setTopic] = useState<CourseTopic | null>(null);
  const [topicTitle, setTopicTitle] = useState('');
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const onCourseTitle = (value: string) => {
    setCourseTitle(value);
    setCourse(null);
    setTopic(null);
    if (!codeTouched) setCourseCode(suggestCourseCodeFromTitle(value));
  };

  const onPickCourse = (next: Course | null) => {
    setCourse(next);
    if (next) {
      setCourseTitle(next.title);
      setCourseCode(next.code);
      setCodeTouched(true);
    }
    setTopic(null);
  };

  const resolveCourse = async (): Promise<Course> => {
    if (course) return course;
    const titleValue = courseTitle.trim().replace(/\s+/g, ' ');
    const code = normalizeCourseCode(courseCode);
    if (titleValue.length < 2) {
      throw new Error('Name the subject or course you teach');
    }
    if (titleValue.length > COURSE_TITLE_MAX_LENGTH) {
      throw new Error(`Subject title must be at most ${COURSE_TITLE_MAX_LENGTH} characters`);
    }
    if (!isValidCourseCode(code)) {
      throw new Error('Add a short code (2–20 letters or digits), e.g. MATH or BIO 201');
    }
    return createCourse({
      institutionId: institutionId || null,
      code,
      title: titleValue,
    });
  };

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const resolved = await resolveCourse();
      const trimmedTopic = topicTitle.trim().replace(/\s+/g, ' ');
      if (scope === 'topic' && !topic?.id && trimmedTopic.length < 2) {
        throw new Error('Name the topic you teach — e.g. Fractions or Photosynthesis');
      }
      const created = await createClass({
        courseId: resolved.id,
        title: title.trim() || undefined,
        academicYear: currentAcademicYear(),
        semester: resolved.semester ?? null,
        topicId: scope === 'topic' && topic?.id && topic.courseId === resolved.id ? topic.id : undefined,
        topicTitle: scope === 'topic' ? trimmedTopic || topic?.title : undefined,
      });
      navigate(teachClassPath(created.id), { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the class');
    } finally {
      setSaving(false);
    }
  };

  const previewName = defaultClassTitle(
    {
      code: course?.code || normalizeCourseCode(courseCode) || 'CODE',
      title: course?.title || courseTitle.trim() || 'Subject',
    },
    scope === 'topic' ? { title: topic?.title || topicTitle } : null
  );

  const canSubmit =
    (Boolean(course) || (courseTitle.trim().length >= 2 && isValidCourseCode(normalizeCourseCode(courseCode)))) &&
    (scope === 'course' || Boolean(topic?.id) || topicTitle.trim().length >= 2);

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-4 p-4 md:p-8">
      <ScreenHeader
        title="New class"
        subtitle="Cover a whole subject, or just one topic. Students join with a 6-character code."
      />
      {!institutionId ? <TeachAffiliationForm compact /> : null}
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <fieldset className="flex flex-col gap-2">
          <legend className="text-caption text-lantern-text-secondary">What are you teaching?</legend>
          <div className="grid grid-cols-2 gap-2">
            <Button
              type="button"
              variant={scope === 'course' ? 'primary' : 'secondary'}
              onClick={() => setScope('course')}
            >
              Whole course
            </Button>
            <Button
              type="button"
              variant={scope === 'topic' ? 'primary' : 'secondary'}
              onClick={() => setScope('topic')}
            >
              One topic
            </Button>
          </div>
          <p className="text-caption text-lantern-text-tertiary">
            {scope === 'topic'
              ? 'Use this when you only teach part of a subject — Fractions, Photosynthesis, Essay writing.'
              : 'The full subject or catalogue course, e.g. Mathematics, Civic Education, or BIO 201.'}
          </p>
        </fieldset>

        <label className="flex flex-col gap-1">
          <span className="text-caption text-lantern-text-secondary">
            {scope === 'topic' ? 'Subject this topic sits in' : 'Subject or course title'}
          </span>
          <Input
            value={courseTitle}
            onChange={(event) => onCourseTitle(event.target.value)}
            placeholder="Mathematics, Civic Education, Cell Biology"
            maxLength={COURSE_TITLE_MAX_LENGTH}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-caption text-lantern-text-secondary">Short code</span>
          <Input
            value={courseCode}
            onChange={(event) => {
              setCourseCode(event.target.value.toUpperCase());
              setCodeTouched(true);
              setCourse(null);
              setTopic(null);
            }}
            placeholder="MATH or BIO 201"
            maxLength={COURSE_CODE_MAX_LENGTH}
          />
        </label>
        <CoursePicker
          value={course}
          onChange={onPickCourse}
          label="Or pick a listed course"
          placeholder="Search existing courses"
          allowLetterOnlyCreate
          hint="If it is not listed, the title and code above create it."
        />

        {scope === 'topic' ? (
          <>
            <label className="flex flex-col gap-1">
              <span className="text-caption text-lantern-text-secondary">Topic you teach</span>
              <Input
                value={topicTitle}
                onChange={(event) => {
                  setTopicTitle(event.target.value);
                  setTopic(null);
                }}
                placeholder="Fractions, Photosynthesis, Essay writing"
                maxLength={TOPIC_TITLE_MAX}
              />
            </label>
            {course?.id ? (
              <TopicPicker
                courseId={course.id}
                value={topic}
                onChange={(next) => {
                  setTopic(next);
                  if (next?.title) setTopicTitle(next.title);
                }}
                label="Or pick from this subject’s outline"
                placeholder="Choose an existing topic"
                clearable={false}
                hint="Type the topic name above if it is not on the outline yet."
              />
            ) : null}
          </>
        ) : null}

        <label className="flex flex-col gap-1">
          <span className="text-caption text-lantern-text-secondary">Class name (optional)</span>
          <Input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder={previewName}
          />
        </label>
        {error ? <p className="text-body text-lantern-error">{error}</p> : null}
        <Button type="submit" disabled={saving || !canSubmit}>
          {saving ? 'Creating…' : 'Create class'}
        </Button>
      </form>
    </div>
  );
};
