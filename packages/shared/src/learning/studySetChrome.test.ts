import {
  firstQuestionPreview,
  resumeKindFromActivity,
  studySetCompanionPrompts,
  upcomingExamsFromNotes,
  examTitleFromNote,
} from './studySetChrome';

describe('studySetChrome', () => {
  it('maps activities to resume kinds and companion prompts', () => {
    expect(resumeKindFromActivity('cards')).toBe('cards');
    expect(resumeKindFromActivity('quiz')).toBe('quiz');
    expect(studySetCompanionPrompts('notes').map((row) => row.id)).toContain('cards');
    expect(studySetCompanionPrompts('home').some((row) => row.go === 'quiz')).toBe(true);
  });

  it('previews the first quiz question', () => {
    expect(firstQuestionPreview([{ question: 'What is ATP?' }])).toBe('What is ATP?');
    expect(firstQuestionPreview([])).toBeNull();
  });

  it('lists future exam dates from calendar notes', () => {
    const exams = upcomingExamsFromNotes(
      [
        {
          title: 'BIO 201',
          studySetId: 'set-1',
          body: '```lantern-calendar\n{"examDate":"2099-06-01","hoursPerWeek":7,"sessions":[]}\n```',
        },
        {
          title: 'Old',
          body: '```lantern-calendar\n{"examDate":"2020-01-01","hoursPerWeek":7,"sessions":[]}\n```',
        },
      ],
      '2026-09-11'
    );
    expect(exams).toEqual([{ examDate: '2099-06-01', title: 'BIO 201', studySetId: 'set-1' }]);
  });
});

describe('examTitleFromNote', () => {
  it('names the set, not the plan note it was read off', () => {
    // Home's Upcoming card rendered the raw note title, so a generated plan
    // note surfaced as "Plan — PHARM 212" where the exam's name belonged.
    expect(examTitleFromNote('Plan — PHARM 212')).toBe('PHARM 212');
    expect(examTitleFromNote('Recap — BIO 201')).toBe('BIO 201');
  });

  it('leaves a title a student wrote alone', () => {
    expect(examTitleFromNote('Midterm plan')).toBe('Midterm plan');
    expect(examTitleFromNote('  ')).toBe('Exam');
    expect(examTitleFromNote(null)).toBe('Exam');
  });

  it('does not strip a prefix down to nothing', () => {
    expect(examTitleFromNote('Plan — ')).toBe('Plan —');
  });
});
