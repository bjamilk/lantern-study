import { describe, expect, it } from 'vitest';
import { toDateOnlyLocal } from '../utils/dateOnly';
import {
  CALENDAR_FENCE,
  DEFAULT_HOURS_PER_WEEK,
  SESSION_HARD_CAP,
  WEEKDAY_LABELS,
  acceptStudyCalendar,
  calendarExamChanged,
  calendarKindLabel,
  calendarMonthGrid,
  calendarMonthTitle,
  calendarSessionFeature,
  composeCalendarNoteBody,
  generateStudyCalendar,
  isCalendarNote,
  newCalendarNoteTitle,
  parseCalendarNoteBody,
  resolveCalendarStudioNote,
  sessionMinutesForHours,
  sessionsOnDate,
  studyCalendarBlocker,
} from './studyCalendar';

const TODAY = '2026-09-11';
const EXAM = '2026-10-09';

const TOPICS = [
  { id: 't-pe', title: 'Pulmonary Embolism' },
  { id: 't-asthma', title: 'Asthma' },
  { id: 't-copd', title: 'COPD' },
];

describe('study calendar', () => {
  it('blocks generate without an exam date, a future exam, or topics', () => {
    expect(studyCalendarBlocker({ examDate: null, today: TODAY, topics: TOPICS })).toBe('no_exam');
    expect(studyCalendarBlocker({ examDate: '2026-09-10', today: TODAY, topics: TOPICS })).toBe(
      'exam_passed'
    );
    expect(studyCalendarBlocker({ examDate: EXAM, today: TODAY, topics: [] })).toBe('no_topics');
    expect(studyCalendarBlocker({ examDate: EXAM, today: TODAY, topics: TOPICS })).toBeNull();
  });

  it('spreads topics across weekdays and deep-links cards or quiz to the right target', () => {
    const result = generateStudyCalendar({
      today: TODAY,
      examDate: EXAM,
      hoursPerWeek: DEFAULT_HOURS_PER_WEEK,
      topics: TOPICS,
      decks: [{ id: 'deck-pe', name: 'PE cards', topicId: 't-pe' }],
      notes: [
        {
          id: 'note-asthma',
          title: 'Asthma',
          topicId: 't-asthma',
          body: 'Asthma is reversible airway obstruction with wheeze. '.repeat(4),
        },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.acceptedAt).toBeNull();
    expect(result.plan.sessions.length).toBeGreaterThan(0);
    expect(result.plan.sessions.length).toBeLessThanOrEqual(SESSION_HARD_CAP);
    for (const session of result.plan.sessions) {
      expect(session.date >= TODAY).toBe(true);
      expect(session.date < EXAM).toBe(true);
      expect(session.minutes).toBe(sessionMinutesForHours(7));
      expect(session.status).toBe('planned');
    }
    const cards = result.plan.sessions.find(
      (session) => session.kind === 'cards' && session.topicId === 't-pe'
    );
    expect(cards?.targetId).toBe('deck-pe');
    const quiz = result.plan.sessions.find(
      (session) => session.kind === 'quiz' && session.topicId === 't-asthma'
    );
    expect(quiz?.targetId).toBe('note-asthma');
    expect(calendarKindLabel('cards')).toBe('Cards');
    expect(calendarSessionFeature('quiz')).toBe('tests');
  });

  it('caps a long runway and never dumps studio notes into quiz targets', () => {
    const topics = Array.from({ length: 12 }, (_, i) => ({
      id: `t-${i}`,
      title: `Topic ${i + 1}`,
    }));
    const result = generateStudyCalendar({
      today: TODAY,
      examDate: '2027-06-01',
      hoursPerWeek: 10,
      topics,
      notes: [
        {
          id: 'recap',
          title: 'Recap — Summary · PE',
          body: '```lantern-recap\n{}\n```',
        },
        {
          id: 'ok',
          title: 'Pulmonary Embolism',
          body: 'A clot that travels to the lung causes sudden dyspnea. '.repeat(6),
        },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.sessions.length).toBeLessThanOrEqual(SESSION_HARD_CAP);
    const quiz = result.plan.sessions.find((session) => session.kind === 'quiz');
    expect(quiz?.targetId).toBe('ok');
  });

  it('round-trips a plan through the note fence and names the door note', () => {
    const generated = generateStudyCalendar({
      today: TODAY,
      examDate: EXAM,
      topics: TOPICS,
      decks: [{ id: 'd1', name: 'Deck' }],
    });
    expect(generated.ok).toBe(true);
    if (!generated.ok) return;
    const accepted = acceptStudyCalendar(generated.plan, '2026-09-11T12:00:00.000Z');
    expect(accepted.acceptedAt).toBe('2026-09-11T12:00:00.000Z');
    expect(accepted.sessions.every((session) => session.status === 'accepted')).toBe(true);
    const body = composeCalendarNoteBody(accepted);
    expect(body.includes(CALENDAR_FENCE)).toBe(true);
    expect(isCalendarNote({ title: newCalendarNoteTitle('PHARM 212'), body })).toBe(true);
    const parsed = parseCalendarNoteBody(body);
    expect(parsed?.examDate).toBe(EXAM);
    expect(parsed?.sessions).toHaveLength(accepted.sessions.length);
    expect(sessionsOnDate(parsed, parsed!.sessions[0]!.date).length).toBeGreaterThan(0);
    expect(calendarExamChanged(parsed!, '2026-11-01')).toBe(true);
    expect(calendarExamChanged(parsed!, EXAM)).toBe(false);
  });

  it('builds a Monday-start month grid with local dates, not UTC midnight', () => {
    expect(WEEKDAY_LABELS[0]).toBe('Mon');
    const grid = calendarMonthGrid(2026, 8);
    expect(grid).toHaveLength(42);
    const eleventh = grid.find((cell) => cell.date === TODAY);
    expect(eleventh?.inMonth).toBe(true);
    expect(toDateOnlyLocal(new Date(2026, 8, 11))).toBe(TODAY);
    expect(calendarMonthTitle(2026, 8)).toBe('Sep 2026');
  });

  it('resumes the existing calendar note', () => {
    expect(resolveCalendarStudioNote({ calendars: [{ id: 'a' }, { id: 'b' }], selectedNoteId: 'b' })).toEqual(
      { action: 'resume', noteId: 'b' }
    );
    expect(resolveCalendarStudioNote({ calendars: [{ id: 'a' }] })).toEqual({
      action: 'resume',
      noteId: 'a',
    });
    expect(resolveCalendarStudioNote({ calendars: [] })).toEqual({ action: 'start' });
  });
});
