import React from 'react';
import { studySetCompanionPrompts, type StudySetPathActivity } from '@lantern/shared';

interface StudySetGuidedPromptsProps {
  activity: StudySetPathActivity;
  onAsk: (message: string) => void;
  onGo: (activity: StudySetPathActivity) => void;
}

export const StudySetGuidedPrompts: React.FC<StudySetGuidedPromptsProps> = ({
  activity,
  onAsk,
  onGo,
}) => {
  const prompts = studySetCompanionPrompts(activity);
  return (
    <div className="flex flex-wrap gap-1.5 p-2 border-b border-lantern-border">
      {prompts.map((prompt) => (
        <button
          key={prompt.id}
          type="button"
          onClick={() => {
            if (prompt.go) onGo(prompt.go);
            if (prompt.ask) onAsk(prompt.ask);
          }}
          className="min-h-[36px] rounded-full border border-lantern-border px-2.5 text-caption text-lantern-text-secondary hover:bg-lantern-background-secondary"
        >
          {prompt.label}
        </button>
      ))}
    </div>
  );
};

export default StudySetGuidedPrompts;
