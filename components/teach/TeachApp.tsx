import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { parseTeachPath, teachAdminPath, teachHomePath, teachNewClassPath } from '@lantern/shared/academic';
import { AcademicCapIcon, ArrowLeftIcon, BuildingLibraryIcon, PlusIcon } from '@heroicons/react/24/outline';
import { TeachHome } from './TeachHome';
import { TeachCreateClass } from './TeachCreateClass';
import { TeachClassPage } from './TeachClassPage';
import { TeachUniversityAdmin } from './TeachUniversityAdmin';

interface TeachAppProps {
  onLeave: () => void;
}

/**
 * Isolated lecturer portal. No student marketplace, jobs, campus social, or
 * gamification chrome — docs/phase-teach-portal-contract.md §5.
 */
export const TeachApp: React.FC<TeachAppProps> = ({ onLeave }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const parsed = parseTeachPath(location.pathname);

  let body: React.ReactNode = (
    <div className="p-8">
      <p className="text-body text-lantern-text-secondary">That teach page does not exist.</p>
      <button type="button" className="mt-3 text-body text-lantern-primary" onClick={() => navigate(teachHomePath())}>
        Back to classes
      </button>
    </div>
  );
  if (parsed.page === 'home') body = <TeachHome />;
  if (parsed.page === 'new') body = <TeachCreateClass />;
  if (parsed.page === 'admin') body = <TeachUniversityAdmin />;
  if (parsed.page === 'class' && parsed.classId) {
    body = <TeachClassPage classId={parsed.classId} tab={parsed.tab ?? 'roster'} />;
  }

  const navBtn = (active: boolean) =>
    `flex items-center gap-2 rounded-lantern px-3 py-2 text-body ${
      active ? 'bg-lantern-background-secondary text-lantern-text font-medium' : 'text-lantern-text-secondary hover:bg-lantern-background-secondary'
    }`;

  return (
    <div className="min-h-screen bg-lantern-background text-lantern-text flex flex-col md:flex-row">
      <aside className="shrink-0 border-b md:border-b-0 md:border-r border-lantern-border bg-lantern-surface md:w-56 p-3 flex md:flex-col gap-1">
        <p className="hidden md:block px-3 py-2 text-caption font-semibold tracking-wide text-lantern-text-secondary">
          Teach
        </p>
        <button type="button" className={navBtn(parsed.page === 'home' || parsed.page === 'class')} onClick={() => navigate(teachHomePath())}>
          <AcademicCapIcon className="h-5 w-5" />
          Classes
        </button>
        <button type="button" className={navBtn(parsed.page === 'new')} onClick={() => navigate(teachNewClassPath())}>
          <PlusIcon className="h-5 w-5" />
          New class
        </button>
        <button type="button" className={navBtn(parsed.page === 'admin')} onClick={() => navigate(teachAdminPath())}>
          <BuildingLibraryIcon className="h-5 w-5" />
          University
        </button>
        <button type="button" className={`${navBtn(false)} md:mt-auto`} onClick={onLeave}>
          <ArrowLeftIcon className="h-5 w-5" />
          Student app
        </button>
      </aside>
      <main className="flex-1 min-h-0 overflow-auto">{body}</main>
    </div>
  );
};

export default TeachApp;
