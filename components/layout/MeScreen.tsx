import React, { useState } from 'react';
import { buildMeSections, type MeAreaSection, type MeRow, type MeRowId } from '@lantern/shared';
import { studyLevelLabel } from '@lantern/shared';
import { AppIcon } from '../ui/AppIcon';
import { FeatureDisc } from '../ui/FeatureDisc';
import { AppMode, type User } from '../../types';
import { Avatar } from '../ui';
import { Modal } from '../ui/Modal';
import { JoinClassCard } from '../classes/JoinClassCard';
import { resolveAvatarSrc } from '../../utils/avatar';
import { useLowDataModeToggle } from '../../hooks/useLowDataModeToggle';
import { usePlatformAdmin } from '../../hooks/usePlatformAdmin';
import { MeWorkspaceBar } from './MeWorkspaceBar';

export type SettingsDeepLink = 'profile' | 'academic' | 'usage';

/**
 * Profile — the fifth destination's account half. Progress is the peer tab.
 */
export interface MeScreenProps {
  section: MeAreaSection;
  onSelectSection: (section: MeAreaSection) => void;
  currentUser: User;
  onNavigate: (mode: AppMode) => void;
  onOpenTeach: () => void;
  onOpenSettings: (tab?: SettingsDeepLink) => void;
  onLogout: () => void;
  pendingSyncCount?: number;
  progress?: React.ReactNode;
}

