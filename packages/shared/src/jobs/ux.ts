import type { JobsWorkspaceSection } from './types';

/** Wireframe map for Jobs inside Marketplace workspace (Phase 0). */
export const JOBS_WORKSPACE_SECTIONS: Array<{
  id: JobsWorkspaceSection;
  label: string;
  path: string;
}> = [
  { id: 'goods', label: 'Goods', path: '/marketplace' },
  { id: 'jobs', label: 'Jobs', path: '/marketplace/jobs' },
  { id: 'my_applications', label: 'My applications', path: '/marketplace/applications' },
  { id: 'my_jobs', label: 'My jobs', path: '/marketplace/my-jobs' },
  { id: 'employer', label: 'Employer', path: '/marketplace/employer' },
];

export const JOBS_ROUTE_PATHS = {
  browse: '/marketplace/jobs',
  detail: (id: string) => `/marketplace/jobs/${encodeURIComponent(id)}`,
  create: '/marketplace/jobs/new',
  applications: '/marketplace/applications',
  myJobs: '/marketplace/my-jobs',
  employer: '/marketplace/employer',
  employerPipeline: (postingId: string) =>
    `/marketplace/employer/jobs/${encodeURIComponent(postingId)}`,
  company: '/marketplace/employer/company',
} as const;

export const JOBS_MAX_SCREENERS_PHASE1 = 3;
export const JOBS_MAX_SCREENERS_PHASE2 = 5;
