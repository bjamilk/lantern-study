import React from 'react';
import type { PausedSessionSummary } from '../types';
import { Button, Card } from './ui';
import { AppIcon } from './ui/AppIcon';

interface SavedSessionsListProps {
  sessions: PausedSessionSummary[];
  onResume: (sessionId: string) => void;
  onDiscard: (sessionId: string) => void;
  compact?: boolean;
}

function formatUpdatedAt(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

const SavedSessionsList: React.FC<SavedSessionsListProps> = ({
  sessions,
  onResume,
  onDiscard,
  compact = false,
}) => {
  if (!sessions.length) return null;

  return (
    <Card padding={compact ? 'md' : 'lg'}>
      <div className="flex items-center gap-2 mb-3">
        <div className="p-2 rounded-lg bg-amber-100 dark:bg-amber-900/40 text-amber-600">
          <AppIcon name="time" size={20} />
        </div>
        <div>
          <h3 className="text-heading text-lantern-text">
            Saved sessions ({sessions.length})
          </h3>
          <p className="text-sm text-lantern-text-secondary">
            Pause anytime — pick up where you left off after refresh
          </p>
        </div>
      </div>
      <ul className="space-y-2">
        {sessions.map((session) => (
          <li
            key={session.id}
            className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 rounded-lg border border-lantern-border bg-lantern-background-secondary/40 px-3 py-2.5"
          >
            <div className="min-w-0">
              <p className="font-medium text-lantern-text truncate">
                {session.title}
                <span className="ml-2 text-xs font-normal text-lantern-text-tertiary">
                  {session.sessionKind === 'study' ? 'Study' : 'Test'}
                  {session.status === 'paused' ? ' · Paused' : ' · In progress'}
                </span>
              </p>
              <p className="text-xs text-lantern-text-secondary mt-0.5">
                {session.answeredCount}/{session.totalQuestions} answered
                {session.remainingTimeSeconds != null
                  ? ` · ${Math.ceil(session.remainingTimeSeconds / 60)} min left`
                  : ''}
                {session.updatedAt ? ` · ${formatUpdatedAt(session.updatedAt)}` : ''}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Button
                size="sm"
                variant="secondary"
                onClick={() => onDiscard(session.id)}
                aria-label={`Discard ${session.title}`}
              >
                <AppIcon name="trash" size={16} />
                Discard
              </Button>
              <Button size="sm" variant="accent" onClick={() => onResume(session.id)}>
                <AppIcon name="play" size={16} />
                Resume
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
};

export default SavedSessionsList;
