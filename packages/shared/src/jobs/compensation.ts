import type { JobEmploymentType } from './employmentTypes';
import type { JobCompensation, JobCompensationPeriod, JobEngagementDuration } from './types';

export const JOB_COMPENSATION_PERIODS = [
  'hour',
  'day',
  'week',
  'month',
  'total',
  'stipend',
] as const;

export const JOB_COMPENSATION_PERIOD_LABELS: Record<JobCompensationPeriod, string> = {
  hour: 'Per hour',
  day: 'Per day',
  week: 'Per week',
  month: 'Per month',
  total: 'Total / one-off',
  stipend: 'Stipend',
};

export const JOB_ENGAGEMENT_DURATION_UNITS = ['day', 'week', 'month'] as const;

export type JobEngagementDurationUnit = (typeof JOB_ENGAGEMENT_DURATION_UNITS)[number];

export const JOB_ENGAGEMENT_DURATION_UNIT_LABELS: Record<JobEngagementDurationUnit, string> = {
  day: 'Day(s)',
  week: 'Week(s)',
  month: 'Month(s)',
};

export function jobRequiresEngagementDuration(employmentType: JobEmploymentType): boolean {
  return employmentType !== 'full_time';
}

export function isJobCompensationPeriod(value: unknown): value is JobCompensationPeriod {
  return typeof value === 'string' && (JOB_COMPENSATION_PERIODS as readonly string[]).includes(value);
}

export function isValidJobEngagementDuration(value: unknown): value is JobEngagementDuration {
  if (!value || typeof value !== 'object') return false;
  const d = value as JobEngagementDuration;
  if (d.kind === 'ongoing') return true;
  if (d.kind === 'fixed') {
    const n = Number(d.value);
    return (
      Number.isFinite(n) &&
      n >= 1 &&
      typeof d.unit === 'string' &&
      (JOB_ENGAGEMENT_DURATION_UNITS as readonly string[]).includes(d.unit)
    );
  }
  return false;
}

export function formatJobCompensation(c: JobCompensation | null | undefined): string {
  if (!c || c.kind === 'discuss') return 'Pay: discuss';
  if (c.kind === 'unpaid') return 'Unpaid';
  const cur = c.currency || 'NGN';
  const period =
    c.period && isJobCompensationPeriod(c.period)
      ? ` / ${JOB_COMPENSATION_PERIOD_LABELS[c.period].replace(/^Per /i, '').toLowerCase()}`
      : '';
  if (c.amountMin != null && c.amountMax != null) {
    return `${cur} ${c.amountMin}–${c.amountMax}${period}`;
  }
  if (c.amountMin != null) return `${cur} ${c.amountMin}${period}`;
  return `Paid${period}`;
}

export function formatJobEngagementDuration(
  duration: JobEngagementDuration | null | undefined
): string | null {
  if (!duration) return null;
  if (duration.kind === 'ongoing') return 'Ongoing';
  if (duration.kind === 'fixed' && duration.value != null && duration.unit) {
    const unit = JOB_ENGAGEMENT_DURATION_UNIT_LABELS[duration.unit] || duration.unit;
    const singular = duration.value === 1 ? unit.replace(/\(s\)$/, '') : unit.replace(/\(s\)$/, 's');
    return `${duration.value} ${singular}`;
  }
  return null;
}
