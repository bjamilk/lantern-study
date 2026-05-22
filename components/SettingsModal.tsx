

import React, { useState, useEffect, useRef } from 'react';
import { User, NotificationSettings } from '../types';
import { 
    XCircleIcon, UserCircleIcon, BellIcon, ShieldExclamationIcon, 
    EyeIcon, EyeSlashIcon, ArrowRightOnRectangleIcon, TrashIcon,
    CameraIcon 
} from '@heroicons/react/24/outline';
import { compressImage } from '../utils/imageCompression';
import { useUIStore } from '../stores/uiStore';


interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: User;
  settings?: NotificationSettings;
  onUpdateSettings: (newSettings: NotificationSettings) => void;
  onUpdateProfile: (name: string, phone: string) => void;
  onUpdateAvatar: (avatarUrl: string) => void;
  onUpdatePassword: (current: string, newPass: string) => boolean;
  onLogout: () => void;
  onDeleteAccount: () => void;
}

const ToggleSwitch = ({ enabled, onChange, label, description }: { enabled: boolean, onChange: (enabled: boolean) => void, label: string, description: string }) => (
    <div className="flex items-center justify-between py-3 border-b border-gray-200 dark:border-gray-700 last:border-b-0">
        <div>
            <h4 className="text-sm font-medium text-gray-800 dark:text-gray-200">{label}</h4>
            <p className="text-xs text-gray-500 dark:text-gray-400">{description}</p>
        </div>
        <button
            type="button"
            onClick={() => onChange(!enabled)}
            className={`${enabled ? 'bg-blue-600' : 'bg-gray-200 dark:bg-gray-600'} relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-gray-800`}
            role="switch"
            aria-checked={enabled}
        >
            <span className={`${enabled ? 'translate-x-5' : 'translate-x-0'} pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out`} />
        </button>
    </div>
);


