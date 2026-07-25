import type { JobEmploymentType } from './employmentTypes';

/**
 * Seed templates for create-job UX — campus/peer and employer roles.
 */
export interface JobIntentTemplate {
  id: string;
  employmentType: JobEmploymentType;
  title: string;
  descriptionHint: string;
  suggestedScreeners: string[];
  /** Audience group for create UX sections. */
  group: 'campus_student' | 'employers';
}

export const JOB_INTENT_TEMPLATE_GROUPS = [
  { id: 'employers' as const, label: 'Employers & roles' },
  { id: 'campus_student' as const, label: 'Campus & student' },
];

/** Campus / peer templates (kept for discovery and student posters). */
export const CAMPUS_JOB_INTENT_TEMPLATES: JobIntentTemplate[] = [
  {
    id: 'tutoring-course',
    employmentType: 'tutoring',
    group: 'campus_student',
    title: 'Tutor needed for [course]',
    descriptionHint: 'Course code, topics, preferred schedule, rate per hour (NGN).',
    suggestedScreeners: ['Which courses have you tutored?', 'What is your availability this week?'],
  },
  {
    id: 'hall-move-help',
    employmentType: 'gig',
    group: 'campus_student',
    title: 'Help moving into / out of hall',
    descriptionHint: 'Date, hall/area, how many helpers, pay for the job.',
    suggestedScreeners: ['Can you lift boxes?', 'Are you free on the move date?'],
  },
  {
    id: 'event-staffing',
    employmentType: 'gig',
    group: 'campus_student',
    title: 'Event usher / registration helper',
    descriptionHint: 'Event name, date/time, dress code, pay.',
    suggestedScreeners: ['Have you worked events before?', 'Can you arrive 30 minutes early?'],
  },
  {
    id: 'faculty-assistant',
    employmentType: 'campus_org',
    group: 'campus_student',
    title: 'Department / faculty student assistant',
    descriptionHint: 'Department, duties, hours/week, stipend if any.',
    suggestedScreeners: ['What is your department/level?', 'Any relevant experience?'],
  },
  {
    id: 'student-union',
    employmentType: 'campus_org',
    group: 'campus_student',
    title: 'Student union / society role',
    descriptionHint: 'Role title, responsibilities, whether paid or volunteer.',
    suggestedScreeners: ['Why are you interested?', 'Relevant club experience?'],
  },
  {
    id: 'research-ra',
    employmentType: 'research',
    group: 'campus_student',
    title: 'Research assistant',
    descriptionHint: 'Lab/project, skills needed, hours, stipend.',
    suggestedScreeners: ['Relevant coursework?', 'Can you commit X hours/week?'],
  },
  {
    id: 'cafe-shop',
    employmentType: 'part_time',
    group: 'campus_student',
    title: 'Part-time café / campus shop',
    descriptionHint: 'Location, shifts, pay rate, start date.',
    suggestedScreeners: ['Weekend availability?', 'Customer service experience?'],
  },
  {
    id: 'brand-ambassador-campus',
    employmentType: 'part_time',
    group: 'campus_student',
    title: 'Campus brand ambassador',
    descriptionHint: 'Brand, duties (flyering, social), stipend/perks.',
    suggestedScreeners: ['Follower count / campus reach?', 'Can you commit to event dates?'],
  },
  {
    id: 'exam-prep-group',
    employmentType: 'tutoring',
    group: 'campus_student',
    title: 'Exam-prep study group leader',
    descriptionHint: 'Subject, exam date, group size, rate.',
    suggestedScreeners: ['Past exam performance?', 'Preferred meeting format?'],
  },
  {
    id: 'remote-microtask',
    employmentType: 'part_time',
    group: 'campus_student',
    title: 'Remote micro-task / data entry',
    descriptionHint: 'Task type, tools, pay per task or hourly — no fees to start.',
    suggestedScreeners: ['Reliable internet?', 'Hours available per week?'],
  },
];

/** Employer / company-leaning templates. */
export const EMPLOYER_JOB_INTENT_TEMPLATES: JobIntentTemplate[] = [
  {
    id: 'internship-role',
    employmentType: 'internship',
    group: 'employers',
    title: 'Internship — [team / function]',
    descriptionHint: 'Team, duration, location or remote, stipend if any, start date.',
    suggestedScreeners: ['Relevant coursework or projects?', 'Available full-time for the internship period?'],
  },
  {
    id: 'part-time-retail',
    employmentType: 'part_time',
    group: 'employers',
    title: 'Part-time retail / service associate',
    descriptionHint: 'Location, shifts, pay rate, start date.',
    suggestedScreeners: ['Weekend or evening availability?', 'Customer service experience?'],
  },
  {
    id: 'full-time-role',
    employmentType: 'full_time',
    group: 'employers',
    title: 'Full-time — [role title]',
    descriptionHint: 'Responsibilities, requirements, location or remote, salary range or discuss.',
    suggestedScreeners: ['Years of relevant experience?', 'When can you start?'],
  },
  {
    id: 'contract-freelance',
    employmentType: 'contract',
    group: 'employers',
    title: 'Contract / freelance — [deliverable]',
    descriptionHint: 'Scope, timeline, tools, pay (milestone or hourly).',
    suggestedScreeners: ['Portfolio or sample work?', 'Can you meet the deadline?'],
  },
  {
    id: 'remote-ops-support',
    employmentType: 'part_time',
    group: 'employers',
    title: 'Remote ops / customer support',
    descriptionHint: 'Hours, tools (chat/email), pay rate — no fees to start.',
    suggestedScreeners: ['Reliable internet and quiet workspace?', 'Hours available per week?'],
  },
  {
    id: 'brand-ambassador',
    employmentType: 'part_time',
    group: 'employers',
    title: 'Brand ambassador / field marketing',
    descriptionHint: 'Brand, cities or venues, duties, stipend/perks.',
    suggestedScreeners: ['Social reach or event experience?', 'Can you commit to scheduled activations?'],
  },
];

/** All templates for create UX and API seed endpoints. */
export const JOB_INTENT_TEMPLATES: JobIntentTemplate[] = [
  ...EMPLOYER_JOB_INTENT_TEMPLATES,
  ...CAMPUS_JOB_INTENT_TEMPLATES,
];

export function jobIntentTemplatesByGroup(group: JobIntentTemplate['group']): JobIntentTemplate[] {
  return JOB_INTENT_TEMPLATES.filter((t) => t.group === group);
}
