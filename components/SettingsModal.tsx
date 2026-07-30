

import React, { useState, useEffect, useRef } from 'react';
import { useToastStore } from '../stores/toastStore';
import { useUIStore } from '../stores/uiStore';
import { User } from '../types';
import { 
    XCircleIcon, UserCircleIcon, BellIcon, ShieldExclamationIcon, 
    EyeIcon, EyeSlashIcon, ArrowRightOnRectangleIcon, TrashIcon,
    CameraIcon, AcademicCapIcon, PaintBrushIcon, LifebuoyIcon,
    AdjustmentsHorizontalIcon, ShoppingBagIcon,
} from '@heroicons/react/24/outline';
import { compressImage } from '../utils/imageCompression';
import { useLowDataModeToggle } from '../hooks/useLowDataModeToggle';
import { Avatar, Button, Toggle, Tabs, TabList, Tab, TabPanel } from './ui';
import { syncCopy } from '@lantern/shared/design';
import { LEGAL_PATHS, MARKETPLACE_COMPLIANCE_BANNER } from '@lantern/shared';
import { fetchMarketplaceCampuses, uploadProfileAvatar } from '../services/supabase';
import { CampusSearchSelect } from './marketplace/CampusSearchSelect';
import { isOtherCityCampus } from '@lantern/shared/marketplace';
import { CloudArrowDownIcon, CloudArrowUpIcon } from '@heroicons/react/24/outline';
import {
    type UserSettings,
    formatReminderTime,
    SETTINGS_FAQ,
} from '@lantern/shared/settings';
import { ACCOUNT_EXPORT_COPY } from '@lantern/shared';
import { AccountDeletionModal } from './AccountDeletionModal';
import { AccountImportModal } from './AccountImportModal';
import { ContactForm } from './ContactForm';
import { openCookiePreferenceCenter } from './CookieNoticeBanner';
import Modal from './ui/Modal';
import { useFeatureTipStore } from '../stores/featureTipStore';

type SettingsTab =
    | 'profile'
    | 'notifications'
    | 'study'
    | 'appearance'
    | 'privacy'
    | 'marketplace'
    | 'dataSync'
    | 'support'
    | 'account';

type StudyDraft = {
    dailyCardGoal: string;
    dailyTestGoal: string;
    srsNewCardsPerDay: string;
    srsMaxInterval: string;
};

function studyToDraft(study: UserSettings['study']): StudyDraft {
    return {
        dailyCardGoal: String(study.dailyCardGoal ?? ''),
        dailyTestGoal: String(study.dailyTestGoal ?? ''),
        srsNewCardsPerDay: String(study.srsNewCardsPerDay ?? ''),
        srsMaxInterval: String(study.srsMaxInterval ?? ''),
    };
}

function parseStudyNumber(raw: string, fallback: number, min: number, max: number): number {
    const trimmed = String(raw ?? '').trim();
    if (trimmed === '') return fallback;
    const n = Number(trimmed);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
}

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: User;
  userSettings: UserSettings;
  onUpdateSettingsCategory: <K extends keyof UserSettings>(
    category: K,
    updates: Partial<UserSettings[K]>
  ) => void;
  onUpdateProfile: (name: string, phone: string) => void | Promise<boolean>;
  onUpdateAvatar: (avatarUrl: string) => void;
  onUpdatePassword: (current: string, newPass: string) => boolean | Promise<boolean>;
  onLogout: () => void;
  onPauseAccount: () => Promise<void>;
  onDeleteAccountImmediate: (password: string) => Promise<void>;
  onImportAccount: (payload: {
    exportDoc: Record<string, unknown>;
    password: string;
    confirmEmailMismatch: boolean;
  }) => Promise<{ noteFolders: number; notes: number; decks: number; flashcards: number } | void>;
  onExportAccount: () => void | Promise<void>;
  onResetSettings: () => void;
}

const ToggleSwitch = ({ enabled, onChange, label, description }: {
    enabled: boolean;
    onChange: (enabled: boolean) => void;
    label: string;
    description: string;
}) => (
    <Toggle checked={enabled} onChange={onChange} label={label} description={description} />
);

