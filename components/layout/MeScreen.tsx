import React from 'react';
import { AppIcon, type AppIconName } from '../ui/AppIcon';
import { AppMode, type User } from '../../types';
import { Avatar } from '../ui';
import { resolveAvatarSrc } from '../../utils/avatar';
import { useLowDataModeToggle } from '../../hooks/useLowDataModeToggle';
import { usePlatformAdmin } from '../../hooks/usePlatformAdmin';
import { studyLevelLabel } from '@lantern/shared';

/**
 * Me — the fifth destination.
 *
 * It is ME and nothing else: who I am, the two things I keep about my own
 * account (Budget, Downloads), the two switches that change how the app treats
 * me (dark mode, low-data), Settings, and the way out. Nothing here is a
 * feature other people use; nothing that belongs to a feature lives here.
 *
 * Budget and Downloads used to be sidebar entries competing with the places a
 * student actually goes. "Downloads" is the name — the screen is the same one
 * that was called Offline Activity, which described a state rather than a place.
 */
export interface MeScreenProps {
  currentUser: User;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  onNavigate: (mode: AppMode) => void;
  onOpenTeach: () => void;
  onOpenSettings: () => void;
  onLogout: () => void;
  pendingSyncCount?: number;
}

const Row: React.FC<{
  icon: AppIconName;
  label: string;
  hint?: string;
  badge?: number;
  onClick: () => void;
  destructive?: boolean;
}> = ({ icon, label, hint, badge, onClick, destructive }) => (
  <button
    type="button"
    onClick={onClick}
    className={`flex w-full items-center gap-3 px-4 text-left transition-colors min-h-[52px] hover:bg-lantern-background-secondary focus:outline-none focus-visible:ring-2 focus-visible:ring-lantern-primary/40 ${
      destructive ? 'text-red-600 dark:text-red-400' : 'text-lantern-text'
    }`}
  >
    <AppIcon name={icon} size={20} className="shrink-0" />
    <span className="flex-1 min-w-0 text-body font-medium">{label}</span>
    {badge != null && badge > 0 ? (
      <span className="rounded-full bg-lantern-error-strong px-2 py-0.5 text-label tracking-normal text-white">
        {badge > 99 ? '99+' : badge}
      </span>
    ) : null}
    {hint ? <span className="text-caption text-lantern-text-secondary">{hint}</span> : null}
    {!destructive ? (
      <AppIcon name="chevron-forward" size={16} className="shrink-0 text-lantern-text-tertiary" />
    ) : null}
  </button>
);

const SwitchRow: React.FC<{
  icon: AppIconName;
  label: string;
  checked: boolean;
  onToggle: () => void;
}> = ({ icon, label, checked, onToggle }) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={label}
    onClick={onToggle}
    className="flex w-full items-center gap-3 px-4 text-left transition-colors min-h-[52px] text-lantern-text hover:bg-lantern-background-secondary focus:outline-none focus-visible:ring-2 focus-visible:ring-lantern-primary/40"
  >
    <AppIcon name={icon} size={20} className="shrink-0" />
    <span className="flex-1 min-w-0 text-body font-medium">{label}</span>
    {/* Never colour alone: the knob's position says on/off as well as the fill. */}
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
  currentUser,
  theme,
  onToggleTheme,
  onNavigate,
  onOpenTeach,
  onOpenSettings,
  onLogout,
  pendingSyncCount = 0,
}) => {
  const { lowDataMode, toggleLowDataMode } = useLowDataModeToggle();
  const isPlatformAdmin = usePlatformAdmin();

  const academicLine = [
    currentUser.institution?.name || null,
    currentUser.programme || null,
    currentUser.studyLevel != null ? studyLevelLabel(currentUser.studyLevel) : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-lantern-background">
      <div className="mx-auto w-full max-w-2xl pb-10">
        <div className="flex items-center gap-4 px-4 py-6">
          <Avatar
            name={currentUser.name}
            src={resolveAvatarSrc(currentUser.avatarUrl, lowDataMode)}
            size="lg"
            localOnly={lowDataMode}
          />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-title text-lantern-text">{currentUser.name}</h1>
            {currentUser.username ? (
              <p className="truncate text-caption text-lantern-text-secondary">@{currentUser.username}</p>
            ) : null}
            <p className="mt-0.5 text-caption text-lantern-text-secondary">
              {currentUser.points} points
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={onOpenSettings}
          className="flex w-full items-center gap-3 border-y border-lantern-border bg-lantern-surface px-4 py-3 text-left hover:bg-lantern-background-secondary focus:outline-none focus-visible:ring-2 focus-visible:ring-lantern-primary/40"
        >
          <AppIcon name="school" size={20} className="shrink-0 text-lantern-text-secondary" />
          <span className="min-w-0 flex-1">
            <span className="block text-body font-medium text-lantern-text">Academic details</span>
            <span className="block truncate text-caption text-lantern-text-secondary">
              {academicLine || 'Add your campus, programme and level'}
            </span>
          </span>
          <AppIcon name="chevron-forward" size={16} className="shrink-0 text-lantern-text-tertiary" />
        </button>

        <div className="mt-4 divide-y divide-lantern-border border-y border-lantern-border bg-lantern-surface">
          <Row
            icon="people"
            label="Teach"
            hint="Classes, roster, join codes"
            onClick={onOpenTeach}
          />
          <Row
            icon="cash"
            label="Budget"
            onClick={() => onNavigate(AppMode.BUDGET_TRACKER)}
          />
          <Row
            icon="cloud-download"
            label="Downloads"
            badge={pendingSyncCount}
            onClick={() => onNavigate(AppMode.OFFLINE_MODE)}
          />
          <Row
            icon="gift"
            label="Invite friends"
            onClick={() => onNavigate(AppMode.INVITE_FRIENDS)}
          />
        </div>

        <div className="mt-4 divide-y divide-lantern-border border-y border-lantern-border bg-lantern-surface">
          <SwitchRow
            icon={theme === 'dark' ? 'sunny' : 'moon'}
            label="Dark mode"
            checked={theme === 'dark'}
            onToggle={onToggleTheme}
          />
          <SwitchRow
            icon={lowDataMode ? 'cellular-off' : 'cellular'}
            label="Low-data mode"
            checked={lowDataMode}
            onToggle={toggleLowDataMode}
          />
        </div>

        <div className="mt-4 divide-y divide-lantern-border border-y border-lantern-border bg-lantern-surface">
          <Row icon="settings" label="Settings" onClick={onOpenSettings} />
          {isPlatformAdmin ? (
            <Row icon="people" label="Admin console" onClick={() => onNavigate(AppMode.ADMIN)} />
          ) : null}
          <Row
            icon="log-out"
            label="Log out"
            destructive
            onClick={onLogout}
          />
        </div>
      </div>
    </div>
  );
};

export default MeScreen;
