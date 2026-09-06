import React from 'react';
import { FireIcon, SparklesIcon, AcademicCapIcon, PlayIcon } from '@heroicons/react/24/solid';
import { getStudyAllDueLabel } from '@lantern/shared';
import { Card, Button, StatPill } from '../ui';
import type { TestSessionData, StudySessionData } from '../../types';

interface DashboardHeroProps {
  userName: string;
  streak: number;
  points: number;
  xpLevel: number;
  xpTitle: string;
  xpProgressPercent: number;
  pointsToNextLevel: number;
  dueCardsCount: number;
  totalTestsTaken: number;
  onPrimaryAction: () => void;
  activeTestSession?: TestSessionData | null;
  activeStudySession?: StudySessionData | null;
  onResumeSession?: () => void;
  lowDataMode?: boolean;
}

export const DashboardHero: React.FC<DashboardHeroProps> = ({
  userName,
  streak,
  points,
  xpLevel,
  xpTitle,
  xpProgressPercent,
  pointsToNextLevel,
  dueCardsCount,
  totalTestsTaken,
  onPrimaryAction,
  activeTestSession,
  activeStudySession,
  onResumeSession,
  lowDataMode,
}) => {
  const greeting = (() => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
  })();

  const primaryActionLabel =
    dueCardsCount > 0 ? getStudyAllDueLabel(dueCardsCount) : 'Import & study';

  return (
    <Card
      // Plain surface: no accent rail, no gradient fill.
      className="h-full"
      padding="lg"
      variant="elevated"
    >
      <div className="flex flex-col gap-4">
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
              ? `${dueCardsCount} card${dueCardsCount !== 1 ? 's' : ''} ready to review.`
              : totalTestsTaken > 0
                ? `You've completed ${totalTestsTaken} test${totalTestsTaken !== 1 ? 's' : ''}. What's next?`
                : 'Import material or review flashcards to get started.'}
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <StatPill label="Streak" value={`${streak}d`} accent="accent" icon={<FireIcon className="w-4 h-4" />} />
          <StatPill label="Points" value={points.toLocaleString()} accent="primary" icon={<SparklesIcon className="w-4 h-4" />} />
        </div>
      </div>

      <div className="mt-4 flex flex-col sm:flex-row gap-3">
        <Button size="lg" onClick={onPrimaryAction} className="sm:flex-1 sm:max-w-sm">
          <AcademicCapIcon className="w-5 h-5" />
          {primaryActionLabel}
        </Button>
        {(activeTestSession || activeStudySession) && onResumeSession && (
          <Button variant="accent" size="lg" onClick={onResumeSession}>
            <PlayIcon className="w-5 h-5" />
            Resume session
          </Button>
        )}
      </div>

      <div className="mt-4 pt-4 border-t border-lantern-border">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-body font-bold tabular-nums text-lantern-text">
            Level {xpLevel} — {xpTitle}
          </span>
          <span className="text-caption text-lantern-text-secondary">
            {pointsToNextLevel > 0 ? `${pointsToNextLevel.toLocaleString()} XP to next level` : 'Max level'}
          </span>
        </div>
        <div className="w-full bg-lantern-background-secondary rounded-full h-2.5 overflow-hidden">
          <div className="h-full rounded-full bg-lantern-primary-fill transition-all duration-700" style={{ width: `${xpProgressPercent}%` }} />
        </div>
      </div>
    </Card>
  );
};

export default DashboardHero;
