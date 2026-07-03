import React from 'react';
import { FireIcon, SparklesIcon, AcademicCapIcon, PlayIcon } from '@heroicons/react/24/solid';
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
  primaryActionLabel: string;
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
  primaryActionLabel,
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

  return (
    <div className="px-4 md:px-8 py-6">
      <div className="max-w-6xl mx-auto">
        <Card className={`${lowDataMode ? 'border-l-4 border-l-lantern-accent' : 'border-l-4 border-l-lantern-primary bg-gradient-to-br from-lantern-primary/5 to-lantern-accent/5'}`} padding="lg">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <h1 className="text-2xl md:text-3xl font-bold text-lantern-text">
                {greeting}, {userName.split(' ')[0]}!
              </h1>
              <p className="text-lantern-text-secondary mt-1 text-sm md:text-base">
                {dueCardsCount > 0
                  ? `${dueCardsCount} flashcard${dueCardsCount !== 1 ? 's' : ''} due for review.`
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
            <Button size="lg" onClick={onPrimaryAction} className="sm:flex-1 max-w-md">
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
              <span className="text-sm font-bold text-lantern-text">
                Level {xpLevel} — {xpTitle}
              </span>
              <span className="text-xs text-lantern-text-secondary">
                {pointsToNextLevel > 0 ? `${pointsToNextLevel.toLocaleString()} XP to next level` : 'Max level'}
              </span>
            </div>
            <div className="w-full bg-lantern-background-secondary rounded-full h-2.5 overflow-hidden">
              <div className="h-full rounded-full bg-lantern-primary transition-all duration-700" style={{ width: `${xpProgressPercent}%` }} />
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
};

export default DashboardHero;
