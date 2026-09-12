import React from 'react';
import { primaryHomeAction, resumeGreeting, studySetLabel } from '@lantern/shared';
import { pluralize } from '@lantern/shared/utils/plural';
import { Button } from '../ui';
import type { TestSessionData, StudySessionData } from '../../types';
import { AppIcon } from '../ui/AppIcon';
import { useStudyResumeStore } from '../../stores/studyResumeStore';
import { useStudySetStore } from '../../stores/studySetStore';

interface DashboardHeroProps {
  userName: string;
  dueCardsCount: number;
  totalTestsTaken: number;
  onPrimaryAction: () => void;
  activeTestSession?: TestSessionData | null;
  activeStudySession?: StudySessionData | null;
  onResumeSession?: () => void;
}

export const DashboardHero: React.FC<DashboardHeroProps> = ({
  userName,
  dueCardsCount,
  totalTestsTaken,
  onPrimaryAction,
  activeTestSession,
  activeStudySession,
  onResumeSession,
}) => {
  const lastActivity = useStudyResumeStore((s) => s.lastActivity);
  const lastSet = useStudySetStore((s) =>
    s.lastOpenedId ? s.resolveSet(s.lastOpenedId) : s.sets[0] ?? null
  );
  const greeting = (() => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
  })();

  // Label and destination come from one call (`primaryHomeAction`), which the
  // screen's `onPrimaryAction` reads too — a button that says "Continue"
  // therefore cannot land somewhere else.
  const primaryActionLabel = primaryHomeAction({ dueCardsCount, lastActivity }).label;
  const resumeLine = resumeGreeting(lastActivity, lastSet ? studySetLabel(lastSet) : undefined);

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1
          className="font-display text-title md:text-display font-semibold tracking-tight text-lantern-text break-words"
          title={`${greeting}, ${userName}`}
        >
          {greeting},{' '}
          <span className="inline-block max-w-full align-bottom truncate">{userName}</span>
        </h1>
        <p className="text-lantern-text-secondary mt-1.5 text-body leading-relaxed">
          {dueCardsCount > 0
            ? `${pluralize(dueCardsCount, 'card')} ready to review.`
            : resumeLine}
        </p>
      </div>
      <div className="flex flex-col sm:flex-row gap-2 shrink-0">
        <Button size="lg" onClick={onPrimaryAction}>
          <AppIcon name="school" size={20} />
          {primaryActionLabel}
        </Button>
        {(activeTestSession || activeStudySession) && onResumeSession && (
          <Button variant="accent" size="lg" onClick={onResumeSession}>
            <AppIcon name="play" size={20} filled />
            Resume session
          </Button>
        )}
      </div>
    </div>
  );
};

export default DashboardHero;
