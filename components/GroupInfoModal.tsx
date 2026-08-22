import React, { useState, useEffect, useRef } from 'react';
import { useToastStore } from '../stores/toastStore';
import { Group, User } from '../types';
import { CameraIcon, PhotoIcon, XCircleIcon, CheckCircleIcon, ArrowUpOnSquareIcon, ShieldCheckIcon, UserPlusIcon, UserMinusIcon, ArchiveBoxIcon, TrashIcon, EnvelopeIcon, ChatBubbleLeftRightIcon, ArrowUpTrayIcon, ArrowDownTrayIcon, ArrowRightOnRectangleIcon } from '@heroicons/react/24/outline';
import { SparklesIcon } from '@heroicons/react/24/solid';
import { compressImage } from '../utils/imageCompression';
import GroupInviteLinkPanel from './GroupInviteLinkPanel';
import { buildGroupInviteLink } from '../utils/groupInvite';
import Modal from './ui/Modal';
import { Tabs, TabList, Tab, TabPanel } from './ui';
import ReportContentModal from './moderation/ReportContentModal';
import { FlagIcon } from '@heroicons/react/24/outline';


interface GroupInfoModalProps {
  isOpen: boolean;
  onClose: () => void;
  group: Group;
  currentUser: User; 
  onUpdateDetails: (groupId: string, name: string, description: string) => void;
  onUpdateGroupAvatar: (groupId: string, avatarUrl: string) => void | Promise<void>;
  onPromoteToAdmin: (groupId: string, userId: string) => void;
  onDemoteAdmin: (groupId: string, userId: string) => void;
  onRemoveMember: (groupId: string, userId: string) => void;
  onLeaveGroup: (groupId: string) => void;
  onDeleteGroup: (groupId: string) => void;
  onToggleArchiveGroup: (groupId: string) => void;
  onChallengeUser: (user: User) => void;
  onApproveMember: (groupId: string, userId: string) => void;
  onRejectMember: (groupId: string, userId: string) => void;
  onOpenAddMembersModal: () => void;
  onRevokeInvitation: (groupId: string, email: string) => void;
  onRevokePhoneInvitation: (groupId: string, phoneNumber: string) => void;
  onInitiateDm: (userId: string) => void;
}

