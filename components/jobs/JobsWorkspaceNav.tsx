import React from 'react';
import {
  BriefcaseIcon,
  DocumentTextIcon,
  BuildingOffice2Icon,
  PlusIcon,
  ShoppingBagIcon,
} from '@heroicons/react/24/outline';
import type { JobsWorkspaceSection } from '@lantern/shared';

const btn = (active: boolean) =>
  `inline-flex items-center gap-1.5 shrink-0 h-9 min-h-[44px] sm:h-8 sm:min-h-[36px] px-2.5 sm:px-3 rounded-lg text-xs sm:text-sm font-medium transition-colors ${
    active
      ? 'bg-lantern-primary text-white shadow-sm'
      : 'bg-lantern-background-secondary text-lantern-text-secondary hover:text-lantern-text'
  }`;

export function JobsWorkspaceNav({
  active,
  onNavigate,
  onPostJob,
}: {
  active: JobsWorkspaceSection;
  onNavigate: (screen: string) => void;
  onPostJob?: () => void;
}) {
  return (
    <div className="flex items-center gap-1.5 sm:gap-2 min-w-0" role="navigation" aria-label="Jobs workspace">
      <div className="flex items-center gap-1 sm:gap-1.5 min-w-0 flex-1 overflow-x-auto scrollbar-none">
        <button type="button" className={btn(false)} onClick={() => onNavigate('Marketplace')}>
          <ShoppingBagIcon className="w-3.5 h-3.5" aria-hidden />
          <span>Goods</span>
        </button>
        <button type="button" className={btn(active === 'jobs')} onClick={() => onNavigate('MarketplaceJobs')}>
          <BriefcaseIcon className="w-3.5 h-3.5" aria-hidden />
          <span>Jobs</span>
        </button>
        <button
          type="button"
          className={btn(active === 'my_applications')}
          onClick={() => onNavigate('MyJobApplications')}
        >
          <DocumentTextIcon className="w-3.5 h-3.5" aria-hidden />
          <span className="hidden sm:inline">Applications</span>
          <span className="sm:hidden">Apps</span>
        </button>
        <button type="button" className={btn(active === 'my_jobs')} onClick={() => onNavigate('MyJobPostings')}>
          <span>My jobs</span>
        </button>
        <button type="button" className={btn(active === 'employer')} onClick={() => onNavigate('JobEmployer')}>
          <BuildingOffice2Icon className="w-3.5 h-3.5" aria-hidden />
          <span className="hidden sm:inline">Employer</span>
        </button>
      </div>
      {onPostJob ? (
        <button
          type="button"
          onClick={onPostJob}
          className="h-9 min-h-[44px] sm:h-8 sm:min-h-[36px] px-2.5 sm:px-3 rounded-lg bg-lantern-primary text-white text-xs sm:text-sm font-semibold inline-flex items-center gap-1"
        >
          <PlusIcon className="w-3.5 h-3.5" aria-hidden />
          Post job
        </button>
      ) : null}
    </div>
  );
}

export default JobsWorkspaceNav;
