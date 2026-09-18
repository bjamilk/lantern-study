/**
 * The companion header's tutor-style picker (F2).
 *
 * A 32×32 icon button beside the thread menu, opening the shared `Menu` with
 * the four styles from `@lantern/shared/ai` — icon, label, one-line
 * description, and a check on the one in force.
 *
 * Its own component rather than JSX inside `AICompanionPanel` for the reason
 * the wave-4 header note gives: the panel cannot be mounted in a test (it drags
 * the AI service, four stores, the markdown renderer and MediaRecorder in), so
 * anything built inside it can only be asserted by reading the source.
 * `TutorStylePicker.render.test.tsx` mounts THIS and clicks it.
 *
 * Honesty: the copy promises a voice and a method, never knowledge or accuracy.
 * All four run the same model on the same context for the same credit, and
 * `TUTOR_STYLE_HONESTY_NOTE` says so under the options. The panel's own AI
 * disclaimer is untouched and still sits under the composer.
 *
 * Gotchas:
 *  - A pick applies to the NEXT message. It does not re-answer anything
 *    already on screen, and the panel says so in the header chip rather than in
 *    a toast that would be gone before the student sent anything.
 *  - Controlled: this component holds no style state of its own. The value
 *    comes from the account's settings and the change goes back through
 *    `utils/tutorStyle.ts`, so a second panel (drawer + docked rail) agrees.
 */
import React from 'react';
import {
  TUTOR_STYLES,
  TUTOR_STYLE_HONESTY_NOTE,
  getTutorStyle,
  type TutorStyleId,
} from '@lantern/shared/ai';
import { AppIcon, isAppIconName, type AppIconName } from '../ui/AppIcon';
import { Menu, MenuContent, MenuItem, MenuTrigger } from '../ui/Menu';

/** The registry's icon names are plain strings on the shared side. */
const iconName = (name: string): AppIconName =>
  isAppIconName(name) ? name : 'sparkles';

export const TutorStylePicker: React.FC<{
  value: TutorStyleId;
  onChange: (styleId: TutorStyleId) => void;
  theme?: 'light' | 'dark';
  disabled?: boolean;
}> = ({ value, onChange, theme = 'light', disabled }) => {
  const active = getTutorStyle(value);

  return (
    <Menu>
      <MenuTrigger
        aria-label="Tutor style"
        title={`Tutor style: ${active.label}`}
        disabled={disabled}
        className={`min-h-[44px] min-w-[44px] flex items-center justify-center disabled:opacity-50 ${
          theme === 'dark' ? 'text-lantern-text-tertiary' : 'text-lantern-text-secondary'
        }`}
      >
        {/* 32×32 is what the control LOOKS like, matching the send button and
            the reference's header glyphs; the 44px target above it is what the
            finger gets, which is the rule every other control in this header
            keeps. Shrinking the target to the glyph would be the one
            regression an icon-only header cannot afford. */}
        <span
          className={`h-8 w-8 flex items-center justify-center rounded-lg transition-colors ${
            theme === 'dark'
              ? 'hover:bg-lantern-surface-secondary'
              : 'hover:bg-lantern-background-secondary'
          }`}
        >
          <AppIcon name={iconName(active.icon)} size={16} />
        </span>
      </MenuTrigger>
      <MenuContent align="end">
        {TUTOR_STYLES.map((style) => {
          const checked = style.id === active.id;
          return (
            <MenuItem
              key={style.id}
              role="menuitemradio"
              aria-checked={checked}
              onSelect={() => onChange(style.id)}
              icon={<AppIcon name={iconName(style.icon)} size={16} />}
              className="items-start"
            >
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="flex items-center gap-1.5">
                  <span className="font-medium">{style.label}</span>
                  {checked && (
                    <AppIcon
                      name="checkmark"
                      size={14}
                      aria-label="Current style"
                      className="text-lantern-feature-ai-ink"
                    />
                  )}
                </span>
                <span className="text-caption text-lantern-text-secondary">
                  {style.description}
                </span>
              </span>
            </MenuItem>
          );
        })}
        {/* The one claim the menu makes about itself, and the only honest one:
            a persona is a voice, not a better model. */}
        <p className="px-4 py-2 text-caption text-lantern-text-tertiary">
          {TUTOR_STYLE_HONESTY_NOTE}
        </p>
      </MenuContent>
    </Menu>
  );
};

export default TutorStylePicker;