const SettingsModal: React.FC<SettingsModalProps> = ({ 
    isOpen, onClose, currentUser, settings, onUpdateSettings, 
    onUpdateProfile, onUpdateAvatar, onUpdatePassword, onLogout, onDeleteAccount
}) => {
    const { lowDataMode, setLowDataMode } = useUIStore();
    const [activeTab, setActiveTab] = useState<'profile' | 'notifications' | 'account'>('profile');
    
    // Profile State
    const [profileData, setProfileData] = useState({ name: currentUser.name, phone: currentUser.phoneNumber || '' });
    const [isProfileDirty, setIsProfileDirty] = useState(false);
    
    // Password State
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
            alert('Please select an image file.');
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
            alert('Failed to process image.');
        } finally {
            // Reset so the same file can be re-selected
            e.target.value = '';
        }
    };

    const handleRemoveAvatar = () => {
        const fallback = `https://ui-avatars.com/api/?name=${currentUser.name.replace(/\s/g, '+')}&background=random&color=fff&size=100`;
        setAvatarPreview(fallback);
        onUpdateAvatar(fallback);
    };

    const handleProfileSave = (e: React.FormEvent) => {
        e.preventDefault();
        onUpdateProfile(profileData.name, profileData.phone);
        setIsProfileDirty(false);
        // Maybe show a success message
    };

    const handlePasswordChange = (e: React.FormEvent) => {
        e.preventDefault();
        if (passwordData.newPass !== passwordData.confirmPass) {
            alert("New passwords do not match.");
            return;
        }
        if(passwordData.newPass.length < 6) {
            alert("New password must be at least 6 characters long.");
            return;
        }
        const success = onUpdatePassword(passwordData.current, passwordData.newPass);
        if (success) {
            setPasswordData({ current: '', newPass: '', confirmPass: '' });
            setShowPasswordChange(false);
        }
    };
    
    const handleSettingToggle = (key: keyof NotificationSettings, value: boolean) => {
        onUpdateSettings({
            dailyReminder: settings?.dailyReminder ?? true,
            groupActivity: settings?.groupActivity ?? true,
            marketplaceUpdates: settings?.marketplaceUpdates ?? true,
            badgeUnlocks: settings?.badgeUnlocks ?? true,
            ...settings,
            [key]: value
        });
    };

    const navItems = [
        { id: 'profile', label: 'Profile', icon: UserCircleIcon },
        { id: 'notifications', label: 'Notifications', icon: BellIcon },
        { id: 'account', label: 'Account', icon: ShieldExclamationIcon },
    ];

    const renderContent = () => {
        switch (activeTab) {
            case 'profile': return (
                <div className="space-y-6">
                    <div>
                        <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-100">Profile Information</h3>
                        <p className="text-sm text-gray-500 dark:text-gray-400">Update your personal details.</p>
                    </div>

                    {/* Profile Picture */}
                    <div className="flex items-center gap-5">
                        <div className="relative group">
                            <img
                                src={avatarPreview || currentUser.avatarUrl || `https://ui-avatars.com/api/?name=${currentUser.name.replace(/\s/g, '+')}&background=6366f1&color=fff&size=80`}
                                alt={currentUser.name}
                                className="w-20 h-20 rounded-full object-cover ring-2 ring-gray-200 dark:ring-gray-600"
                            />
                            <button
                                type="button"
                                onClick={() => avatarInputRef.current?.click()}
                                className="absolute inset-0 flex items-center justify-center rounded-full bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                                title="Change photo"
                            >
                                <CameraIcon className="w-6 h-6 text-white" />
                            </button>
                            <input
                                ref={avatarInputRef}
                                type="file"
                                accept="image/*"
                                className="hidden"
                                onChange={handleAvatarFileChange}
                            />
                        </div>
                        <div className="flex flex-col gap-1.5">
                            <button
                                type="button"
                                onClick={() => avatarInputRef.current?.click()}
                                className="text-sm font-medium text-blue-600 dark:text-blue-400 hover:underline text-left"
                            >
                                Change profile picture
                            </button>
                            <button
                                type="button"
                                onClick={handleRemoveAvatar}
                                className="text-sm text-gray-500 dark:text-gray-400 hover:text-red-500 dark:hover:text-red-400 text-left"
                            >
                                Remove photo
                            </button>
                            <p className="text-xs text-gray-400 dark:text-gray-500">Max 2 MB · JPG, PNG, or GIF</p>
                        </div>
                    </div>

                    <form onSubmit={handleProfileSave} className="space-y-4">
                        <div>
                            <label htmlFor="name" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Full Name</label>
                            <input type="text" name="name" id="name" value={profileData.name} onChange={handleProfileChange} className="mt-1 w-full p-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-200 focus:ring-blue-500 focus:border-blue-500" />
                        </div>
                        <div>
                            <label htmlFor="email" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Email Address</label>
                            <input type="email" name="email" id="email" value={currentUser.email || ''} disabled className="mt-1 w-full p-2 border border-gray-300 dark:border-gray-600 rounded-md bg-gray-100 dark:bg-gray-700/50 cursor-not-allowed text-gray-500 dark:text-gray-400" />
                        </div>
                         <div>
                            <label htmlFor="phone" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Phone Number</label>
                            <input type="tel" name="phone" id="phone" value={profileData.phone} onChange={handleProfileChange} className="mt-1 w-full p-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-200 focus:ring-blue-500 focus:border-blue-500" />
                        </div>
                        {isProfileDirty && <button type="submit" className="w-full px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md shadow-sm">Save Changes</button>}
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
                                        <input type={showCurrentPass ? 'text' : 'password'} id="current" value={passwordData.current} onChange={e => setPasswordData(p => ({...p, current: e.target.value}))} required className="w-full p-2 pr-10 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-200"/>
                                        <button type="button" onClick={() => setShowCurrentPass(s => !s)} className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 dark:text-gray-500">{showCurrentPass ? <EyeSlashIcon className="h-5 w-5"/> : <EyeIcon className="h-5 w-5"/>}</button>
                                    </div>
                                </div>
                                <div>
                                    <label htmlFor="newPass" className="block text-sm font-medium text-gray-800 dark:text-gray-300">New Password</label>
                                    <div className="relative mt-1">
                                        <input type={showNewPass ? 'text' : 'password'} id="newPass" value={passwordData.newPass} onChange={e => setPasswordData(p => ({...p, newPass: e.target.value}))} required className="w-full p-2 pr-10 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-200"/>
                                        <button type="button" onClick={() => setShowNewPass(s => !s)} className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 dark:text-gray-500">{showNewPass ? <EyeSlashIcon className="h-5 w-5"/> : <EyeIcon className="h-5 w-5"/>}</button>
                                    </div>
                                </div>
                                <div>
                                    <label htmlFor="confirmPass" className="block text-sm font-medium text-gray-800 dark:text-gray-300">Confirm New Password</label>
                                    <input type="password" id="confirmPass" value={passwordData.confirmPass} onChange={e => setPasswordData(p => ({...p, confirmPass: e.target.value}))} required className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-200"/>
                                </div>
                                <div className="flex items-center space-x-2">
                                    <button type="submit" className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md">Update Password</button>
                                    <button type="button" onClick={() => setShowPasswordChange(false)} className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-200 bg-gray-100 dark:bg-gray-600 hover:bg-gray-200 dark:hover:bg-gray-500 rounded-md">Cancel</button>
                                </div>
                             </form>
                         )}
                     </div>
                </div>
            );
            case 'notifications': return (
                 <div>
                    <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-100">Notification Settings</h3>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">Control how you receive notifications from the app.</p>
                    <div className="space-y-2">
                        <ToggleSwitch enabled={settings?.dailyReminder ?? true} onChange={(val) => handleSettingToggle('dailyReminder', val)} label="Daily Study Reminders" description="Get a push notification if you haven't studied in 24 hours." />
                        <ToggleSwitch enabled={settings?.groupActivity ?? true} onChange={(val) => handleSettingToggle('groupActivity', val)} label="Group Activity" description="Notify me about new messages and questions in my groups." />
                        <ToggleSwitch enabled={settings?.marketplaceUpdates ?? true} onChange={(val) => handleSettingToggle('marketplaceUpdates', val)} label="Marketplace Updates" description="Receive alerts about your listings and messages." />
                        <ToggleSwitch enabled={settings?.badgeUnlocks ?? true} onChange={(val) => handleSettingToggle('badgeUnlocks', val)} label="Gamification Alerts" description="Notify me when I unlock a new badge or achievement." />
                        <ToggleSwitch enabled={settings?.srsReminders ?? true} onChange={(val) => handleSettingToggle('srsReminders', val)} label="SRS Due Card Reminders" description="Get notifications when you have flashcards due for review." />
                    </div>

                    <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-100 mt-6 mb-1">Preferences</h3>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">Customize your app performance and data usage.</p>
                    <div className="space-y-2">
                        <ToggleSwitch enabled={lowDataMode} onChange={setLowDataMode} label="Low-Data Mode" description="Disable real-time updates and lazy load charts/physics to minimize internet data consumption." />
                    </div>
                 </div>
            );
            case 'account': return (
                 <div>
                     <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-100">Account Actions</h3>
                     <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">Manage your account session and data.</p>
                     <button onClick={onLogout} className="w-full flex items-center justify-center p-3 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-md border border-gray-300 dark:bg-gray-700 dark:text-gray-200 dark:border-gray-600 dark:hover:bg-gray-600">
                         <ArrowRightOnRectangleIcon className="w-5 h-5 mr-2"/>
                         Logout
                     </button>
                     <div className="mt-8 p-4 border border-red-500/30 dark:border-red-600/50 bg-red-50 dark:bg-red-900/20 rounded-lg">
                        <h4 className="font-semibold text-red-700 dark:text-red-300">Danger Zone</h4>
                        <p className="text-xs text-red-600 dark:text-red-400 mt-1 mb-3">Deleting your account is permanent and cannot be undone.</p>
                        <button onClick={onDeleteAccount} className="w-full flex items-center justify-center p-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-md">
                            <TrashIcon className="w-4 h-4 mr-2"/>
                            Delete My Account
                        </button>
                     </div>
                 </div>
            );
            default: return null;
        }
    }
    
    return (
        <div className="fixed inset-0 bg-black bg-opacity-60 dark:bg-opacity-75 flex items-center justify-center p-4 z-[80]" role="dialog" aria-modal="true" aria-labelledby="settings-modal-title">
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-2xl h-[90vh] md:h-[70vh] flex flex-col md:flex-row overflow-hidden">
                {/* Navigation Sidebar */}
                <div className="w-full md:w-1/4 bg-gray-50 dark:bg-gray-900/30 border-b md:border-b-0 md:border-r border-gray-200 dark:border-gray-700 p-4 flex-shrink-0">
                    <h2 id="settings-modal-title" className="text-xl font-bold text-gray-800 dark:text-gray-100 mb-2 md:mb-6">Settings</h2>
                    <nav className="flex space-x-1 md:flex-col md:space-y-2 md:space-x-0 overflow-x-auto pb-2 -mx-4 px-4 md:pb-0 md:mx-0 md:px-0 md:overflow-x-visible">
                        {navItems.map(item => (
                            <button key={item.id} onClick={() => setActiveTab(item.id as any)} className={`flex-shrink-0 md:w-full flex items-center p-3 text-sm font-medium rounded-md transition-colors ${activeTab === item.id ? 'bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'}`}>
                                <item.icon className="w-5 h-5 mr-3"/>
                                <span className="md:inline">{item.label}</span>
                            </button>
                        ))}
                    </nav>
                </div>

                {/* Content Panel */}
                <div className="w-full md:w-3/4 flex flex-col">
                    <div className="flex-grow p-6 overflow-y-auto">
                        {renderContent()}
                    </div>
                     <div className="flex-shrink-0 p-4 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/30 flex justify-end">
                        <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md shadow-sm hover:bg-gray-50 dark:bg-gray-700 dark:text-gray-200 dark:border-gray-600 dark:hover:bg-gray-600">
                            Done
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default SettingsModal;