const Row: React.FC<{
  row: MeRow;
  badge?: number;
  onClick: () => void;
}> = ({ row, badge, onClick }) => {
  const destructive = row.kind === 'destructive';
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-3 px-4 py-3 text-left transition-colors min-h-[52px] hover:bg-lantern-background-secondary focus:outline-none focus-visible:ring-2 focus-visible:ring-lantern-primary/40 ${
        destructive ? 'text-red-600 dark:text-red-400' : 'text-lantern-text'
      }`}
    >
      {row.feature ? (
        <FeatureDisc
          feature={row.feature}
          icon={<AppIcon name={row.icon} size={16} />}
          size={32}
        />
      ) : (
        <AppIcon name={row.icon} size={20} className="shrink-0" />
      )}
      <span className="flex-1 min-w-0">
        <span className="block text-body font-medium">{row.label}</span>
        {row.hint ? (
          <span className="block text-caption text-lantern-text-secondary mt-0.5">{row.hint}</span>
        ) : null}
      </span>
      {badge != null && badge > 0 ? (
        <span className="rounded-full bg-lantern-error-strong px-2 py-0.5 text-label tracking-normal text-white">
          {badge > 99 ? '99+' : badge}
        </span>
      ) : null}
      {!destructive ? (
        <AppIcon name="chevron-forward" size={16} className="shrink-0 text-lantern-text-tertiary" />
      ) : null}
    </button>
  );
};

const SwitchRow: React.FC<{
  row: MeRow;
  checked: boolean;
  onToggle: () => void;
}> = ({ row, checked, onToggle }) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={row.accessibilityLabel}
    onClick={onToggle}
    className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors min-h-[52px] text-lantern-text hover:bg-lantern-background-secondary focus:outline-none focus-visible:ring-2 focus-visible:ring-lantern-primary/40"
  >
    <AppIcon name={row.icon} size={20} className="shrink-0" />
    <span className="flex-1 min-w-0">
      <span className="block text-body font-medium">{row.label}</span>
      {row.hint ? (
        <span className="block text-caption text-lantern-text-secondary mt-0.5">{row.hint}</span>
      ) : null}
    </span>
    <span
      aria-hidden="true"
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
        checked ? 'bg-lantern-primary-fill' : 'bg-lantern-border'
      }`}
    >
      <span
        className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
          checked ? 'left-[1.375rem]' : 'left-0.5'
        }`}
      />
    </span>
    <span className="w-7 shrink-0 text-right text-caption font-semibold tabular-nums text-lantern-text-secondary">
      {checked ? 'On' : 'Off'}
    </span>
  </button>
);

const MeScreen: React.FC<MeScreenProps> = ({
  section,
  onSelectSection,
  currentUser,
  onNavigate,
  onOpenTeach,
  onOpenSettings,
  onLogout,
  pendingSyncCount = 0,
  progress,
}) => {
  const { lowDataMode } = useLowDataModeToggle();
  const isPlatformAdmin = usePlatformAdmin();
  const [joinOpen, setJoinOpen] = useState(false);

  const academicLine = [
    currentUser.institution?.name || null,
    currentUser.programme || null,
    currentUser.studyLevel != null ? studyLevelLabel(currentUser.studyLevel) : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const sections = buildMeSections({ includeAdmin: isPlatformAdmin });

  const onRow = (id: MeRowId) => {
    switch (id) {
      case 'academic':
        onOpenSettings('academic');
        return;
      case 'joinClass':
        setJoinOpen(true);
        return;
      case 'budget':
        onNavigate(AppMode.BUDGET_TRACKER);
        return;
      case 'downloads':
        onNavigate(AppMode.OFFLINE_MODE);
        return;
      case 'credits':
        onOpenSettings('usage');
        return;
      case 'teach':
        onOpenTeach();
        return;
      case 'invite':
        onNavigate(AppMode.INVITE_FRIENDS);
        return;
      case 'settings':
        onOpenSettings();
        return;
      case 'admin':
        onNavigate(AppMode.ADMIN);
        return;
      case 'logout':
        onLogout();
        return;
    }
  };

  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-lantern-background">
      <MeWorkspaceBar active={section} onSelect={onSelectSection} />
      {section === 'progress' ? (
        <div className="mx-auto w-full max-w-4xl px-4 md:px-6 pb-10 pt-4">{progress}</div>
      ) : (
        <div className="mx-auto w-full max-w-4xl px-4 md:px-6 pb-10">
          <button
            type="button"
            onClick={() => onOpenSettings('profile')}
            className="flex w-full items-center gap-4 py-6 text-left rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-lantern-primary/40"
            aria-label={`Edit profile, ${currentUser.name}`}
          >
            <Avatar
              name={currentUser.name}
              id={currentUser.id}
              src={resolveAvatarSrc(currentUser.avatarUrl, lowDataMode)}
              size="lg"
              localOnly={lowDataMode}
            />
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-title text-lantern-text">{currentUser.name}</h1>
              {currentUser.username ? (
                <p className="truncate text-caption text-lantern-text-secondary">@{currentUser.username}</p>
              ) : null}
              <p className="mt-0.5 truncate text-caption text-lantern-text-secondary">
                {academicLine || 'Add your campus, programme and level'}
              </p>
              <p className="mt-0.5 text-caption text-lantern-text-secondary">
                {currentUser.points} points
              </p>
              <p className="mt-0.5 text-caption font-medium text-lantern-primary">Edit profile</p>
            </div>
            <AppIcon name="chevron-forward" size={16} className="shrink-0 text-lantern-text-tertiary" />
          </button>

          {sections.map((block) => (
            <div
              key={block.id}
              className="mt-4 divide-y divide-lantern-border border-y border-lantern-border bg-lantern-surface"
            >
              {block.rows.map((row) =>
                row.kind === 'switch' ? (
                  <SwitchRow
                    key={row.id}
                    row={row}
                    checked={row.value === true}
                    onToggle={() => onRow(row.id)}
                  />
                ) : (
                  <Row
                    key={row.id}
                    row={row}
                    badge={row.id === 'downloads' ? pendingSyncCount : undefined}
                    onClick={() => onRow(row.id)}
                  />
                )
              )}
            </div>
          ))}
        </div>
      )}

      <Modal
        isOpen={joinOpen}
        onClose={() => setJoinOpen(false)}
        ariaLabelledBy="join-class-title"
      >
        <div className="p-4">
          <h2 id="join-class-title" className="text-heading font-semibold text-lantern-text mb-3">
            Join a class
          </h2>
          <JoinClassCard onJoined={() => setJoinOpen(false)} />
        </div>
      </Modal>
    </div>
  );
};

export default MeScreen;