const SettingsModal: React.FC<SettingsModalProps> = ({ 
    isOpen, onClose, currentUser, userSettings,
    onUpdateSettingsCategory,
    onUpdateProfile, onUpdateAvatar, onUpdatePassword, onLogout,
    onPauseAccount, onDeleteAccountImmediate, onImportAccount,
    onExportAccount, onResetSettings,
}) => {
    const { lowDataMode } = useLowDataModeToggle();
    const activeTab = useUIStore((s) => s.settingsTab);
    const setActiveTab = useUIStore((s) => s.setSettingsTab);
    const [deletionOpen, setDeletionOpen] = useState(false);
    const [importOpen, setImportOpen] = useState(false);
    const [accountActionLoading, setAccountActionLoading] = useState(false);
    const [exporting, setExporting] = useState(false);
    const { showToast } = useToastStore();

    const notifications = userSettings.notifications;
    const study = userSettings.study;
    const appearance = userSettings.appearance;
    const privacy = userSettings.privacy;
    const marketplace = userSettings.marketplace || { country_code: 'NG', campus_id: null, campus_other: null };
    const accessibility = userSettings.accessibility;
    const [campusOptions, setCampusOptions] = useState<Array<{ id: string; name: string; city: string; state?: string; slug?: string }>>([]);

    useEffect(() => {
        if (!isOpen) return;
        void fetchMarketplaceCampuses(marketplace.country_code || 'NG')
            .then(setCampusOptions)
            .catch(() => {});
    }, [isOpen, marketplace.country_code]);

    const [profileData, setProfileData] = useState({ name: currentUser.name, phone: currentUser.phoneNumber || '' });
    const [isProfileDirty, setIsProfileDirty] = useState(false);
    const [showPasswordChange, setShowPasswordChange] = useState(false);
    const [passwordData, setPasswordData] = useState({ current: '', newPass: '', confirmPass: '' });
    const [showCurrentPass, setShowCurrentPass] = useState(false);
    const [showNewPass, setShowNewPass] = useState(false);
    const avatarInputRef = useRef<HTMLInputElement>(null);
    const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
    const [settingsTabOrientation, setSettingsTabOrientation] = useState<'horizontal' | 'vertical'>('horizontal');
    const [studyDraft, setStudyDraft] = useState<StudyDraft>(() => studyToDraft(userSettings.study));
    const studyDraftRef = useRef<StudyDraft>(studyToDraft(userSettings.study));
    const studySaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        const mq = window.matchMedia('(min-width: 768px)');
        const update = () => setSettingsTabOrientation(mq.matches ? 'vertical' : 'horizontal');
        update();
        mq.addEventListener('change', update);
        return () => mq.removeEventListener('change', update);
    }, []);

    // Reset form drafts only when the modal opens. Tab selection lives in uiStore so
    // Suspense remounts / settings saves never bounce the user back to Profile.
    const wasOpenRef = useRef(false);
    const currentUserRef = useRef(currentUser);
    const userSettingsRef = useRef(userSettings);
    currentUserRef.current = currentUser;
    userSettingsRef.current = userSettings;
    useEffect(() => {
        const justOpened = isOpen && !wasOpenRef.current;
        wasOpenRef.current = isOpen;
        if (!justOpened) return;

        const user = currentUserRef.current;
        setProfileData({ name: user.name, phone: user.phoneNumber || '' });
        setIsProfileDirty(false);
        setShowPasswordChange(false);
        setPasswordData({ current: '', newPass: '', confirmPass: '' });
        setAvatarPreview(null);
        const draft = studyToDraft(userSettingsRef.current.study);
        studyDraftRef.current = draft;
        setStudyDraft(draft);
    }, [isOpen]);

    useEffect(() => () => {
        if (studySaveTimerRef.current) clearTimeout(studySaveTimerRef.current);
    }, []);

    const commitStudyDraft = (draft: StudyDraft = studyDraftRef.current) => {
        if (studySaveTimerRef.current) {
            clearTimeout(studySaveTimerRef.current);
            studySaveTimerRef.current = null;
        }
        const nextStudy = {
            dailyCardGoal: parseStudyNumber(draft.dailyCardGoal, study.dailyCardGoal, 5, 100),
            dailyTestGoal: parseStudyNumber(draft.dailyTestGoal, study.dailyTestGoal, 0, 10),
            srsNewCardsPerDay: parseStudyNumber(draft.srsNewCardsPerDay, study.srsNewCardsPerDay, 5, 50),
            srsMaxInterval: parseStudyNumber(draft.srsMaxInterval, study.srsMaxInterval, 30, 365),
        };
        // Keep draft strings in sync with clamped values.
        const clampedDraft = studyToDraft({ ...study, ...nextStudy });
        studyDraftRef.current = clampedDraft;
        setStudyDraft(clampedDraft);
        onUpdateSettingsCategory('study', nextStudy);
    };

    const handleStudyDraftChange = (field: keyof StudyDraft, value: string) => {
        setStudyDraft((prev) => {
            const next = { ...prev, [field]: value };
            studyDraftRef.current = next;
            if (studySaveTimerRef.current) clearTimeout(studySaveTimerRef.current);
            studySaveTimerRef.current = setTimeout(() => commitStudyDraft(studyDraftRef.current), 450);
            return next;
        });
    };    
    useEffect(() => {
        setIsProfileDirty(profileData.name !== currentUser.name || profileData.phone !== (currentUser.phoneNumber || ''));
    }, [profileData, currentUser]);

    if (!isOpen) return null;
    
    const handleProfileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setProfileData(prev => ({ ...prev, [e.target.name]: e.target.value }));
    };

    const handleAvatarFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file || !currentUser) return;
        if (!file.type.startsWith('image/')) {
            useToastStore.getState().showToast('Please select an image file.', 'error');
            return;
        }
        try {
            const base64 = await compressImage(file, {
                maxWidth: 150,
                maxHeight: 150,
                quality: 0.7,
                outputType: 'base64'
            }) as string;
            const base64Data = base64.includes(',') ? base64.split(',')[1]! : base64;
            const mimeMatch = base64.match(/^data:([^;]+);/);
            const contentType = mimeMatch?.[1] || 'image/webp';
            const uploaded = await uploadProfileAvatar(
                currentUser.id,
                contentType === 'image/png' ? 'avatar.png' : 'avatar.webp',
                base64Data,
                contentType
            );
            setAvatarPreview(uploaded.url);
            onUpdateAvatar(uploaded.avatarUrl);
        } catch (error) {
            console.error('Error uploading avatar:', error);
            useToastStore.getState().showToast('Failed to upload avatar.', 'error');
        } finally {
            e.target.value = '';
        }
    };

    const handleRemoveAvatar = () => {
        setAvatarPreview(null);
        onUpdateAvatar('');
    };

    const handleProfileSave = async (e: React.FormEvent) => {
        e.preventDefault();
        const result = onUpdateProfile(profileData.name, profileData.phone);
        const ok = result instanceof Promise ? await result : true;
        if (ok !== false) {
            setIsProfileDirty(false);
        }
    };

    const handlePasswordChange = async (e: React.FormEvent) => {
        e.preventDefault();
        if (passwordData.newPass !== passwordData.confirmPass) {
            useToastStore.getState().showToast("New passwords do not match.", 'info');
            return;
        }
        if (passwordData.newPass.length < 6) {
            useToastStore.getState().showToast("New password must be at least 6 characters long.", 'error');
            return;
        }
        const result = onUpdatePassword(passwordData.current, passwordData.newPass);
        const success = result instanceof Promise ? await result : result;
        if (success) {
            setPasswordData({ current: '', newPass: '', confirmPass: '' });
            setShowPasswordChange(false);
        }
    };
    
    const handleLowDataToggle = () => {
        // Single writer: settings category save also syncs preferences + uiStore via handlers.
        onUpdateSettingsCategory('appearance', { lowDataMode: !lowDataMode });
    };

    const navItems: { id: SettingsTab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
        { id: 'profile', label: 'Profile', icon: UserCircleIcon },
        { id: 'notifications', label: 'Notifications', icon: BellIcon },
        { id: 'study', label: 'Study', icon: AcademicCapIcon },
        { id: 'appearance', label: 'Appearance', icon: PaintBrushIcon },
        { id: 'privacy', label: 'Privacy', icon: EyeIcon },
        { id: 'marketplace', label: 'Marketplace', icon: ShoppingBagIcon },
        { id: 'dataSync', label: 'Data & Sync', icon: CloudArrowDownIcon },
        { id: 'support', label: 'Support', icon: LifebuoyIcon },
        { id: 'account', label: 'Account', icon: ShieldExclamationIcon },
    ];

    const renderContent = (tab: SettingsTab = activeTab) => {
        switch (tab) {
            case 'profile': return (
                <div className="space-y-6">
                    <div>
                        <h3 className="text-lg font-semibold text-lantern-text">Profile Information</h3>
                        <p className="text-sm text-lantern-text-secondary">Update your personal details.</p>
                    </div>
                    <div className="flex items-center gap-5">
                        <div className="relative group">
                            <Avatar name={currentUser.name} src={avatarPreview || currentUser.avatarUrl} size="xl" />
                            <button type="button" onClick={() => avatarInputRef.current?.click()}
                                className="absolute inset-0 flex items-center justify-center rounded-full bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer" title="Change photo">
                                <CameraIcon className="w-6 h-6 text-white" />
                            </button>
                            <input ref={avatarInputRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarFileChange} />
                        </div>
                        <div className="flex flex-col gap-1.5">
                            <button type="button" onClick={() => avatarInputRef.current?.click()}
                                className="text-sm font-medium text-lantern-primary hover:underline text-left">Change profile picture</button>
                            <button type="button" onClick={handleRemoveAvatar}
                                className="text-sm text-lantern-text-secondary hover:text-red-500 dark:hover:text-red-400 text-left">Remove photo</button>
                        </div>
                    </div>
                    <form onSubmit={handleProfileSave} className="space-y-4">
                        <div>
                            <label htmlFor="name" className="block text-sm font-medium text-lantern-text">Full Name</label>
                            <input type="text" name="name" id="name" value={profileData.name} onChange={handleProfileChange}
                                className="mt-1 w-full p-2 border border-lantern-border rounded-md bg-lantern-surface dark:bg-lantern-surface-secondary text-lantern-text dark:text-lantern-text" />
                        </div>
                        <div>
                            <label htmlFor="email" className="block text-sm font-medium text-lantern-text">Email Address</label>
                            <input type="email" name="email" id="email" value={currentUser.email || ''} disabled
                                className="mt-1 w-full p-2 border border-lantern-border rounded-md bg-lantern-background-secondary dark:bg-lantern-surface-secondary/50 cursor-not-allowed text-lantern-text-secondary" />
                        </div>
                         <div>
                            <label htmlFor="phone" className="block text-sm font-medium text-lantern-text">Phone Number</label>
                            <input type="tel" name="phone" id="phone" value={profileData.phone} onChange={handleProfileChange}
                                className="mt-1 w-full p-2 border border-lantern-border rounded-md bg-lantern-surface dark:bg-lantern-surface-secondary text-lantern-text dark:text-lantern-text" />
                        </div>
                        {isProfileDirty && (
                            <button type="submit" className="w-full px-4 py-2 text-sm font-medium text-white bg-lantern-primary hover:bg-lantern-primary-dark rounded-md shadow-sm">Save Changes</button>
                        )}
                    </form>
                     <div className="border-t border-lantern-border pt-6">
                         <h3 className="text-lg font-semibold text-lantern-text dark:text-lantern-text">Change Password</h3>
                         {!showPasswordChange ? (
                             <button onClick={() => setShowPasswordChange(true)} className="mt-2 text-sm text-lantern-primary hover:underline">Change your password</button>
                         ) : (
                             <form onSubmit={handlePasswordChange} className="mt-4 space-y-4">
                                <div>
                                    <label htmlFor="current" className="block text-sm font-medium text-lantern-text dark:text-lantern-text-tertiary">Current Password</label>
                                    <div className="relative mt-1">
                                        <input type={showCurrentPass ? 'text' : 'password'} id="current" value={passwordData.current}
                                            onChange={e => setPasswordData(p => ({ ...p, current: e.target.value }))} required
                                            className="w-full p-2 pr-10 border border-lantern-border rounded-md bg-lantern-surface dark:bg-lantern-surface-secondary text-lantern-text dark:text-lantern-text" />
                                        <button type="button" onClick={() => setShowCurrentPass(s => !s)} className="absolute inset-y-0 right-0 pr-3 flex items-center text-lantern-text-tertiary">
                                            {showCurrentPass ? <EyeSlashIcon className="h-5 w-5" /> : <EyeIcon className="h-5 w-5" />}
                                        </button>
                                    </div>
                                </div>
                                <div>
                                    <label htmlFor="newPass" className="block text-sm font-medium text-lantern-text dark:text-lantern-text-tertiary">New Password</label>
                                    <div className="relative mt-1">
                                        <input type={showNewPass ? 'text' : 'password'} id="newPass" value={passwordData.newPass}
                                            onChange={e => setPasswordData(p => ({ ...p, newPass: e.target.value }))} required
                                            className="w-full p-2 pr-10 border border-lantern-border rounded-md bg-lantern-surface dark:bg-lantern-surface-secondary text-lantern-text dark:text-lantern-text" />
                                        <button type="button" onClick={() => setShowNewPass(s => !s)} className="absolute inset-y-0 right-0 pr-3 flex items-center text-lantern-text-tertiary">
                                            {showNewPass ? <EyeSlashIcon className="h-5 w-5" /> : <EyeIcon className="h-5 w-5" />}
                                        </button>
                                    </div>
                                </div>
                                <div>
                                    <label htmlFor="confirmPass" className="block text-sm font-medium text-lantern-text dark:text-lantern-text-tertiary">Confirm New Password</label>
                                    <input type="password" id="confirmPass" value={passwordData.confirmPass}
                                        onChange={e => setPasswordData(p => ({ ...p, confirmPass: e.target.value }))} required
                                        className="w-full p-2 border border-lantern-border rounded-md bg-lantern-surface dark:bg-lantern-surface-secondary text-lantern-text dark:text-lantern-text" />
                                </div>
                                <div className="flex items-center space-x-2">
                                    <button type="submit" className="px-4 py-2 text-sm font-medium text-white bg-lantern-primary hover:bg-lantern-primary-dark rounded-md">Update Password</button>
                                    <button type="button" onClick={() => setShowPasswordChange(false)} className="px-4 py-2 text-sm font-medium text-lantern-text dark:text-lantern-text bg-lantern-background-secondary dark:bg-lantern-border rounded-md">Cancel</button>
                                </div>
                             </form>
                         )}
                     </div>
                </div>
            );
            case 'notifications': return (
                 <div>
                    <h3 className="text-lg font-semibold text-lantern-text">Notification Settings</h3>
                    <p className="text-sm text-lantern-text-secondary mb-4">Control how you receive notifications.</p>
                    <div className="space-y-4 divide-y divide-lantern-border">
                        <ToggleSwitch enabled={notifications.pushEnabled} onChange={(val) => onUpdateSettingsCategory('notifications', { pushEnabled: val })} label="Push Notifications" description="Mobile push alerts (synced across devices)." />
                        <ToggleSwitch enabled={notifications.dailyReminder} onChange={(val) => onUpdateSettingsCategory('notifications', { dailyReminder: val })} label="Daily Study Reminders" description="One reminder at your chosen time — only if Lantern isn't already open." />
                        <div className="pt-4">
                            <label htmlFor="reminderTime" className="block text-sm font-medium text-lantern-text mb-1">Reminder time</label>
                            <input id="reminderTime" type="time" value={notifications.reminderTime}
                                onChange={(e) => onUpdateSettingsCategory('notifications', { reminderTime: e.target.value })}
                                className="p-2 border border-lantern-border rounded-md bg-lantern-background text-lantern-text" />
                            <p className="text-xs text-lantern-text-secondary mt-1">Currently {formatReminderTime(notifications.reminderTime)}</p>
                        </div>
                        <ToggleSwitch enabled={notifications.groupActivity} onChange={(val) => onUpdateSettingsCategory('notifications', { groupActivity: val })} label="Group Activity" description="Messages and questions in your groups." />
                        <ToggleSwitch enabled={notifications.groupInvites !== false} onChange={(val) => onUpdateSettingsCategory('notifications', { groupInvites: val })} label="Group Invites" description="When someone invites you to a group." />
                        <ToggleSwitch enabled={notifications.marketplaceUpdates} onChange={(val) => onUpdateSettingsCategory('notifications', { marketplaceUpdates: val })} label="Marketplace Updates" description="Alerts about listings and messages." />
                        <ToggleSwitch enabled={notifications.badgeUnlocks} onChange={(val) => onUpdateSettingsCategory('notifications', { badgeUnlocks: val })} label="Badge Unlocks" description="Achievement notifications." />
                        <ToggleSwitch enabled={notifications.srsReminders} onChange={(val) => onUpdateSettingsCategory('notifications', { srsReminders: val })} label="Review reminders" description="Browser alerts when cards are due — only while Lantern is in the background, at most every few hours." />
                        <ToggleSwitch enabled={notifications.testResults} onChange={(val) => onUpdateSettingsCategory('notifications', { testResults: val })} label="Test Results" description="Notifications when tests are completed." />
                        <ToggleSwitch enabled={notifications.emailEnabled} onChange={(val) => onUpdateSettingsCategory('notifications', { emailEnabled: val })} label="Email Notifications" description="Receive important updates by email." />
                        <ToggleSwitch enabled={notifications.weeklyDigest} onChange={(val) => onUpdateSettingsCategory('notifications', { weeklyDigest: val })} label="Weekly Digest" description="Summary of your weekly study activity." />
                    </div>
                </div>
            );
            case 'study': return (
                <div className="space-y-6">
                    <div>
                        <h3 className="text-lg font-semibold text-lantern-text">Study Settings</h3>
                        <p className="text-sm text-lantern-text-secondary">Goals, SRS, and test behavior.</p>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-lantern-text mb-1">Daily card goal</label>
                            <input type="number" min={5} max={100} step={5} value={studyDraft.dailyCardGoal}
                                onChange={(e) => handleStudyDraftChange('dailyCardGoal', e.target.value)}
                                onBlur={() => commitStudyDraft()}
                                className="w-full p-2 border border-lantern-border rounded-md bg-lantern-background text-lantern-text" />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-lantern-text mb-1">Daily test goal</label>
                            <input type="number" min={0} max={10} value={studyDraft.dailyTestGoal}
                                onChange={(e) => handleStudyDraftChange('dailyTestGoal', e.target.value)}
                                onBlur={() => commitStudyDraft()}
                                className="w-full p-2 border border-lantern-border rounded-md bg-lantern-background text-lantern-text" />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-lantern-text mb-1">New cards per day</label>
                            <input type="number" min={5} max={50} step={5} value={studyDraft.srsNewCardsPerDay}
                                onChange={(e) => handleStudyDraftChange('srsNewCardsPerDay', e.target.value)}
                                onBlur={() => commitStudyDraft()}
                                className="w-full p-2 border border-lantern-border rounded-md bg-lantern-background text-lantern-text" />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-lantern-text mb-1">Longest gap between reviews (days)</label>
                            <input type="number" min={30} max={365} step={30} value={studyDraft.srsMaxInterval}
                                onChange={(e) => handleStudyDraftChange('srsMaxInterval', e.target.value)}
                                onBlur={() => commitStudyDraft()}
                                className="w-full p-2 border border-lantern-border rounded-md bg-lantern-background text-lantern-text" />
                        </div>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-lantern-text mb-1">Default session mode</label>
                        <select value={study.defaultTestMode}
                            onChange={(e) => onUpdateSettingsCategory('study', { defaultTestMode: e.target.value as UserSettings['study']['defaultTestMode'] })}
                            className="w-full p-2 border border-lantern-border rounded-md bg-lantern-background text-lantern-text">
                            <option value="study">Study mode</option>
                            <option value="exam">Timed test mode</option>
                        </select>
                    </div>
                    <div className="space-y-4 divide-y divide-lantern-border">
                        <ToggleSwitch enabled={study.shuffleQuestions} onChange={(val) => onUpdateSettingsCategory('study', { shuffleQuestions: val })} label="Shuffle Questions" description="Randomize question order in tests." />
                        <ToggleSwitch enabled={study.shuffleOptions} onChange={(val) => onUpdateSettingsCategory('study', { shuffleOptions: val })} label="Shuffle Options" description="Randomize answer choices." />
                        <ToggleSwitch enabled={study.showExplanationsImmediately} onChange={(val) => onUpdateSettingsCategory('study', { showExplanationsImmediately: val })} label="Show Explanations" description="Show explanations immediately after answering in study mode." />
                    </div>
                 </div>
            );
            case 'appearance': return (
                <div className="space-y-6">
                    <div>
                        <h3 className="text-lg font-semibold text-lantern-text">Appearance</h3>
                        <p className="text-sm text-lantern-text-secondary">Theme and display preferences.</p>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-lantern-text mb-1">Theme</label>
                        <select value={appearance.theme}
                            onChange={(e) => onUpdateSettingsCategory('appearance', { theme: e.target.value as UserSettings['appearance']['theme'] })}
                            className="w-full p-2 border border-lantern-border rounded-md bg-lantern-background text-lantern-text">
                            <option value="system">System default</option>
                            <option value="light">Light</option>
                            <option value="dark">Dark</option>
                        </select>
                    </div>
                    <ToggleSwitch enabled={lowDataMode} onChange={handleLowDataToggle} label="Low-Data Mode" description="Smaller pages, local avatars, and lighter charts." />
                    <div>
                        <label className="block text-sm font-medium text-lantern-text mb-1">Accent color</label>
                        <input type="color" value={appearance.accentColor}
                            onChange={(e) => onUpdateSettingsCategory('appearance', { accentColor: e.target.value })}
                            className="h-10 w-20 border border-lantern-border rounded-md bg-lantern-background" />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-lantern-text mb-1">Font size</label>
                        <select value={appearance.fontSize}
                            onChange={(e) => onUpdateSettingsCategory('appearance', { fontSize: e.target.value as UserSettings['appearance']['fontSize'] })}
                            className="w-full p-2 border border-lantern-border rounded-md bg-lantern-background text-lantern-text">
                            <option value="small">Small</option>
                            <option value="medium">Medium</option>
                            <option value="large">Large</option>
                        </select>
                    </div>
                    <ToggleSwitch enabled={appearance.compactMode} onChange={(val) => onUpdateSettingsCategory('appearance', { compactMode: val })} label="Compact Mode" description="Tighter spacing across the app." />
                    <ToggleSwitch enabled={appearance.showAnimations} onChange={(val) => onUpdateSettingsCategory('appearance', { showAnimations: val })} label="Show Animations" description="Enable UI animations." />
                    <ToggleSwitch enabled={accessibility.reduceMotion} onChange={(val) => onUpdateSettingsCategory('accessibility', { reduceMotion: val })} label="Reduce Motion" description="Minimize animations for accessibility." />
                    <ToggleSwitch enabled={accessibility.highContrast} onChange={(val) => onUpdateSettingsCategory('accessibility', { highContrast: val })} label="High Contrast" description="Increase color contrast." />
                    <ToggleSwitch enabled={accessibility.screenReaderOptimized} onChange={(val) => onUpdateSettingsCategory('accessibility', { screenReaderOptimized: val })} label="Screen Reader Optimized" description="Stronger focus outlines and readable layout." />
                </div>
            );
            case 'privacy': return (
                 <div className="space-y-4">
                    <h3 className="text-lg font-semibold text-lantern-text">Privacy</h3>
                    <p className="text-sm text-lantern-text-secondary">Control who can see your profile and activity.</p>
                    <p className="text-sm rounded-lg border border-lantern-border bg-lantern-background-secondary p-3 text-lantern-text-secondary">
                      New accounts are <strong className="text-lantern-text">public</strong> by default so classmates can find you. Change profile visibility below anytime.
                    </p>
                    <div>
                      <label className="block text-sm font-medium text-lantern-text mb-1">Profile visibility</label>
                        <select value={privacy.profileVisibility}
                            onChange={(e) => onUpdateSettingsCategory('privacy', { profileVisibility: e.target.value as UserSettings['privacy']['profileVisibility'] })}
                            className="w-full p-2 border border-lantern-border rounded-md bg-lantern-background text-lantern-text">
                        <option value="public">Public — all signed-in users</option>
                        <option value="groups">Groups — group members only</option>
                        <option value="private">Private — only you</option>
                      </select>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-lantern-text mb-1">Direct messages</label>
                        <select value={privacy.allowDirectMessages}
                            onChange={(e) => onUpdateSettingsCategory('privacy', { allowDirectMessages: e.target.value as UserSettings['privacy']['allowDirectMessages'] })}
                            className="w-full p-2 border border-lantern-border rounded-md bg-lantern-background text-lantern-text">
                            <option value="everyone">Everyone — open chats immediately</option>
                            <option value="groups">Group members open; others send requests</option>
                            <option value="none">Message requests only</option>
                        </select>
                        <p className="mt-1 text-xs text-lantern-text-secondary">
                          Anyone can still find you and send a first message. Restrictive settings turn cold outreach into a request you can accept or decline — they do not hide you from search. Use profile visibility or “Allow search for invites” to control discoverability, and Block to stop messaging.
                        </p>
                    </div>
                    <ToggleSwitch enabled={privacy.discoverableForInvites !== false} onChange={(val) => onUpdateSettingsCategory('privacy', { discoverableForInvites: val })} label="Allow search for invites" description="Let others find you by name or @username when adding group or deck members. Profile visibility still controls who can view your full profile." />
                    <ToggleSwitch enabled={privacy.showOnlineStatus} onChange={(val) => onUpdateSettingsCategory('privacy', { showOnlineStatus: val })} label="Show online status" description="Let others see when you are active." />
                    <ToggleSwitch enabled={privacy.showStudyActivity} onChange={(val) => onUpdateSettingsCategory('privacy', { showStudyActivity: val })} label="Show study activity" description="Share study streaks and activity." />
                    <div className="rounded-lg border border-lantern-border bg-lantern-background-secondary p-3 space-y-2">
                      <div>
                        <p className="text-sm font-medium text-lantern-text">Cookie preferences</p>
                        <p className="text-xs text-lantern-text-secondary mt-0.5">
                          Manage optional analytics, functional, and advertising cookie categories. Strictly necessary cookies always stay on.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => openCookiePreferenceCenter()}
                        className="w-full min-h-[44px] rounded-lg border border-lantern-border bg-lantern-surface px-4 py-2 text-sm font-medium text-lantern-text hover:bg-lantern-background"
                      >
                        Manage cookie preferences
                      </button>
                      <a
                        href={LEGAL_PATHS.cookies}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block text-xs text-lantern-primary underline"
                      >
                        Cookie Policy
                      </a>
                    </div>
                 </div>
            );
            case 'marketplace': return (
                <div className="space-y-6">
                    <div>
                        <h3 className="text-lg font-semibold text-lantern-text">Marketplace</h3>
                        <p className="text-sm text-lantern-text-secondary">
                            Save a campus for local context. Explore still opens to listings across Nigeria.
                        </p>
                    </div>
                    <p className="text-sm text-lantern-text-secondary rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30 p-3 text-amber-900 dark:text-amber-100">
                        {MARKETPLACE_COMPLIANCE_BANNER}
                    </p>
                    <div>
                        <label className="block text-sm font-medium text-lantern-text mb-1">Country</label>
                        <select
                            value={marketplace.country_code || 'NG'}
                            onChange={(e) => onUpdateSettingsCategory('marketplace', { country_code: e.target.value })}
                            className="w-full p-2 border border-lantern-border rounded-md bg-lantern-background text-lantern-text"
                        >
                            <option value="NG">Nigeria</option>
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-lantern-text mb-1">Your campus</label>
                        <CampusSearchSelect
                            campuses={campusOptions.map((c) => ({
                              id: c.id,
                              name: c.name,
                              city: c.city,
                              state: c.state || '',
                              slug: c.slug || '',
                            }))}
                            value={marketplace.campus_id || ''}
                            otherCity={marketplace.campus_other || ''}
                            onChange={(campusId) => {
                              const selected = campusOptions.find((c) => c.id === campusId);
                              const keepOther = isOtherCityCampus(selected as { slug?: string; name: string } | undefined);
                              onUpdateSettingsCategory('marketplace', {
                                campus_id: campusId,
                                campus_other: keepOther ? marketplace.campus_other || null : null,
                              });
                            }}
                            onOtherCityChange={(city) =>
                              onUpdateSettingsCategory('marketplace', { campus_other: city || null })
                            }
                        />
                    </div>
                </div>
            );
            case 'dataSync': return (
                 <div className="space-y-6">
                    <div>
                      <h3 className="text-lg font-semibold text-lantern-text">Data & Sync</h3>
                        <p className="text-sm text-lantern-text-secondary">Connection and offline preferences.</p>
                    </div>
                    <div className="p-4 rounded-lantern-xl bg-lantern-accent-background border border-amber-200 dark:border-amber-800/50">
                      <p className="text-sm text-amber-900 dark:text-amber-100">{syncCopy.lowDataDefaultHint}</p>
                    </div>
                    <ToggleSwitch enabled={userSettings.sync.autoSync} onChange={(val) => onUpdateSettingsCategory('sync', { autoSync: val })} label="Auto Sync" description="Sync changes automatically when online." />
                    <ToggleSwitch enabled={userSettings.sync.syncOnWifiOnly} onChange={(val) => onUpdateSettingsCategory('sync', { syncOnWifiOnly: val })} label="Prefer Wi‑Fi for large syncs" description="On mobile, wait for Wi‑Fi when Sync on Wi‑Fi Only is enabled. Web still syncs when online." />
                    {userSettings.sync.lastSyncTime && (
                        <p className="text-sm text-lantern-text-secondary">Last synced: {new Date(userSettings.sync.lastSyncTime).toLocaleString()}</p>
                    )}
                    <p className="text-sm text-lantern-text-secondary">{syncCopy.webSettingsPersistHint}</p>
                    <p className="text-sm text-lantern-text-secondary">Use Offline Mode from the Study menu to download bundles for offline tests.</p>
                </div>
            );
            case 'support': return (
                <div className="space-y-4">
                    <h3 className="text-lg font-semibold text-lantern-text">Help & Support</h3>
                    <div className="space-y-4 max-h-[40vh] overflow-y-auto pr-2">
                        {SETTINGS_FAQ.map(item => (
                            <div key={item.q}>
                                <p className="font-medium text-lantern-text">{item.q}</p>
                                <p className="text-sm text-lantern-text-secondary mt-1">{item.a}</p>
                            </div>
                        ))}
                    </div>
                    <div className="border-t border-lantern-border pt-4">
                        <h4 className="font-medium text-lantern-text mb-1">Contact us</h4>
                        <p className="text-sm text-lantern-text-secondary mb-3">
                            Questions or issues? Use the form below or email{' '}
                            <a href="mailto:support@lanternstudy.com" className="text-lantern-primary underline">
                                support@lanternstudy.com
                            </a>
                            .
                        </p>
                        <ContactForm
                            compact
                            defaultName={currentUser.name}
                            defaultEmail={currentUser.email ?? ''}
                            onSuccess={(msg) => showToast(msg, 'success')}
                        />
                    </div>
                    <div className="border-t border-lantern-border pt-4 space-y-3">
                        <h4 className="font-medium text-lantern-text mb-1">Feature tips</h4>
                        <p className="text-sm text-lantern-text-secondary">
                            Replay first-time navigation tips and the Getting Started checklist. Tips also appear for returning users until you choose &quot;Don&apos;t show again.&quot;
                        </p>
                        <button
                            type="button"
                            onClick={() => {
                                useFeatureTipStore.getState().replay();
                                showToast('Feature tips reset. Explore the app to see them again.', 'success');
                            }}
                            className="w-full flex items-center justify-center p-3 text-sm font-medium text-lantern-primary bg-lantern-primary-background hover:opacity-90 rounded-md border border-lantern-primary/30"
                        >
                            Replay feature tips
                        </button>
                    </div>
                    <button onClick={onResetSettings}
                        className="w-full flex items-center justify-center p-3 text-sm font-medium text-orange-700 bg-orange-50 hover:bg-orange-100 rounded-md border border-orange-200 dark:bg-orange-900/30 dark:text-orange-200 dark:border-orange-800">
                        <AdjustmentsHorizontalIcon className="w-5 h-5 mr-2" />
                        Reset settings to defaults
                    </button>
                 </div>
            );
            case 'account': return (
                 <div>
                     <h3 className="text-lg font-semibold text-lantern-text">Account Actions</h3>
                     <p className="text-sm text-lantern-text-secondary mb-4">
                         Export a signed backup, import it into a new account later, or manage account deletion.
                     </p>
                     <p className="text-xs text-lantern-text-secondary mb-4">{ACCOUNT_EXPORT_COPY.limitations}</p>
                     <button
                        type="button"
                        onClick={async () => {
                            setExporting(true);
                            try {
                                await onExportAccount();
                                showToast('Backup downloaded.', 'success');
                            } catch {
                                showToast('Export failed. You may only export once every 24 hours.', 'error');
                            } finally {
                                setExporting(false);
                            }
                        }}
                        disabled={exporting || accountActionLoading}
                        className="w-full flex items-center justify-center p-3 mb-3 text-sm font-medium text-lantern-primary bg-lantern-primary-background hover:bg-lantern-primary-background rounded-md border border-lantern-primary/30 dark:bg-lantern-primary-dark/30 dark:text-lantern-primary-light dark:border-lantern-primary/30 disabled:opacity-60"
                     >
                        <CloudArrowDownIcon className="w-5 h-5 mr-2" />
                         {exporting ? 'Exporting…' : 'Export my data (JSON)'}
                     </button>
                     <button
                        type="button"
                        onClick={() => setImportOpen(true)}
                        disabled={accountActionLoading}
                        className="w-full flex items-center justify-center p-3 mb-3 text-sm font-medium text-teal-700 bg-teal-50 hover:bg-teal-100 rounded-md border border-teal-200 dark:bg-teal-900/30 dark:text-teal-200 dark:border-teal-800"
                     >
                        <CloudArrowUpIcon className="w-5 h-5 mr-2" />
                         Import backup
                     </button>
                     <div className="text-xs text-lantern-text-secondary mb-4 space-x-3">
                        <a href={LEGAL_PATHS.privacy} target="_blank" rel="noopener noreferrer" className="underline">Privacy</a>
                        <a href={LEGAL_PATHS.terms} target="_blank" rel="noopener noreferrer" className="underline">Terms</a>
                        <a href={LEGAL_PATHS.cookies} target="_blank" rel="noopener noreferrer" className="underline">Cookies</a>
                     </div>
                    <button onClick={onLogout} className="w-full flex items-center justify-center p-3 text-sm font-medium text-lantern-text bg-lantern-background-secondary hover:bg-lantern-background-secondary rounded-md border border-lantern-border dark:bg-lantern-surface-secondary dark:text-lantern-text dark:border-lantern-border">
                        <ArrowRightOnRectangleIcon className="w-5 h-5 mr-2" />
                         Logout
                     </button>
                     <div className="mt-8 p-4 border border-red-500/30 dark:border-red-600/50 bg-red-50 dark:bg-red-900/20 rounded-lg">
                        <h4 className="font-semibold text-red-700 dark:text-red-300">Danger Zone</h4>
                        <p className="text-xs text-red-600 dark:text-red-400 mt-1 mb-3">
                            Pause your account for 30 days or delete it permanently. Export a backup first — uploaded files are not included in exports.
                        </p>
                        <button
                            type="button"
                            onClick={() => setDeletionOpen(true)}
                            disabled={accountActionLoading}
                            className="w-full flex items-center justify-center p-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-md disabled:opacity-60"
                        >
                            <TrashIcon className="w-4 h-4 mr-2" />
                            Delete or pause account…
                        </button>
                     </div>
                 </div>
            );
            default: return null;
        }
    };
    
    return (
        <>
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            ariaLabelledBy="settings-modal-title"
            maxWidthClass="max-w-3xl"
            zIndexClass="z-[80]"
            panelClassName="!p-0 h-[90vh] md:h-[75vh] flex flex-col overflow-hidden border border-lantern-border bg-lantern-surface rounded-lantern-xl"
        >
            <Tabs
                value={activeTab}
                onValueChange={(value) => setActiveTab(value as SettingsTab)}
                orientation={settingsTabOrientation}
                aria-label="Settings sections"
                variant="pills"
                className="h-full flex flex-col md:flex-row overflow-hidden"
            >
                <div className="w-full md:w-1/3 bg-lantern-background-secondary border-b md:border-b-0 md:border-r border-lantern-border p-4 flex-shrink-0">
                    <div className="flex justify-between items-center mb-2 md:mb-6">
                        <h2 id="settings-modal-title" className="text-xl font-bold text-lantern-text">Settings</h2>
                        <button onClick={onClose} className="md:hidden flex min-h-[44px] min-w-[44px] items-center justify-center text-lantern-text-secondary" aria-label="Close settings">
                            <XCircleIcon className="w-6 h-6" />
                        </button>
                    </div>
                    <TabList className="flex space-x-1 md:flex-col md:space-y-1 md:space-x-0 overflow-x-auto pb-2 md:pb-0 md:overflow-x-visible !border-0">
                        {navItems.map((item, index) => (
                            <Tab
                                key={item.id}
                                value={item.id}
                                index={index}
                                icon={<item.icon className="w-5 h-5 mr-0 md:mr-1" />}
                                className="flex-shrink-0 md:w-full !rounded-lantern justify-start"
                            >
                                <span className="md:ml-2">{item.label}</span>
                            </Tab>
                        ))}
                    </TabList>
                </div>
                <div className="w-full md:w-2/3 flex flex-col min-h-0">
                    {navItems.map((item) => (
                        <TabPanel key={item.id} value={item.id} className="flex-grow p-6 overflow-y-auto">
                            {renderContent(item.id)}
                        </TabPanel>
                    ))}
                     <div className="flex-shrink-0 p-4 border-t border-lantern-border bg-lantern-background-secondary flex justify-end">
                        <Button variant="secondary" onClick={onClose}>Done</Button>
                    </div>
                </div>
            </Tabs>
        </Modal>
        <AccountDeletionModal
            open={deletionOpen}
            onClose={() => setDeletionOpen(false)}
            onExport={onExportAccount}
            exporting={exporting}
            loading={accountActionLoading}
            onPauseAccount={async () => {
                setAccountActionLoading(true);
                try {
                    await onPauseAccount();
                    showToast('Account paused. Sign in again within 30 days to reactivate.', 'info');
                    onClose();
                } catch (err) {
                    // Re-throw so AccountDeletionModal can show the message; avoid blank failures.
                    const message = err instanceof Error ? err.message : 'Failed to pause account.';
                    showToast(message, 'error');
                    throw err instanceof Error ? err : new Error(message);
                } finally {
                    setAccountActionLoading(false);
                }
            }}
            onDeleteImmediate={async (password) => {
                setAccountActionLoading(true);
                try {
                    await onDeleteAccountImmediate(password);
                    showToast('Account permanently deleted.', 'info');
                    onClose();
                } finally {
                    setAccountActionLoading(false);
                }
            }}
        />
        <AccountImportModal
            open={importOpen}
            onClose={() => setImportOpen(false)}
            loading={accountActionLoading}
            onImport={async (payload) => {
                setAccountActionLoading(true);
                try {
                    const result = await onImportAccount(payload);
                    if (result) {
                        showToast(
                            `Imported ${result.notes} notes, ${result.decks} decks, ${result.flashcards} flashcards.`,
                            'success'
                        );
                    }
                } finally {
                    setAccountActionLoading(false);
                }
            }}
        />
        </>
    );
};

export default SettingsModal;
