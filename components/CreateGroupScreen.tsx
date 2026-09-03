import React, { useState, useRef, useEffect } from 'react';
import { useToastStore } from '../stores/toastStore';
import { Course, User, GroupPermissions } from '../types';
import { CoursePicker } from './academic/CoursePicker';
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  UsersIcon,
  CheckIcon,
  CameraIcon,
  LockClosedIcon,
  MagnifyingGlassIcon,
  CheckCircleIcon,
} from '@heroicons/react/24/outline';
import { normalizeUserSearchQuery } from '@lantern/shared';
import { COMMUNITY_COPY, studyGroupsLiveInChatCopy } from '@lantern/shared/network';
import { searchUsers } from '../services/supabase';
import { useCommunityStore } from '../stores/communityStore';
import GroupInviteLinkPanel from './GroupInviteLinkPanel';
import { buildGroupInviteLink } from '../utils/groupInvite';
import GroupDiscoverabilityFields, {
  type GroupDiscoveryValue,
} from './discover/GroupDiscoverabilityFields';

interface SearchResult {
  id: string;
  username: string | null;
  first_name: string | null;
  last_name: string | null;
  name: string;
  avatar_url: string | null;
}

export interface CreatedGroupSummary {
  id: string;
  name: string;
  inviteId: string;
}

interface CreateGroupScreenProps {
  currentUser: User;
  allUsers: User[];
  onCreateGroup: (details: {
    name: string;
    description: string;
    avatarFile: File | null;
    memberIds: string[];
    permissions: GroupPermissions;
    courseId?: string | null;
    visibility?: 'private' | 'community' | 'public';
    communityId?: string | null;
    communitySurface?: 'board' | 'study_group';
  }) => Promise<CreatedGroupSummary | void>;
  onEnterGroup: (group: CreatedGroupSummary) => void;
  onBack: () => void;
  /** Starting discoverability (a channel created inside a community starts as `community`). */
  initialDiscovery?: GroupDiscoveryValue;
  /** New board in `<Community>`: title changes and the listing is read-only. */
  lockedCommunity?: { id: string; name: string };
  /**
   * Which surface a group created inside a community becomes (spec §4.6).
   * 'study_group' shows the `studyGroupsLiveInChat` consequence copy above the
   * Create button — the no-silent-disappearance contract, not optional.
   */
  communitySurface?: 'board' | 'study_group';
  /** Seeds the name (e.g. "Start a study group about this" from a post). */
  initialName?: string;
}

function buildInviteLink(inviteId: string): string {
  return buildGroupInviteLink(inviteId);
}

const ToggleSwitch = ({ enabled, onChange, label }: { enabled: boolean; onChange: (enabled: boolean) => void; label: string; }) => (
  <div className="flex items-center justify-between py-3">
    <span className="text-sm font-medium text-lantern-text">{label}</span>
    <button
      type="button"
      onClick={() => onChange(!enabled)}
      className={`${enabled ? 'bg-lantern-primary' : 'bg-lantern-background-secondary dark:bg-lantern-border'} relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-lantern-primary focus:ring-offset-2 dark:focus:ring-offset-lantern-surface`}
      role="switch"
      aria-checked={enabled}
    >
      <span className={`${enabled ? 'translate-x-5' : 'translate-x-0'} pointer-events-none inline-block h-5 w-5 transform rounded-full bg-lantern-surface shadow ring-0 transition duration-200 ease-in-out`} />
    </button>
  </div>
);

