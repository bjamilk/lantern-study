import type { JobEmploymentType } from './employmentTypes';

/**
 * Validated Phase 0 campus job intents — seed templates for create-job UX.
 */
export interface JobIntentTemplate {
  id: string;
  employmentType: JobEmploymentType;
  title: string;
  descriptionHint: string;
  suggestedScreeners: string[];
}

export const CAMPUS_JOB_INTENT_TEMPLATES: JobIntentTemplate[] = [
  {
    id: 'tutoring-course',
    employmentType: 'tutoring',
    title: 'Tutor needed for [course]',
    descriptionHint: 'Course code, topics, preferred schedule, rate per hour (NGN).',
    suggestedScreeners: ['Which courses have you tutored?', 'What is your availability this week?'],
  },
  {
    id: 'hall-move-help',
    employmentType: 'gig',
    title: 'Help moving into / out of hall',
    descriptionHint: 'Date, hall/area, how many helpers, pay for the job.',
    suggestedScreeners: ['Can you lift boxes?', 'Are you free on the move date?'],
  },
  {
    id: 'event-staffing',
    employmentType: 'gig',
    title: 'Event usher / registration helper',
    descriptionHint: 'Event name, date/time, dress code, pay.',
    suggestedScreeners: ['Have you worked events before?', 'Can you arrive 30 minutes early?'],
  },
  {
    id: 'faculty-assistant',
    employmentType: 'campus_org',
    title: 'Department / faculty student assistant',
    descriptionHint: 'Department, duties, hours/week, stipend if any.',
    suggestedScreeners: ['What is your department/level?', 'Any relevant experience?'],
  },
  {
    id: 'student-union',
    employmentType: 'campus_org',
    title: 'Student union / society role',
    descriptionHint: 'Role title, responsibilities, whether paid or volunteer.',
    suggestedScreeners: ['Why are you interested?', 'Relevant club experience?'],
  },
  {
    id: 'research-ra',
    employmentType: 'research',
    title: 'Research assistant',
    descriptionHint: 'Lab/project, skills needed, hours, stipend.',
    suggestedScreeners: ['Relevant coursework?', 'Can you commit X hours/week?'],
  },
  {
    id: 'cafe-shop',
    employmentType: 'part_time',
    title: 'Part-time café / campus shop',
    descriptionHint: 'Location, shifts, pay rate, start date.',
    suggestedScreeners: ['Weekend availability?', 'Customer service experience?'],
  },
  {
    id: 'brand-ambassador',
    employmentType: 'part_time',
    title: 'Campus brand ambassador',
    descriptionHint: 'Brand, duties (flyering, social), stipend/perks.',
    suggestedScreeners: ['Follower count / campus reach?', 'Can you commit to event dates?'],
  },
  {
    id: 'exam-prep-group',
    employmentType: 'tutoring',
    title: 'Exam-prep study group leader',
    descriptionHint: 'Subject, exam date, group size, rate.',
    suggestedScreeners: ['Past exam performance?', 'Preferred meeting format?'],
  },
  {
    id: 'remote-microtask',
    employmentType: 'part_time',
    title: 'Remote micro-task / data entry',
    descriptionHint: 'Task type, tools, pay per task or hourly — no fees to start.',
    suggestedScreeners: ['Reliable internet?', 'Hours available per week?'],
  },
];