const GroupInfoModal: React.FC<GroupInfoModalProps> = ({ 
    isOpen, 
    onClose, 
    group, 
    currentUser, 
    onUpdateDetails, 
    onUpdateGroupAvatar,
    onPromoteToAdmin,
    onDemoteAdmin,
    onRemoveMember,
    onLeaveGroup,
    onDeleteGroup,
    onToggleArchiveGroup,
    onChallengeUser,
    onApproveMember,
    onRejectMember,
    onOpenAddMembersModal,
    onRevokeInvitation,
    onRevokePhoneInvitation,
    onInitiateDm,
}) => {
  const [activeTab, setActiveTab] = useState<'details' | 'members' | 'danger'>('details');
  const [name, setName] = useState(group.name);
  const [reportOpen, setReportOpen] = useState(false);
  const [description, setDescription] = useState(group.description || '');
  const [detailsChanged, setDetailsChanged] = useState(false);

  const [selectedAvatarFile, setSelectedAvatarFile] = useState<File | null>(null);
  const [avatarPreviewUrl, setAvatarPreviewUrl] = useState<string | null>(null);
  const avatarFileRef = useRef<HTMLInputElement>(null);


  useEffect(() => {
    if (isOpen) {
      setActiveTab('details');
      setName(group.name);
      setDescription(group.description || '');
      setDetailsChanged(false);
      setSelectedAvatarFile(null);
      if (avatarPreviewUrl) URL.revokeObjectURL(avatarPreviewUrl);
      setAvatarPreviewUrl(null);
      if (avatarFileRef.current) {
        avatarFileRef.current.value = ""; 
      }
    }
  }, [isOpen, group]); 

  useEffect(() => {
    const currentPreviewUrl = avatarPreviewUrl;
    return () => {
      if (currentPreviewUrl) {
        URL.revokeObjectURL(currentPreviewUrl);
      }
    };
  }, [avatarPreviewUrl]);

  if (!isOpen) return null;

  const handleDetailsSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (name.trim() && (name.trim() !== group.name || description.trim() !== (group.description || ''))) {
      onUpdateDetails(group.id, name.trim(), description.trim());
      setDetailsChanged(false); 
    }
  };

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setName(e.target.value);
    setDetailsChanged(e.target.value.trim() !== group.name || description !== (group.description || ''));
  };

  const handleDescriptionChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setDescription(e.target.value);
    setDetailsChanged(name.trim() !== group.name || e.target.value.trim() !== (group.description || ''));
  };
  
  const handleAvatarFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      if (file.size > 2 * 1024 * 1024) { 
        useToastStore.getState().showToast("Image is too large. Please select an image under 2MB.", 'error');
        event.target.value = ""; 
        return;
      }
      setSelectedAvatarFile(file);
      if (avatarPreviewUrl) URL.revokeObjectURL(avatarPreviewUrl); 
      setAvatarPreviewUrl(URL.createObjectURL(file));
    }
  };

  const convertFileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = error => reject(error);
    });
  };

  const handleSaveAvatar = async () => {
    if (selectedAvatarFile) {
      try {
        const base64Avatar = await compressImage(selectedAvatarFile, {
          maxWidth: 150,
          maxHeight: 150,
          quality: 0.7,
          outputType: 'base64'
        }) as string;
        await onUpdateGroupAvatar(group.id, base64Avatar);
        setSelectedAvatarFile(null); 
        if (avatarPreviewUrl) URL.revokeObjectURL(avatarPreviewUrl);
        setAvatarPreviewUrl(null);
        if (avatarFileRef.current) avatarFileRef.current.value = "";
        useToastStore.getState().showToast('Group avatar updated.', 'success');
      } catch (error) {
        console.error("Error saving group avatar:", error);
        useToastStore.getState().showToast(
          error instanceof Error ? error.message : 'Error saving avatar. Please try again.',
          'error'
        );
      }
    }
  };
  
  const handleRemoveAvatarPreview = () => {
    setSelectedAvatarFile(null);
    if (avatarPreviewUrl) URL.revokeObjectURL(avatarPreviewUrl);
    setAvatarPreviewUrl(null);
    if (avatarFileRef.current) avatarFileRef.current.value = "";
  };

  const isCurrentUserAdmin = group.adminIds?.includes(currentUser.id) || false;
  const isSoleAdmin =
    isCurrentUserAdmin && (group.adminIds?.length || 0) <= 1;
  
  const inviteLink = group.inviteId ? buildGroupInviteLink(group.inviteId) : '';

  const pendingEmailInvites = (group.memberEmails || []).filter(email => !(group.members || []).some(m => m.email === email) && email !== currentUser.email);
  const pendingPhoneInvites = group.invitedPhoneNumbers || [];
  const hasPendingInvites = pendingEmailInvites.length > 0 || pendingPhoneInvites.length > 0;

  const renderContent = (tab: 'details' | 'members' | 'danger' = activeTab) => {
      switch (tab) {
        case 'details':
            return (
                 <form onSubmit={handleDetailsSubmit} className="space-y-4">
                    <div className="mb-6 pb-6 border-b border-lantern-border">
                        <h3 className="text-md font-medium text-lantern-text mb-3">Group Avatar</h3>
                        <div className="flex items-start space-x-4">
                            <img 
                                src={avatarPreviewUrl || group.avatarUrl || `https://ui-avatars.com/api/?name=${group.name.replace(/\s/g, '+')}&background=random&color=fff&size=100`} 
                                alt={`${group.name} avatar`}
                                className="w-20 h-20 rounded-full object-cover border-2 border-lantern-border dark:border-lantern-border flex-shrink-0"
                                onError={(e) => { e.currentTarget.src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='%239ca3af' viewBox='0 0 24 24'%3E%3Cpath d='M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z'/%3E%3C/svg%3E"; }}
                            />
                            <div className="flex-grow">
                                <button type="button" onClick={() => avatarFileRef.current?.click()} className="w-full sm:w-auto mb-2 px-3 py-1.5 text-sm font-medium text-blue-700 dark:text-blue-300 bg-blue-100 dark:bg-blue-900/40 hover:bg-blue-200 dark:hover:bg-blue-900/60 border border-lantern-primary/30 dark:border-blue-700 rounded-md shadow-sm flex items-center justify-center">
                                    <ArrowUpOnSquareIcon className="w-4 h-4 mr-1.5" />
                                    {selectedAvatarFile ? 'Change Image' : 'Upload Image'}
                                </button>
                                <input type="file" ref={avatarFileRef} onChange={handleAvatarFileChange} accept="image/*" className="hidden" />
                                
                                {selectedAvatarFile && (
                                    <div className="mt-2 space-y-2">
                                        <p className="text-xs text-lantern-text-secondary truncate">Preview: <span className="font-medium">{selectedAvatarFile.name}</span></p>
                                        <div className="flex items-center space-x-2">
                                            <button type="button" onClick={handleSaveAvatar} className="px-3 py-1.5 text-sm font-medium text-white bg-green-600 hover:bg-green-700 border border-transparent rounded-md shadow-sm flex items-center">
                                                <CheckCircleIcon className="w-4 h-4 mr-1.5" /> Save Avatar
                                            </button>
                                            <button type="button" onClick={handleRemoveAvatarPreview} className="p-1.5 text-red-500 hover:text-red-700 rounded-md hover:bg-red-100 dark:hover:bg-red-900/30" title="Cancel image change">
                                                <XCircleIcon className="w-5 h-5"/>
                                            </button>
                                        </div>
                                    </div>
                                )}
                                <p className="text-xs text-lantern-text-secondary mt-2">Max file size: 2MB.</p>
                            </div>
                        </div>
                    </div>
                    <div>
                        <label htmlFor="groupInfoName" className="block text-sm font-medium text-lantern-text mb-1">Group Name</label>
                        <input type="text" id="groupInfoName" value={name} onChange={handleNameChange} className="w-full p-2 border border-lantern-border dark:bg-lantern-surface-secondary dark:text-lantern-text rounded-md" required />
                    </div>
                    <div>
                        <label htmlFor="groupInfoDescription" className="block text-sm font-medium text-lantern-text mb-1">Description</label>
                        <textarea id="groupInfoDescription" value={description} onChange={handleDescriptionChange} rows={3} className="w-full p-2 border border-lantern-border dark:bg-lantern-surface-secondary dark:text-lantern-text rounded-md" />
                    </div>
                    {detailsChanged && <button type="submit" className="w-full px-4 py-2 text-sm font-medium text-white bg-lantern-primary hover:bg-lantern-primary-dark rounded-md">Save Changes</button>}
                </form>
            );
        case 'members':
            return (
                <div className="space-y-6">
                     {isCurrentUserAdmin && inviteLink && (
                        <GroupInviteLinkPanel
                          inviteLink={inviteLink}
                          groupName={group.name}
                          compact
                        />
                     )}
                     {isCurrentUserAdmin && (
                        <div className="p-4 bg-lantern-background dark:bg-lantern-surface-secondary/50 border border-lantern-border dark:border-lantern-border rounded-lg">
                           <button onClick={onOpenAddMembersModal} className="w-full flex items-center justify-center px-4 py-2 bg-lantern-primary hover:bg-lantern-primary-dark text-white rounded-md text-sm font-medium"><UserPlusIcon className="w-5 h-5 mr-2" />Add or Invite Members</button>
                        </div>
                     )}

                     {isCurrentUserAdmin && group.pendingMembers && group.pendingMembers.length > 0 && (
                        <div>
                             <h3 className="font-semibold text-lantern-text dark:text-lantern-text mb-2">Pending Join Requests ({group.pendingMembers.length})</h3>
                            <div className="space-y-2">
                            {group.pendingMembers.map(member => (
                                <div key={member.id} className="flex items-center justify-between p-2 bg-yellow-50 dark:bg-yellow-900/30 border-l-4 border-yellow-400 rounded">
                                    <div className="flex items-center">
                                        <img src={member.avatarUrl} alt={member.name} className="w-8 h-8 rounded-full mr-3" onError={(e) => { e.currentTarget.src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='%239ca3af' viewBox='0 0 24 24'%3E%3Cpath d='M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z'/%3E%3C/svg%3E"; }}/>
                                        <span className="text-sm font-medium text-lantern-text dark:text-lantern-text">{member.name}</span>
                                    </div>
                                    <div className="flex space-x-2">
                                        <button onClick={() => onApproveMember(group.id, member.id)} className="p-1.5 bg-green-100 dark:bg-green-800 text-green-700 dark:text-green-200 rounded-full hover:bg-green-200 dark:hover:bg-green-700"><CheckCircleIcon className="w-5 h-5"/></button>
                                        <button onClick={() => onRejectMember(group.id, member.id)} className="p-1.5 bg-red-100 dark:bg-red-800 text-red-700 dark:text-red-200 rounded-full hover:bg-red-200 dark:hover:bg-red-700"><XCircleIcon className="w-5 h-5"/></button>
                                    </div>
                                </div>
                            ))}
                            </div>
                        </div>
                     )}

                     <div>
                        <h3 className="font-semibold text-lantern-text dark:text-lantern-text mb-2">Members ({(group.members || []).length})</h3>
                        <div className="space-y-2">
                            {(group.members || []).map(member => (
                                <div key={member.id} className="flex items-center justify-between p-2 rounded hover:bg-lantern-background dark:hover:bg-lantern-surface-secondary/50">
                                    <div className="flex items-center">
                                        <img src={member.avatarUrl} alt={member.name} className="w-8 h-8 rounded-full mr-3" onError={(e) => { e.currentTarget.src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='%239ca3af' viewBox='0 0 24 24'%3E%3Cpath d='M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z'/%3E%3C/svg%3E"; }}/>
                                        <span className="text-sm font-medium text-lantern-text dark:text-lantern-text">{member.name}</span>
                                        {group.adminIds?.includes(member.id) && <ShieldCheckIcon className="w-4 h-4 text-lantern-primary ml-2" title="Admin"/>}
                                        {member.id === currentUser.id && <span className="text-xs text-lantern-text-secondary ml-2">(You)</span>}
                                    </div>
                                    <div className="flex items-center space-x-1">
                                        {member.id !== currentUser.id && (
                                            <button onClick={() => onChallengeUser(member)} className="p-1.5 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/40 rounded-full" title="Challenge to a Duel">
                                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5"><path fillRule="evenodd" d="M3.53 2.47a.75.75 0 00-1.06 1.06l18 18a.75.75 0 101.06-1.06l-18-18zM21.625 5.375a.75.75 0 00-1.25-1.125L18 6.69l-1.92-1.92a.75.75 0 00-1.06 1.06l1.92 1.92-2.094 2.093a.75.75 0 00-1.06 1.06L15.75 10.5H13.5a.75.75 0 000 1.5h2.25l-2.094 2.093a.75.75 0 00-1.06 1.06L14.56 17.12l-1.92 1.92a.75.75 0 101.06 1.06l1.92-1.92 2.435 2.435a.75.75 0 001.25-1.125L6.94 5.375l14.686-.001z" clipRule="evenodd" /></svg>
                                            </button>
                                        )}
                                        {isCurrentUserAdmin && member.id !== currentUser.id && (
                                            <>
                                                {group.adminIds?.includes(member.id) ? (
                                                    <button onClick={() => onDemoteAdmin(group.id, member.id)} className="p-1.5 text-yellow-600 dark:text-yellow-400 hover:bg-yellow-100 dark:hover:bg-yellow-900/40 rounded-full" title="Demote from Admin"><ArrowDownTrayIcon className="w-5 h-5"/></button>
                                                ) : (
                                                    <button onClick={() => onPromoteToAdmin(group.id, member.id)} className="p-1.5 text-green-600 dark:text-green-400 hover:bg-green-100 dark:hover:bg-green-900/40 rounded-full" title="Promote to Admin"><ArrowUpTrayIcon className="w-5 h-5"/></button>
                                                )}
                                                <button
                                                  type="button"
                                                  onClick={() => onRemoveMember(group.id, member.id)}
                                                  className="p-1.5 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/40 rounded-full"
                                                  title="Remove from group"
                                                >
                                                  <UserMinusIcon className="w-5 h-5" />
                                                </button>
                                            </>
                                        )}
                                        {member.id !== currentUser.id && (
                                             <button onClick={() => onInitiateDm(member.id)} className="p-1.5 text-lantern-text-secondary dark:text-lantern-text-tertiary hover:bg-lantern-background-secondary dark:hover:bg-lantern-border rounded-full" title="Message"><ChatBubbleLeftRightIcon className="w-5 h-5"/></button>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                     </div>
                     {isCurrentUserAdmin && hasPendingInvites && (
                        <div>
                            <h3 className="font-semibold text-lantern-text dark:text-lantern-text mb-2">Pending Invitations ({pendingEmailInvites.length + pendingPhoneInvites.length})</h3>
                             <div className="space-y-2">
                                {pendingEmailInvites.map(email => (
                                    <div key={email} className="flex items-center justify-between p-2 rounded bg-lantern-background-secondary dark:bg-lantern-surface-secondary">
                                        <span className="text-sm text-lantern-text-secondary dark:text-lantern-text-tertiary italic">{email}</span>
                                        <button onClick={() => onRevokeInvitation(group.id, email)} className="text-xs text-red-600 dark:text-red-400 hover:underline">Revoke</button>
                                    </div>
                                ))}
                                {pendingPhoneInvites.map(phone => (
                                    <div key={phone} className="flex items-center justify-between p-2 rounded bg-lantern-background-secondary dark:bg-lantern-surface-secondary">
                                        <span className="text-sm text-lantern-text-secondary dark:text-lantern-text-tertiary italic">{phone}</span>
                                        <button onClick={() => onRevokePhoneInvitation(group.id, phone)} className="text-xs text-red-600 dark:text-red-400 hover:underline">Revoke</button>
                                    </div>
                                ))}
                            </div>
                        </div>
                     )}
                </div>
            );
        case 'danger':
            return (
                <div className="space-y-4">
                    <div className="p-4 border border-lantern-border bg-lantern-background-secondary/40 rounded-lg">
                        <h4 className="font-semibold text-lantern-text">Report Group</h4>
                        <p className="text-xs text-lantern-text-secondary mt-1 mb-3">
                          Leaked exams, scams, harassment or spam in this group? Tell Lantern moderation. Reports are private.
                        </p>
                        <button
                          type="button"
                          onClick={() => setReportOpen(true)}
                          className="w-full flex items-center justify-center p-2 text-sm font-medium text-lantern-text border border-lantern-border rounded-md hover:bg-lantern-background-secondary"
                        >
                            <FlagIcon className="w-4 h-4 mr-2"/>
                            Report Group…
                        </button>
                    </div>
                    <div className="p-4 border border-orange-500/30 dark:border-orange-600/50 bg-orange-50 dark:bg-orange-900/30 rounded-lg">
                        <h4 className="font-semibold text-orange-800 dark:text-orange-300">Leave Group</h4>
                        <p className="text-xs text-orange-700 dark:text-orange-400 mt-1 mb-3">
                          {isSoleAdmin
                            ? 'You are the only admin. Promote another member before leaving.'
                            : 'You will lose access to this group until someone invites you again.'}
                        </p>
                        <button
                          type="button"
                          disabled={isSoleAdmin}
                          onClick={() => onLeaveGroup(group.id)}
                          className={`w-full flex items-center justify-center p-2 text-sm font-medium text-white rounded-md ${
                            isSoleAdmin
                              ? 'bg-orange-300 cursor-not-allowed'
                              : 'bg-orange-500 hover:bg-orange-600'
                          }`}
                        >
                            <ArrowRightOnRectangleIcon className="w-4 h-4 mr-2"/>
                            Leave Group
                        </button>
                    </div>
                    <div className="p-4 border border-yellow-500/30 dark:border-yellow-600/50 bg-yellow-50 dark:bg-yellow-900/30 rounded-lg">
                        <h4 className="font-semibold text-yellow-800 dark:text-yellow-300">Archive Group</h4>
                        <p className="text-xs text-yellow-700 dark:text-yellow-400 mt-1 mb-3">Archiving will hide the group from the main list for all members and disable new messages.</p>
                        <button onClick={() => onToggleArchiveGroup(group.id)} className="w-full flex items-center justify-center p-2 text-sm font-medium text-white bg-yellow-500 hover:bg-yellow-600 rounded-md">
                            <ArchiveBoxIcon className="w-4 h-4 mr-2"/>
                            {group.isArchived ? 'Unarchive Group' : 'Archive Group'}
                        </button>
                    </div>
                    {isCurrentUserAdmin ? (
                         <div className="p-4 border border-red-500/30 dark:border-red-600/50 bg-red-50 dark:bg-red-900/30 rounded-lg">
                            <h4 className="font-semibold text-red-700 dark:text-red-300">Delete Group</h4>
                            <p className="text-xs text-red-600 dark:text-red-400 mt-1 mb-3">This action is permanent and will delete the group, all its sub-groups, and all messages for everyone.</p>
                            <button onClick={() => onDeleteGroup(group.id)} className="w-full flex items-center justify-center p-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-md">
                                <TrashIcon className="w-4 h-4 mr-2"/>
                                Delete Group Permanently
                            </button>
                         </div>
                    ) : null}
                </div>
            );
      }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      ariaLabelledBy="group-info-modal-title"
      maxWidthClass="max-w-lg"
      panelClassName="!p-0 max-h-[90vh] flex flex-col overflow-hidden"
    >
      <div className="flex justify-between items-center px-6 py-4 border-b border-lantern-border flex-shrink-0">
        <h2 id="group-info-modal-title" className="text-xl font-semibold text-lantern-text">Group Information</h2>
        <button
          type="button"
          onClick={onClose}
          className="min-h-[44px] min-w-[44px] flex items-center justify-center text-lantern-text-muted hover:text-lantern-text rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-lantern-primary"
          aria-label="Close group information"
        >
          <XCircleIcon className="w-6 h-6" aria-hidden />
        </button>
      </div>

      <Tabs
        value={activeTab}
        onValueChange={(value) => setActiveTab(value as 'details' | 'members' | 'danger')}
        aria-label="Group info tabs"
        className="flex flex-col flex-1 min-h-0"
      >
      <div className="border-b border-lantern-border px-6 flex-shrink-0">
            <TabList className="!border-0 -mb-px gap-4">
                <Tab value="details" index={0} className="!rounded-none whitespace-nowrap !px-1">Details</Tab>
                <Tab value="members" index={1} className="!rounded-none whitespace-nowrap !px-1">Members</Tab>
                <Tab value="danger" index={2} className={`!rounded-none whitespace-nowrap !px-1 ${activeTab === 'danger' ? '!text-lantern-error' : ''}`}>Danger Zone</Tab>
            </TabList>
        </div>

        <TabPanel value="details" className="flex-grow overflow-y-auto px-6 py-4 bg-lantern-surface">
            {renderContent('details')}
        </TabPanel>
        <TabPanel value="members" className="flex-grow overflow-y-auto px-6 py-4 bg-lantern-surface">
            {renderContent('members')}
        </TabPanel>
        <TabPanel value="danger" className="flex-grow overflow-y-auto px-6 py-4 bg-lantern-surface">
            {renderContent('danger')}
        </TabPanel>
      </Tabs>
      {reportOpen ? (
        <ReportContentModal
          isOpen={reportOpen}
          onClose={() => setReportOpen(false)}
          targetType="group"
          targetId={group.id}
          targetLabel={group.name}
        />
      ) : null}
    </Modal>
  );
};
export default GroupInfoModal;