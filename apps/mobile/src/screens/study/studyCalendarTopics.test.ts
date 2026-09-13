import { calendarNoTopicsCopy, calendarTopicsFor } from './studyCalendarTopics';

const SET_PLAN = [
  { id: 't1', title: 'Kinematics' },
  { id: 't2', title: 'Dynamics' },
];
const COURSE = [{ id: 'c1', title: 'Course outline topic' }];

describe('calendarTopicsFor', () => {
  it('plans a set against its saved plan, not its course outline', () => {
    expect(
      calendarTopicsFor({
        studySetId: 'set-1',
        courseId: 'course-1',
        setPlanTopics: SET_PLAN,
        courseTopics: COURSE,
      })
    ).toEqual(SET_PLAN);
  });

  it('leaves a set with no saved plan empty, so the blocker is honest', () => {
    expect(
      calendarTopicsFor({ studySetId: 'set-1', courseId: 'course-1', setPlanTopics: [], courseTopics: COURSE })
    ).toEqual([]);
    expect(calendarNoTopicsCopy('set')).toContain('this set');
    expect(calendarNoTopicsCopy('set')).not.toContain('course');
  });

  it('keeps the course outline for a course-scoped calendar', () => {
    expect(
      calendarTopicsFor({ studySetId: null, courseId: 'course-1', courseTopics: COURSE, setPlanTopics: SET_PLAN })
    ).toEqual(COURSE);
    expect(calendarNoTopicsCopy('course')).toContain('this course');
  });

  it('treats a blank set id as course scope and drops untitled rows', () => {
    expect(calendarTopicsFor({ studySetId: '   ', courseId: 'course-1', courseTopics: COURSE })).toEqual(COURSE);
    expect(
      calendarTopicsFor({
        studySetId: 'set-1',
        setPlanTopics: [{ id: 't1', title: '  ' }, { id: '', title: 'x' }, { id: 't2', title: ' Waves ' }],
      })
    ).toEqual([{ id: 't2', title: 'Waves' }]);
  });
});