const CreateGroupScreen: React.FC<CreateGroupScreenProps> = ({
  currentUser,
  onCreateGroup,
  onEnterGroup,
  onBack,
  initialDiscovery,
  lockedCommunity,
  communitySurface,
  initialName,
}) => {
  const [step, setStep] = useState<'select_members' | 'group_details' | 'success'>('select_members');
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [selectedUsers, setSelectedUsers] = useState<SearchResult[]>([]);
  const [groupName, setGroupName] = useState(initialName ?? '');
  const [groupDescription, setGroupDescription] = useState('');
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [course, setCourse] = useState<Course | null>(null);
  const [permissions, setPermissions] = useState<GroupPermissions>({
    canSendMessages: true,
    canAddMembers: true,
    canEditSettings: false,
    canApproveMembers: false,
  });
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [createdGroup, setCreatedGroup] = useState<CreatedGroupSummary | null>(null);
  const [discovery, setDiscovery] = useState<GroupDiscoveryValue>(
    () => initialDiscovery ?? { visibility: 'private', communityId: null }
  );
  const isStudyGroup = communitySurface === 'study_group';
  const screenTitle = lockedCommunity
    ? isStudyGroup
      ? COMMUNITY_COPY.newStudyGroupTitle(lockedCommunity.name)
      : COMMUNITY_COPY.newBoardTitle(lockedCommunity.name)
    : 'New Group';

  const avatarFileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (normalizeUserSearchQuery(searchTerm).length < 2) {
      setSearchResults([]);
      setSearchError('');
      return;
    }

    setIsSearching(true);
    setSearchError('');

    const timeoutId = setTimeout(async () => {
      try {
        const data = await searchUsers(searchTerm.trim(), 20);
        const filtered = (data || []).filter((user: SearchResult) => !selectedUserIds.includes(user.id));
        setSearchResults(filtered);
      } catch (err) {
        console.error('Search failed:', err);
        setSearchResults([]);
        setSearchError(err instanceof Error ? err.message : 'Failed to search. Please try again.');
      } finally {
        setIsSearching(false);
      }
    }, 300);

    return () => clearTimeout(timeoutId);
  }, [searchTerm, currentUser.id, selectedUserIds]);

  const handleUserSelect = (user: SearchResult) => {
    setSelectedUserIds((prev) => [...prev, user.id]);
    setSelectedUsers((prev) => [...prev, user]);
    setSearchTerm('');
    setSearchResults([]);
  };

  const handleUserRemove = (userId: string) => {
    setSelectedUserIds((prev) => prev.filter((id) => id !== userId));
    setSelectedUsers((prev) => prev.filter((u) => u.id !== userId));
  };

  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setAvatarFile(file);
      const reader = new FileReader();
      reader.onloadend = () => setAvatarPreview(reader.result as string);
      reader.readAsDataURL(file);
    }
  };

  const handleCreate = async () => {
    if (!groupName.trim()) {
      useToastStore.getState().showToast('Please enter a group name.', 'error');
      return;
    }
    setIsCreating(true);
    try {
      const result = await onCreateGroup({
        name: groupName,
        description: groupDescription,
        avatarFile,
        memberIds: selectedUserIds,
        permissions,
        courseId: course?.id ?? null,
        visibility: discovery.visibility,
        communityId: discovery.communityId,
        ...(discovery.communityId && communitySurface ? { communitySurface } : {}),
      });
      if (result?.inviteId) {
        // The community's channel list is cached; the new channel must show on return.
        if (lockedCommunity) useCommunityStore.getState().invalidate(lockedCommunity.id);
        setCreatedGroup(result);
        setStep('success');
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsCreating(false);
    }
  };

  const inviteLink = createdGroup ? buildInviteLink(createdGroup.inviteId) : '';

  const getAvatarUrl = (user: SearchResult) => {
    if (user.avatar_url) return user.avatar_url;
    const name = user.name || `${user.first_name || ''} ${user.last_name || ''}`.trim() || 'User';
    return `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=random&color=fff&size=40`;
  };

  if (step === 'success' && createdGroup) {
    return (
      <div className="flex flex-col flex-1 min-h-0 h-full bg-lantern-background">
        <header className="bg-lantern-surface shadow-sm p-4 flex items-center shrink-0">
          <div>
            <h1 className="text-xl font-semibold text-lantern-text dark:text-lantern-text">Group created</h1>
            <p className="text-sm text-lantern-text-secondary">{createdGroup.name}</p>
          </div>
        </header>
        <div className="flex-1 min-h-0 overflow-y-auto p-6 flex flex-col items-center justify-center">
          <CheckCircleIcon className="w-16 h-16 text-emerald-500 mb-4" />
          <h2 className="text-lg font-semibold text-lantern-text dark:text-lantern-text mb-2">Share your invite link</h2>
          <p className="text-sm text-lantern-text-secondary mb-6 text-center max-w-md">
            Anyone with this link can request to join. They will choose to accept or decline before joining.
          </p>
          <div className="w-full max-w-md">
            <GroupInviteLinkPanel inviteLink={inviteLink} groupName={createdGroup.name} />
          </div>
        </div>
        <div className="shrink-0 sticky bottom-0 p-4 bg-lantern-surface border-t dark:border-lantern-border">
          <button
            type="button"
            onClick={() => onEnterGroup(createdGroup)}
            className="w-full py-3 bg-green-600 text-white rounded-lg font-semibold hover:bg-green-700"
          >
            Go to group
          </button>
        </div>
      </div>
    );
  }

  if (step === 'select_members') {
    return (
      <div key="step-select" className="flex flex-col flex-1 min-h-0 h-full bg-lantern-background">
        <header className="bg-lantern-surface shadow-sm p-4 flex items-center shrink-0">
          <button type="button" onClick={onBack} className="p-2 mr-4 rounded-full hover:bg-lantern-background-secondary dark:hover:bg-lantern-surface-secondary">
            <ArrowLeftIcon className="w-6 h-6 text-lantern-text" />
          </button>
          <div>
            <h1 className="text-xl font-semibold text-lantern-text dark:text-lantern-text">{screenTitle}</h1>
            <p className="text-sm text-lantern-text-secondary">
              Add members by name or @username (e.g. <span className="font-medium text-lantern-text">@janedoe</span>)
            </p>
          </div>
        </header>

        <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
          <div className="relative">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <MagnifyingGlassIcon className="h-5 w-5 text-lantern-text-tertiary" />
            </div>
            <input
              type="text"
              value={searchTerm ?? ''}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 p-3 border border-lantern-border dark:bg-lantern-surface-secondary dark:text-lantern-text rounded-lg focus:ring-lantern-primary focus:border-lantern-primary"
              placeholder="Search by name or @username…"
              autoFocus
            />
          </div>

          {isSearching && (
            <div className="flex justify-center py-4">
              <svg className="animate-spin h-6 w-6 text-lantern-primary" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
            </div>
          )}

          {!isSearching && searchError && (
            <div className="p-4 text-center text-sm text-red-500 bg-red-50 dark:bg-red-900/20 rounded-lg">{searchError}</div>
          )}

          {!isSearching && !searchError && searchTerm.length >= 2 && searchResults.length === 0 && (
            <div className="text-center py-8">
              <UsersIcon className="w-12 h-12 mx-auto text-lantern-text-tertiary dark:text-lantern-text-secondary mb-3" />
              <p className="text-sm text-lantern-text-secondary">No users found matching &quot;{searchTerm}&quot;</p>
              <p className="text-xs text-lantern-text-tertiary mt-2 max-w-xs mx-auto">
                Try their @username, or ask them to set one in Settings if they do not have one yet.
              </p>
            </div>
          )}

          {!isSearching && searchResults.length > 0 && (
            <div className="bg-lantern-surface rounded-lg shadow-sm overflow-hidden">
              <ul className="divide-y divide-lantern-border">
                {searchResults.map((user) => (
                  <li key={user.id}>
                    <button
                      type="button"
                      onClick={() => handleUserSelect(user)}
                      className="w-full p-3 flex items-center text-left hover:bg-lantern-background dark:hover:bg-lantern-surface-secondary"
                    >
                      <img src={getAvatarUrl(user)} alt={user.name} className="w-10 h-10 rounded-full mr-3" />
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-lantern-text truncate">{user.name}</p>
                        {user.username && <p className="text-sm text-lantern-primary">@{user.username}</p>}
                      </div>
                      <CheckIcon className="w-5 h-5 text-lantern-primary" />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {selectedUsers.length > 0 && (
            <div className="bg-lantern-surface rounded-lg shadow-sm p-4">
              <h3 className="text-sm font-semibold text-lantern-text mb-3">
                Selected Members ({selectedUsers.length})
              </h3>
              <div className="flex flex-wrap gap-2">
                {selectedUsers.map((user) => (
                  <div
                    key={user.id}
                    className="flex items-center bg-blue-50 dark:bg-blue-900/50 text-blue-800 dark:text-blue-200 px-3 py-1.5 rounded-full text-sm"
                  >
                    <img src={getAvatarUrl(user)} alt={user.name} className="w-5 h-5 rounded-full mr-2" />
                    <span>{user.username ? `@${user.username}` : user.name}</span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleUserRemove(user.id);
                      }}
                      className="ml-2 text-lantern-primary hover:text-blue-800"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

        </div>

        <div className="shrink-0 sticky bottom-0 p-4 bg-lantern-surface border-t dark:border-lantern-border">
          <button
            type="button"
            onClick={() => setStep('group_details')}
            className={`w-full py-3 text-white rounded-lg font-semibold flex items-center justify-center ${
              selectedUserIds.length > 0
                ? 'bg-lantern-primary hover:bg-lantern-primary-dark'
                : 'bg-slate-500 hover:bg-slate-600 dark:bg-slate-500 dark:hover:bg-slate-400'
            }`}
          >
            {selectedUserIds.length > 0 ? (
              <>
                Next <ArrowRightIcon className="w-5 h-5 ml-2" />
              </>
            ) : (
              'Skip - Create Group Without Members'
            )}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div key="step-details" className="flex flex-col flex-1 min-h-0 h-full bg-lantern-background">
      <header className="bg-lantern-surface shadow-sm p-4 flex items-center shrink-0">
        <button type="button" onClick={() => setStep('select_members')} className="p-2 mr-4 rounded-full hover:bg-lantern-background-secondary dark:hover:bg-lantern-surface-secondary">
          <ArrowLeftIcon className="w-6 h-6 text-lantern-text" />
        </button>
        <div>
          <h1 className="text-xl font-semibold text-lantern-text dark:text-lantern-text">Group Details & Permissions</h1>
          <p className="text-sm text-lantern-text-secondary">{selectedUserIds.length + 1} members selected</p>
        </div>
      </header>
      <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-6">
        <div className="flex flex-col items-center space-y-3">
          <button
            type="button"
            onClick={() => avatarFileRef.current?.click()}
            className="relative w-24 h-24 rounded-full bg-lantern-background-secondary dark:bg-lantern-surface-secondary flex items-center justify-center group"
          >
            {avatarPreview ? (
              <img src={avatarPreview} alt="Group avatar preview" className="w-full h-full object-cover rounded-full" />
            ) : (
              <UsersIcon className="w-12 h-12 text-lantern-text-tertiary" />
            )}
            <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-40 rounded-full flex items-center justify-center transition-opacity">
              <CameraIcon className="w-8 h-8 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
          </button>
          <input type="file" ref={avatarFileRef} onChange={handleAvatarChange} accept="image/*" className="hidden" />
          <input
            type="text"
            value={groupName ?? ''}
            onChange={(e) => setGroupName(e.target.value)}
            placeholder="Group Name (Required)"
            className="w-full max-w-sm p-2 text-center text-lg font-semibold border-b-2 focus:border-lantern-primary focus:outline-none bg-transparent dark:text-lantern-text dark:border-lantern-border"
            required
          />
          <textarea
            value={groupDescription ?? ''}
            onChange={(e) => setGroupDescription(e.target.value)}
            placeholder="Optional: Add group description"
            rows={2}
            className="w-full max-w-sm p-2 text-center text-sm border rounded-md focus:border-lantern-primary focus:outline-none bg-lantern-surface dark:bg-lantern-surface-secondary dark:text-lantern-text dark:border-lantern-border"
          />
        </div>

        <div className="max-w-sm mx-auto p-4 bg-lantern-surface rounded-lg shadow-sm">
          <CoursePicker
            id="create-group-course"
            label={<>Course <span className="text-lantern-text-tertiary font-normal">(optional)</span></>}
            value={course}
            onChange={setCourse}
            placeholder="Which course does this group study?"
            hint="Tests and questions from this group get filed under the course."
          />
        </div>

        <div className="max-w-sm mx-auto p-4 bg-lantern-surface rounded-lg shadow-sm">
          <GroupDiscoverabilityFields value={discovery} onChange={setDiscovery} lockedCommunity={lockedCommunity} />
        </div>

        <div className="max-w-sm mx-auto p-4 bg-lantern-surface rounded-lg shadow-sm">
          <h3 className="font-semibold text-lantern-text flex items-center mb-2">
            <LockClosedIcon className="w-5 h-5 mr-2 text-lantern-text-secondary" />
            Member Permissions
          </h3>
          <div className="divide-y divide-lantern-border">
            <ToggleSwitch enabled={permissions.canSendMessages} onChange={(val) => setPermissions((p) => ({ ...p, canSendMessages: val }))} label="Send Messages" />
            <ToggleSwitch enabled={permissions.canAddMembers} onChange={(val) => setPermissions((p) => ({ ...p, canAddMembers: val }))} label="Add Other Members" />
            <ToggleSwitch enabled={permissions.canEditSettings} onChange={(val) => setPermissions((p) => ({ ...p, canEditSettings: val }))} label="Edit Group Info" />
            <ToggleSwitch enabled={permissions.canApproveMembers} onChange={(val) => setPermissions((p) => ({ ...p, canApproveMembers: val }))} label="Approve New Members" />
          </div>
        </div>
      </div>
      <div className="shrink-0 sticky bottom-0 p-4 bg-lantern-surface border-t dark:border-lantern-border">
        {/* The ONE place a member is told where the study apparatus went (§4.6). */}
        {isStudyGroup && lockedCommunity ? (
          <p className="mx-auto mb-3 max-w-sm text-xs text-lantern-text-secondary">
            {studyGroupsLiveInChatCopy(lockedCommunity.name)}
          </p>
        ) : null}
        <button
          type="button"
          onClick={() => void handleCreate()}
          disabled={!groupName.trim() || isCreating}
          className="w-full py-3 bg-green-600 text-white rounded-lg font-semibold flex items-center justify-center disabled:opacity-50 hover:bg-green-700"
        >
          {isCreating ? 'Creating…' : (
            <>
              Create Group <CheckIcon className="w-5 h-5 ml-2" />
            </>
          )}
        </button>
      </div>
    </div>
  );
};

export default CreateGroupScreen;
