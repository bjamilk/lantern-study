import { useState, useCallback } from 'react';
import { User, NotificationSettings, TestPreset, TestConfig } from '../types';
import { useAuthStore } from '../stores/authStore';
import { useGroupStore } from '../stores/groupStore';
import { useUIStore } from '../stores/uiStore';
import { initialUserStats, MOCK_USERS } from '../utils/helpers';
import { v4 as uuidv4 } from 'uuid';
import {
    fetchUserProfile, updateUserProfile, createUserProfile,
    saveUserPreferences, supabase, deleteUserAccount
} from '../services/supabase';

export function useAuthHandlers() {
    const { currentUser, setCurrentUser, setAuthLoading } = useAuthStore();
    const { setGroups, setAllMessages, setDmThreads, setAllDirectMessages } = useGroupStore();
    const { theme, setTheme, setSelectedChat } = useUIStore();

    const [users, setUsers] = useState<User[]>(MOCK_USERS);
    const [dataLoaded, setDataLoaded] = useState(false);

    const toggleTheme = useCallback(async () => {
        const newTheme = theme === 'light' ? 'dark' : 'light';
        setTheme(newTheme);
        
        // Always persist to localStorage immediately for quick access on next load
        localStorage.setItem('theme', newTheme);
        
        // Apply theme class to document immediately
        if (newTheme === 'dark') {
            document.documentElement.classList.add('dark');
        } else {
            document.documentElement.classList.remove('dark');
        }
        
        // Persist to user settings in database for cross-device sync
        if (currentUser) {
            const updatedSettings = { ...currentUser.settings, theme: newTheme as 'light' | 'dark' };
            setCurrentUser({ ...currentUser, settings: updatedSettings });
            try {
                await updateUserProfile(currentUser.id, { settings: updatedSettings });
                await saveUserPreferences(currentUser.id, { theme: newTheme });
            } catch (error) {
                console.error('Failed to save theme preference to database:', error);
            }
        }
    }, [theme, currentUser, setTheme, setCurrentUser]);

    const handleLogin = useCallback(async (user: User) => {
        try {
            const profile = await fetchUserProfile(user.id);
            const dbUser: User = {
                id: profile.id,
                name: profile.name,
                avatarUrl: profile.avatar_url,
                email: user.email,
                phoneNumber: profile.phone,
                points: profile.points || 0,
                badges: profile.badges || [],
                stats: profile.stats || initialUserStats,
                settings: profile.settings || {}
            };
            setCurrentUser(dbUser);
            
            if (dbUser.settings?.theme) {
                const userTheme = dbUser.settings.theme;
                setTheme(userTheme);
                localStorage.setItem('theme', userTheme);
                if (userTheme === 'dark') {
                    document.documentElement.classList.add('dark');
                } else {
                    document.documentElement.classList.remove('dark');
                }
            }
        } catch (error) {
            console.log('Creating new user profile for:', user.id);
            try {
                await createUserProfile({
                    id: user.id,
                    name: user.name,
                    avatar_url: user.avatarUrl,
                    phone: user.phoneNumber,
                    points: user.points,
                    stats: user.stats,
                    badges: user.badges,
                    settings: user.settings
                });
                setCurrentUser(user);
            } catch (createError) {
                console.error('Error creating user profile:', createError);
                setCurrentUser(user);
            }
        }
    }, [setCurrentUser, setTheme]);

    const handleLogout = useCallback(async () => {
        localStorage.removeItem('lantern_access_token');
        localStorage.removeItem('lantern_refresh_token');
        
        try {
            await supabase.auth.signOut();
        } catch (e) {
            console.log('Error signing out:', e);
        }
        
        Object.keys(localStorage).forEach(key => {
            if (key.startsWith('sb-') || key.includes('supabase')) {
                localStorage.removeItem(key);
            }
        });
        
        setCurrentUser(null);
        setGroups([]);
        setAllMessages({});
        setSelectedChat(null);
        setDmThreads([]);
        setAllDirectMessages({});
        setDataLoaded(false);
    }, [setCurrentUser, setGroups, setAllMessages, setSelectedChat, setDmThreads, setAllDirectMessages]);

    const handleRegister = useCallback(async (name: string, email: string, password: string, phoneNumber: string) => {
        if (users.some(u => u.email === email)) {
            alert("An account with this email already exists.");
            return;
        }
        const { v4: uuidv4 } = await import('uuid');
        const newUser: User = {
            id: uuidv4(),
            name,
            email,
            password,
            phoneNumber,
            avatarUrl: `https://ui-avatars.com/api/?name=${name.replace(/\s/g, '+')}&background=random&color=fff&size=100`,
            points: 0,
            badges: [],
            stats: initialUserStats
        };

        try {
            await createUserProfile({
                id: newUser.id,
                name: newUser.name,
                avatar_url: newUser.avatarUrl,
                phone: newUser.phoneNumber,
                points: newUser.points,
                stats: newUser.stats,
                badges: newUser.badges
            });
        } catch (error) {
            console.error('Error creating user profile in database:', error);
        }

        setUsers(prev => [...prev, newUser]);
        setCurrentUser(newUser);
    }, [users, setCurrentUser]);

    const handleUpdateSettings = useCallback((newSettings: NotificationSettings) => {
        if (!currentUser) return;
        setCurrentUser({ ...currentUser, settings: newSettings });
        updateUserProfile(currentUser.id, { settings: newSettings }).catch(error => console.error('Failed to update user settings:', error));
    }, [currentUser, setCurrentUser]);

    const handleUpdateProfile = useCallback((name: string, phone: string) => {
        if (!currentUser) return;
        setCurrentUser({ ...currentUser, name, phoneNumber: phone });
        setUsers(prevUsers => prevUsers.map(u => u.id === currentUser.id ? { ...u, name, phoneNumber: phone } : u));
        updateUserProfile(currentUser.id, { name, phone }).catch(error => console.error('Failed to update user profile:', error));
        alert("Profile updated successfully!");
    }, [currentUser, setCurrentUser]);

    const handleUpdateCurrentUserAvatar = useCallback((avatarUrl: string) => {
        if (!currentUser) return;
        setCurrentUser({ ...currentUser, avatarUrl });
        updateUserProfile(currentUser.id, { avatar_url: avatarUrl }).catch(error => console.error('Failed to update user avatar:', error));
    }, [currentUser, setCurrentUser]);

    const handleUpdatePassword = useCallback((current: string, newPass: string): boolean => {
        if (!currentUser) return false;
        if (currentUser.password !== current) {
            alert("Current password does not match.");
            return false;
        }
        const updatedUser = { ...currentUser, password: newPass };
        setCurrentUser(updatedUser);
        setUsers(prevUsers => prevUsers.map(u => u.id === currentUser.id ? updatedUser : u));
        alert("Password updated successfully!");
        return true;
    }, [currentUser, setCurrentUser]);

    const handleDeleteAccount = useCallback(async () => {
        if (window.confirm("Are you absolutely sure you want to delete your account? This action is permanent and cannot be undone.")) {
            if (currentUser) {
                try {
                    const deleted = await deleteUserAccount(currentUser.id);
                    if (deleted) {
                        setUsers(prev => prev.filter(u => u.id !== currentUser.id));
                        await handleLogout();
                    } else {
                        alert('Failed to delete account. Please try again.');
                    }
                } catch (error) {
                    console.error('Error deleting account:', error);
                    alert('Failed to delete account. Please try again.');
                }
            }
        }
    }, [currentUser, handleLogout]);

    const handleSavePreset = useCallback((name: string, config: Omit<TestConfig, 'questionIds' | 'groupId'>) => {
        if (!currentUser) return;
        const newPreset: TestPreset = { id: uuidv4(), name, config };
        const updatedPresets = [...(currentUser.testPresets || []), newPreset];
        setCurrentUser({ ...currentUser, testPresets: updatedPresets });
        updateUserProfile(currentUser.id, { test_presets: updatedPresets }).catch(error => console.error('Failed to save test preset:', error));
        alert(`Preset "${name}" saved!`);
    }, [currentUser, setCurrentUser]);

    const handleDeletePreset = useCallback((id: string) => {
        if (!currentUser) return;
        const updatedPresets = (currentUser.testPresets || []).filter(p => p.id !== id);
        setCurrentUser({ ...currentUser, testPresets: updatedPresets });
        updateUserProfile(currentUser.id, { test_presets: updatedPresets }).catch(error => console.error('Failed to delete test preset:', error));
    }, [currentUser, setCurrentUser]);

    return {
        users,
        setUsers,
        dataLoaded,
        setDataLoaded,
        toggleTheme,
        handleLogin,
        handleLogout,
        handleRegister,
        handleUpdateSettings,
        handleUpdateProfile,
        handleUpdateCurrentUserAvatar,
        handleUpdatePassword,
        handleDeleteAccount,
        handleSavePreset,
        handleDeletePreset,
    };
}
