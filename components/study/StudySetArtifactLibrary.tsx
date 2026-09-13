import React from 'react';
import { notePreviewText } from '@lantern/shared';
import { FeatureDisc } from '../ui';
import { AppIcon } from '../ui/AppIcon';
import { FEATURE_PANEL_INK_TEXT, FEATURE_TINT_BG } from '../ui/featureClasses';

export interface ArtifactCard {
  id: string;
  title: string;
  preview?: string | null;
  meta?: string;
  feature: 'tests' | 'flashcards' | 'ai';
  icon: 'clipboard' | 'layers' | 'headphones' | 'school';
}

interface StudySetArtifactLibraryProps {
  title: string;
  empty: string;
  items: ArtifactCard[];
  onOpen: (id: string) => void;
  onCreate?: () => void;
  createLabel?: string;
  folders?: Array<{ id: string; title: string }>;
  onOpenFolder?: (id: string) => void;
  /**
   * Optional per-tile overflow menu (the ⋮ a deck tile needs for its cover).
   * It is rendered BESIDE the tile's button, not inside it: a <button> may not
   * contain another button, and nesting one makes the menu trigger unreachable
   * for a keyboard and unclickable without also firing "open".
   */
  renderItemMenu?: (item: ArtifactCard) => React.ReactNode;
}

export const StudySetArtifactLibrary: React.FC<StudySetArtifactLibraryProps> = ({
  title,
  empty,
  items,
  onOpen,
  onCreate,
  createLabel = '+ New',
  folders = [],
  onOpenFolder,
  renderItemMenu,
}) => {
  return (
    <div className="flex-1 min-h-0 overflow-y-auto space-y-3">
      <h2 className="text-heading">{title}</h2>
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
        {onCreate ? (
          <button
            type="button"
            onClick={onCreate}
            className="min-h-[11rem] rounded-2xl border border-dashed border-lantern-border bg-lantern-surface text-left px-4 py-4 hover:bg-lantern-background-secondary"
          >
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-lantern-background-secondary">
              <AppIcon name="add" size={18} />
            </span>
            <span className="mt-4 block text-body font-semibold">{createLabel}</span>
          </button>
        ) : null}
        {folders.map((folder) => (
          <button
            key={folder.id}
            type="button"
            onClick={() => onOpenFolder?.(folder.id)}
            className="min-h-[11rem] rounded-2xl border border-lantern-border bg-lantern-surface text-left px-4 py-4 hover:bg-lantern-background-secondary"
          >
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-lantern-background-secondary">
              <AppIcon name="folder" size={18} />
            </span>
            <span className="mt-4 block text-body font-semibold truncate">{folder.title}</span>
            <span className="block text-caption text-lantern-text-secondary">Folder</span>
          </button>
        ))}
        {items.map((item) => {
          const preview = item.preview ? notePreviewText(item.preview, 140) : '';
          const menu = renderItemMenu?.(item);
          return (
            <div key={item.id} className="relative">
            <button
              type="button"
              onClick={() => onOpen(item.id)}
              className="w-full min-h-[11rem] rounded-2xl border border-lantern-border bg-lantern-surface text-left overflow-hidden hover:bg-lantern-background-secondary"
            >
              {/* The panel is the item's OWN hue. It used to be a three-arm
                  ternary over `ai`/`tests`/everything-else, whose first arm
                  re-derived `ai` from the icon and whose last arm painted a
                  recap, a lesson, an essay and a plan all in the flashcards
                  green — four different objects wearing the fifth one's
                  colour. `item.feature` was right there the whole time. */}
              <div className={`h-24 px-3 py-3 ${FEATURE_TINT_BG[item.feature]}`}>
                {item.feature === 'tests' && preview ? (
                  <p className="text-caption text-lantern-text line-clamp-4">{preview}</p>
                ) : (
                  <span
                    aria-hidden="true"
                    className={`inline-flex h-10 w-10 items-center justify-center rounded-[14px] bg-lantern-surface ${FEATURE_PANEL_INK_TEXT[item.feature]}`}
                  >
                    <AppIcon name={item.icon} size={18} />
                  </span>
                )}
              </div>
              <div className="flex items-start gap-2 px-3 py-3">
                <FeatureDisc size={24} feature={item.feature} icon={<AppIcon name={item.icon} size={14} />} />
                <span className="min-w-0 flex-1">
                  <span className="block text-body font-semibold truncate">{item.title}</span>
                  {item.feature !== 'tests' && preview ? (
                    <span className="mt-1 block text-caption text-lantern-text-secondary line-clamp-2">
                      {preview}
                    </span>
                  ) : null}
                  {item.meta ? (
                    <span className="mt-1 block text-caption text-lantern-text-tertiary">{item.meta}</span>
                  ) : null}
                </span>
              </div>
            </button>
            {menu ? <div className="absolute right-2 top-2">{menu}</div> : null}
            </div>
          );
        })}
      </div>
      {items.length === 0 && !onCreate ? (
        <p className="text-body text-lantern-text-secondary">{empty}</p>
      ) : null}
    </div>
  );
};

export default StudySetArtifactLibrary;
