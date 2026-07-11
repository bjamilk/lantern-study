

import React, { useState, useEffect, useRef } from 'react';
import { useToastStore } from '../stores/toastStore';
import { User } from '../types';
import { 
    XCircleIcon, UserCircleIcon, BellIcon, ShieldExclamationIcon, 
    EyeIcon, EyeSlashIcon, ArrowRightOnRectangleIcon, TrashIcon,
    CameraIcon, AcademicCapIcon, PaintBrushIcon, LifebuoyIcon,
    AdjustmentsHorizontalIcon, ShoppingBagIcon,
} from '@heroicons/react/24/outline';
import { compressImage } from '../utils/imageCompression';
import { useLowDataModeToggle } from '../hooks/useLowDataModeToggle';
import { Avatar, Button, Toggle } from './ui';
import { syncCopy } from '@lantern/shared/design';
import { LEGAL_PATHS, MARKETPLACE_COMPLIANCE_BANNER } from '@lantern/shared';
import { fetchMarketplaceCampuses } from '../services/supabase';
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
import Modal from './ui/Modal';

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

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: User;
  userSettings: UserSettings;
  onUpdateSettingsCategory: <K extends keyof UserSettings>(
    category: K,
    updates: Partial<UserSettings[K]>
  ) => void;
  onUpdateProfile: (name: string, phone: string) => void;
  onUpdateAvatar: (avatarUrl: string) => void;
  onUpdatePassword: (current: string, newPass: string) => boolean;
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
    const { lowDataMode, toggleLowDataMode } = useLowDataModeToggle();
    const [activeTab, setActiveTab] = useState<SettingsTab>('profile');
    const [deletionOpen, setDeletionOpen] = useState(false);
    const [importOpen, setImportOpen] = useState(false);
    const [accountActionLoading, setAccountActionLoading] = useState(false);
    const [exporting, setExporting] = useState(false);
    const { showToast } = useToastStore();

    const notifications = userSettings.notifications;
    const study = userSettings.study;
    const appearance = userSettings.appearance;
    const privacy = userSettings.privacy;
    const marketplace = userSettings.marketplace || { country_code: 'NG', campus_id: null };
    const accessibility = userSettings.accessibility;
    const [campusOptions, setCampusOptions] = useState<Array<{ id: string; name: string; city: string }>>([]);

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

    useEffect(() => {
        if (isOpen) {
            setActiveTab('profile');
            setProfileData({ name: currentUser.name, phone: currentUser.phoneNumber || '' });
            setIsProfileDirty(false);
            setShowPasswordChange(false);
            setPasswordData({ current: '', newPass: '', confirmPass: '' });
            setAvatarPreview(null);
        }
    }, [isOpen, currentUser]);
    
    useEffect(() => {
        setIsProfileDirty(profileData.name !== currentUser.name || profileData.phone !== (currentUser.phoneNumber || ''));
    }, [profileData, currentUser]);

    if (!isOpen) return null;
    
    const handleProfileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setProfileData(prev => ({ ...prev, [e.target.name]: e.target.value }));
    };

    const handleAvatarFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
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
            setAvatarPreview(base64);
            onUpdateAvatar(base64);
        } catch (error) {
            console.error('Error compressing avatar:', error);
            useToastStore.getState().showToast('Failed to process image.', 'error');
        } finally {
            e.target.value = '';
        }
    };

    const handleRemoveAvatar = () => {
        setAvatarPreview(null);
        onUpdateAvatar('');
    };

    const handleProfileSave = (e: React.FormEvent) => {
        e.preventDefault();
        onUpdateProfile(profileData.name, profileData.phone);
        setIsProfileDirty(false);
    };

    const handlePasswordChange = (e: React.FormEvent) => {
        e.preventDefault();
        if (passwordData.newPass !== passwordData.confirmPass) {
            useToastStore.getState().showToast("New passwords do not match.", 'info');
            return;
        }
        if (passwordData.newPass.length < 6) {
            useToastStore.getState().showToast("New password must be at least 6 characters long.", 'error');
            return;
        }
        const success = onUpdatePassword(passwordData.current, passwordData.newPass);
        if (success) {
            setPasswordData({ current: '', newPass: '', confirmPass: '' });
            setShowPasswordChange(false);
        }
    };
    
    const handleLowDataToggle = () => {
        toggleLowDataMode();
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

    const renderContent = () => {
        switch (activeTab) {
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
                                className="text-sm font-medium text-blue-600 dark:text-blue-400 hover:underline text-left">Change profile picture</button>
                            <button type="button" onClick={handleRemoveAvatar}
                                className="text-sm text-gray-500 dark:text-gray-400 hover:text-red-500 dark:hover:text-red-400 text-left">Remove photo</button>
                        </div>
                    </div>
                    <form onSubmit={handleProfileSave} className="space-y-4">
                        <div>
                            <label htmlFor="name" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Full Name</label>
                            <input type="text" name="name" id="name" value={profileData.name} onChange={handleProfileChange}
                                className="mt-1 w-full p-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-200" />
                        </div>
                        <div>
                            <label htmlFor="email" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Email Address</label>
                            <input type="email" name="email" id="email" value={currentUser.email || ''} disabled
                                className="mt-1 w-full p-2 border border-gray-300 dark:border-gray-600 rounded-md bg-gray-100 dark:bg-gray-700/50 cursor-not-allowed text-gray-500 dark:text-gray-400" />
                        </div>
                         <div>
                            <label htmlFor="phone" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Phone Number</label>
                            <input type="tel" name="phone" id="phone" value={profileData.phone} onChange={handleProfileChange}
                                className="mt-1 w-full p-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-200" />
                        </div>
                        {isProfileDirty && (
                            <button type="submit" className="w-full px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md shadow-sm">Save Changes</button>
                        )}
                    </form>
                     <div className="border-t border-gray-200 dark:border-gray-700 pt-6">
                         <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-100">Change Password</h3>
                         {!showPasswordChange ? (
                             <button onClick={() => setShowPasswordChange(true)} className="mt-2 text-sm text-blue-600 dark:text-blue-400 hover:underline">Change your password</button>
                         ) : (
                             <form onSubmit={handlePasswordChange} className="mt-4 space-y-4">
                                <div>
                                    <label htmlFor="current" className="block text-sm font-medium text-gray-800 dark:text-gray-300">Current Password</label>
                                    <div className="relative mt-1">
                                        <input type={showCurrentPass ? 'text' : 'password'} id="current" value={passwordData.current}
                                            onChange={e => setPasswordData(p => ({ ...p, current: e.target.value }))} required
                                            className="w-full p-2 pr-10 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-200" />
                                        <button type="button" onClick={() => setShowCurrentPass(s => !s)} className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400">
                                            {showCurrentPass ? <EyeSlashIcon className="h-5 w-5" /> : <EyeIcon className="h-5 w-5" />}
                                        </button>
                                    </div>
                                </div>
                                <div>
                                    <label htmlFor="newPass" className="block text-sm font-medium text-gray-800 dark:text-gray-300">New Password</label>
                                    <div className="relative mt-1">
                                        <input type={showNewPass ? 'text' : 'password'} id="newPass" value={passwordData.newPass}
                                            onChange={e => setPasswordData(p => ({ ...p, newPass: e.target.value }))} required
                                            className="w-full p-2 pr-10 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-200" />
                                        <button type="button" onClick={() => setShowNewPass(s => !s)} className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400">
                                            {showNewPass ? <EyeSlashIcon className="h-5 w-5" /> : <EyeIcon className="h-5 w-5" />}
                                        </button>
                                    </div>
                                </div>
                                <div>
                                    <label htmlFor="confirmPass" className="block text-sm font-medium text-gray-800 dark:text-gray-300">Confirm New Password</label>
                                    <input type="password" id="confirmPass" value={passwordData.confirmPass}
                                        onChange={e => setPasswordData(p => ({ ...p, confirmPass: e.target.value }))} required
                                        className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-200" />
                                </div>
                                <div className="flex items-center space-x-2">
                                    <button type="submit" className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md">Update Password</button>
                                    <button type="button" onClick={() => setShowPasswordChange(false)} className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-200 bg-gray-100 dark:bg-gray-600 rounded-md">Cancel</button>
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
                        <ToggleSwitch enabled={notifications.dailyReminder} onChange={(val) => onUpdateSettingsCategory('notifications', { dailyReminder: val })} label="Daily Study Reminders" description="Get reminded to study each day." />
                        <div className="pt-4">
                            <label htmlFor="reminderTime" className="block text-sm font-medium text-lantern-text mb-1">Reminder time</label>
                            <input id="reminderTime" type="time" value={notifications.reminderTime}
                                onChange={(e) => onUpdateSettingsCategory('notifications', { reminderTime: e.target.value })}
                                className="p-2 border border-lantern-border rounded-md bg-lantern-background text-lantern-text" />
                            <p className="text-xs text-lantern-text-secondary mt-1">Currently {formatReminderTime(notifications.reminderTime)}</p>
                        </div>
                        <ToggleSwitch enabled={notifications.groupActivity} onChange={(val) => onUpdateSettingsCategory('notifications', { groupActivity: val })} label="Group Activity" description="Messages and questions in your groups." />
                        <ToggleSwitch enabled={notifications.marketplaceUpdates} onChange={(val) => onUpdateSettingsCategory('notifications', { marketplaceUpdates: val })} label="Marketplace Updates" description="Alerts about listings and messages." />
                        <ToggleSwitch enabled={notifications.badgeUnlocks} onChange={(val) => onUpdateSettingsCategory('notifications', { badgeUnlocks: val })} label="Badge Unlocks" description="Achievement notifications." />
                        <ToggleSwitch enabled={notifications.srsReminders} onChange={(val) => onUpdateSettingsCategory('notifications', { srsReminders: val })} label="SRS Due Card Reminders" description="When flashcards are due for review." />
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
                            <input type="number" min={5} max={100} step={5} value={study.dailyCardGoal}
                                onChange={(e) => onUpdateSettingsCategory('study', { dailyCardGoal: Number(e.target.value) })}
                                className="w-full p-2 border border-lantern-border rounded-md bg-lantern-background text-lantern-text" />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-lantern-text mb-1">Daily test goal</label>
                            <input type="number" min={0} max={10} value={study.dailyTestGoal}
                                onChange={(e) => onUpdateSettingsCategory('study', { dailyTestGoal: Number(e.target.value) })}
                                className="w-full p-2 border border-lantern-border rounded-md bg-lantern-background text-lantern-text" />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-lantern-text mb-1">New SRS cards / day</label>
                            <input type="number" min={5} max={50} step={5} value={study.srsNewCardsPerDay}
                                onChange={(e) => onUpdateSettingsCategory('study', { srsNewCardsPerDay: Number(e.target.value) })}
                                className="w-full p-2 border border-lantern-border rounded-md bg-lantern-background text-lantern-text" />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-lantern-text mb-1">Max SRS interval (days)</label>
                            <input type="number" min={30} max={365} step={30} value={study.srsMaxInterval}
                                onChange={(e) => onUpdateSettingsCategory('study', { srsMaxInterval: Number(e.target.value) })}
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
                            <option value="everyone">Everyone</option>
                            <option value="groups">Group members only</option>
                            <option value="none">Nobody</option>
                        </select>
                    </div>
                    <ToggleSwitch enabled={privacy.discoverableForInvites !== false} onChange={(val) => onUpdateSettingsCategory('privacy', { discoverableForInvites: val })} label="Allow search for invites" description="Let others find you by name or @username when adding group or deck members. Profile visibility still controls who can view your full profile." />
                    <ToggleSwitch enabled={privacy.showOnlineStatus} onChange={(val) => onUpdateSettingsCategory('privacy', { showOnlineStatus: val })} label="Show online status" description="Let others see when you are active." />
                    <ToggleSwitch enabled={privacy.showStudyActivity} onChange={(val) => onUpdateSettingsCategory('privacy', { showStudyActivity: val })} label="Show study activity" description="Share study streaks and activity." />
                 </div>
            );
            case 'marketplace': return (
                <div className="space-y-6">
                    <div>
                        <h3 className="text-lg font-semibold text-lantern-text">Marketplace</h3>
                        <p className="text-sm text-lantern-text-secondary">Set your campus to personalize Explore listings.</p>
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
                        <select
                            value={marketplace.campus_id || ''}
                            onChange={(e) => onUpdateSettingsCategory('marketplace', { campus_id: e.target.value || null })}
                            className="w-full p-2 border border-lantern-border rounded-md bg-lantern-background text-lantern-text"
                        >
                            <option value="">All campuses (no default filter)</option>
                            {campusOptions.map((campus) => (
                                <option key={campus.id} value={campus.id}>
                                    {campus.name} ({campus.city})
                                </option>
                            ))}
                        </select>
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
                    {userSettings.sync.lastSyncTime && (
                        <p className="text-sm text-lantern-text-secondary">Last synced: {new Date(userSettings.sync.lastSyncTime).toLocaleString()}</p>
                    )}
                    <p className="text-sm text-lantern-text-secondary">{syncCopy.savedLocally}</p>
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
                            <a href="mailto:support@lanternstudy.com" className="text-indigo-600 dark:text-indigo-400 underline">
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
                     <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
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
                        className="w-full flex items-center justify-center p-3 mb-3 text-sm font-medium text-indigo-700 bg-indigo-50 hover:bg-indigo-100 rounded-md border border-indigo-200 dark:bg-indigo-900/30 dark:text-indigo-200 dark:border-indigo-800 disabled:opacity-60"
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
                    <button onClick={onLogout} className="w-full flex items-center justify-center p-3 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-md border border-gray-300 dark:bg-gray-700 dark:text-gray-200 dark:border-gray-600">
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
            panelClassName="!p-0 h-[90vh] md:h-[75vh] flex flex-col md:flex-row overflow-hidden border border-lantern-border bg-lantern-surface rounded-lantern-xl"
        >
                <div className="w-full md:w-1/3 bg-lantern-background-secondary border-b md:border-b-0 md:border-r border-lantern-border p-4 flex-shrink-0">
                    <div className="flex justify-between items-center mb-2 md:mb-6">
                        <h2 id="settings-modal-title" className="text-xl font-bold text-lantern-text">Settings</h2>
                        <button onClick={onClose} className="md:hidden text-lantern-text-secondary" aria-label="Close settings">
                            <XCircleIcon className="w-6 h-6" />
                        </button>
                    </div>
                    <nav className="flex space-x-1 md:flex-col md:space-y-1 md:space-x-0 overflow-x-auto pb-2 md:pb-0 md:overflow-x-visible" role="tablist" aria-label="Settings sections">
                        {navItems.map(item => (
                            <button key={item.id} onClick={() => setActiveTab(item.id)}
                                role="tab"
                                aria-selected={activeTab === item.id}
                                aria-current={activeTab === item.id ? 'page' : undefined}
                                className={`flex-shrink-0 md:w-full flex items-center p-2.5 text-sm font-medium rounded-lantern transition-colors ${activeTab === item.id ? 'bg-lantern-primary-background text-lantern-primary-dark' : 'text-lantern-text-secondary hover:bg-lantern-background-secondary'}`}>
                                <item.icon className="w-5 h-5 mr-2 md:mr-3" />
                                <span>{item.label}</span>
                            </button>
                        ))}
                    </nav>
                </div>
                <div className="w-full md:w-2/3 flex flex-col">
                    <div className="flex-grow p-6 overflow-y-auto">{renderContent()}</div>
                     <div className="flex-shrink-0 p-4 border-t border-lantern-border bg-lantern-background-secondary flex justify-end">
                        <Button variant="secondary" onClick={onClose}>Done</Button>
                    </div>
                </div>
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
