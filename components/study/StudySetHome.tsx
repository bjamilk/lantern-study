import React from 'react';
import {
  STUDY_SET_HOME_PRIMARY_TOOL_IDS,
  STUDY_SET_HOME_TOOLS,
  formatCourseMaterialCounts,
  type StudySetHomeTool,
  type StudySetHomeToolId,
} from '@lantern/shared';
import type { StudyNote } from '../../types';
import { AppIcon } from '../ui/AppIcon';
import { Button, Card, FeatureDisc, Illustration } from '../ui';
import { FEATURE_INK_TEXT, FEATURE_TINT_BG } from '../ui/featureClasses';

interface StudySetHomeProps {
  setLabel: string;
  notes: StudyNote[];
  deckCount: number;
  testCount: number;
  recommended?: StudyNote | null;
  onTool: (tool: StudySetHomeTool) => void;
  onOpenNote: (noteId: string) => void;
  onOpenRecommended: (kind: 'read' | 'quiz' | 'lesson') => void;
}

export const StudySetHome: React.FC<StudySetHomeProps> = ({
  setLabel,
  notes,
  deckCount,
  testCount,
  recommended,
  onTool,
  onOpenNote,
  onOpenRecommended,
}) => {
  const primary = STUDY_SET_HOME_TOOLS.filter((tool) =>
    STUDY_SET_HOME_PRIMARY_TOOL_IDS.includes(tool.id)
  );
  const more = STUDY_SET_HOME_TOOLS.filter(
    (tool) => !STUDY_SET_HOME_PRIMARY_TOOL_IDS.includes(tool.id)
  );
  const counts = formatCourseMaterialCounts({
    notes: notes.length,
    decks: deckCount,
    tests: testCount,
  });

  return (
    <div className="flex-1 min-h-0 overflow-y-auto space-y-6 pr-1">
      <div>
        <p className="text-caption text-lantern-text-secondary">{counts}</p>
        <p className="text-body text-lantern-text-secondary mt-1">
          Everything you study in {setLabel} stays in this set.
        </p>
      </div>

      {recommended ? (
        <Card padding="md">
          <p className="text-label uppercase text-lantern-text-secondary mb-1">
            Continue from this set
          </p>
          <h3 className="text-heading text-lantern-text mb-2 truncate">
            {recommended.title || 'Untitled note'}
          </h3>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => onOpenRecommended('read')}>
              Read
            </Button>
            <Button size="sm" variant="secondary" onClick={() => onOpenRecommended('quiz')}>
              Quiz
            </Button>
            <Button size="sm" variant="secondary" onClick={() => onOpenRecommended('lesson')}>
              Tutor
            </Button>
          </div>
        </Card>
      ) : (
        <div className="flex items-center gap-3">
          <Illustration name="import-tray" feature="notes" size={32} />
          <p className="text-body text-lantern-text-secondary">
            Import a PDF or start a note. Quizzes, cards, lectures and games stay here.
          </p>
        </div>
      )}

      <section>
        <h2 className="text-heading text-lantern-text mb-3">Start learning your own way</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {primary.map((tool) => (
            <ToolPill key={tool.id} tool={tool} onClick={() => onTool(tool)} />
          ))}
        </div>
        <div className="flex flex-wrap gap-2 mt-3">
          {more.map((tool) => (
            <ToolPill key={tool.id} tool={tool} compact onClick={() => onTool(tool)} />
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-heading text-lantern-text mb-3">Recent materials</h2>
        {notes.length === 0 ? (
          <p className="text-body text-lantern-text-secondary">
            Nothing filed in this set yet.
          </p>
        ) : (
          <div className="space-y-2">
            {notes.slice(0, 8).map((note) => (
              <button
                key={note.id}
                type="button"
                onClick={() => onOpenNote(note.id)}
                className="w-full flex items-center gap-3 p-3 rounded-xl border border-lantern-border bg-lantern-surface text-left hover:bg-lantern-background-secondary"
              >
                <FeatureDisc feature="notes" icon={<AppIcon name="document-text" size={20} />} />
                <span className="text-body font-semibold truncate">
                  {note.title || 'Untitled note'}
                </span>
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  );
};

function toolById(id: StudySetHomeToolId): StudySetHomeTool {
  return STUDY_SET_HOME_TOOLS.find((tool) => tool.id === id) ?? STUDY_SET_HOME_TOOLS[0];
}

function ToolPill({
  tool,
  compact,
  onClick,
}: {
  tool: StudySetHomeTool;
  compact?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={tool.promise}
      className={`inline-flex min-h-[44px] items-center gap-2 rounded-full border border-lantern-border bg-lantern-surface px-3 text-left hover:border-lantern-text-tertiary ${
        compact ? 'text-caption' : 'w-full text-body font-medium px-4 py-3'
      }`}
    >
      <span
        className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${FEATURE_TINT_BG[tool.feature]} ${FEATURE_INK_TEXT[tool.feature]}`}
      >
        <AppIcon name={tool.icon} size={16} />
      </span>
      {tool.label}
    </button>
  );
}

export default StudySetHome;
