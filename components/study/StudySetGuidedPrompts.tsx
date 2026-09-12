import React from 'react';
import { studySetCompanionPrompts, type StudySetPathActivity } from '@lantern/shared';
import { AppIcon, type AppIconName } from '../ui/AppIcon';
import { FEATURE_INK_TEXT } from '../ui/featureClasses';

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
          // 44 px, the touch target every other control on this screen already
          // meets. It was 36 — under the minimum, on the one strip of controls
          // a thumb reaches for mid-session.
          className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full border border-lantern-border px-3 text-caption text-lantern-text-secondary hover:bg-lantern-background-secondary"
        >
          {prompt.icon ? (
            // 16 px, in the intent's ink: a chip that GOES somewhere is tinted
            // to its destination and a chip that ASKS is violet, so the strip
            // separates "navigate" from "spend a companion turn" without a
            // word of explanation. Decorative — the label says the same thing.
            <AppIcon
              name={prompt.icon as AppIconName}
              size={16}
              className={`shrink-0 ${prompt.feature ? FEATURE_INK_TEXT[prompt.feature] : ''}`}
              aria-hidden={true}
            />
          ) : null}
          {prompt.label}
        </button>
      ))}
    </div>
  );
};

export default StudySetGuidedPrompts;
