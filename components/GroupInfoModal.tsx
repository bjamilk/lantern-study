import React, { useState, useEffect, useRef } from 'react';
import { Group, User } from '../types';
import { CameraIcon, PhotoIcon, XCircleIcon, CheckCircleIcon, ArrowUpOnSquareIcon, ShieldCheckIcon, UserPlusIcon, UserMinusIcon, ArchiveBoxIcon, TrashIcon, LinkIcon, EnvelopeIcon, ChatBubbleLeftRightIcon, ArrowUpTrayIcon, ArrowDownTrayIcon } from '@heroicons/react/24/outline';
import { SparklesIcon } from '@heroicons/react/24/solid';
import { compressImage } from '../utils/imageCompression';


interface GroupInfoModalProps {
  isOpen: boolean;
  onClose: () => void;
  group: Group;
  currentUser: User; 
  onUpdateDetails: (groupId: string, name: string, description: string) => void;
  onUpdateGroupAvatar: (groupId: string, avatarUrl: string) => void;
  onPromoteToAdmin: (groupId: string, userId: string) => void;
  onDemoteAdmin: (groupId: string, userId: string) => void;
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
        alert("Image is too large. Please select an image under 2MB.");
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
        onUpdateGroupAvatar(group.id, base64Avatar);
        setSelectedAvatarFile(null); 
        if (avatarPreviewUrl) URL.revokeObjectURL(avatarPreviewUrl);
        setAvatarPreviewUrl(null);
        if (avatarFileRef.current) avatarFileRef.current.value = "";
      } catch (error) {
        console.error("Error saving group avatar:", error);
        alert("Error saving avatar. Please try again.");
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
  
  const inviteLink = group.inviteId
    ? `${window.location.origin}/invite/${group.inviteId}`
    : '';
  const [linkCopied, setLinkCopied] = useState(false);

  const handleCopyLink = () => {
      if (!inviteLink) return;
      navigator.clipboard.writeText(inviteLink).then(() => {
          setLinkCopied(true);
          window.setTimeout(() => setLinkCopied(false), 2000);
      }).catch(err => {
          console.error('Failed to copy text: ', err);
          alert('Failed to copy link.');
      });
  };

  const pendingEmailInvites = (group.memberEmails || []).filter(email => !(group.members || []).some(m => m.email === email) && email !== currentUser.email);
  const pendingPhoneInvites = group.invitedPhoneNumbers || [];
  const hasPendingInvites = pendingEmailInvites.length > 0 || pendingPhoneInvites.length > 0;

  const renderContent = () => {
      switch (activeTab) {
        case 'details':
            return (
                 <form onSubmit={handleDetailsSubmit} className="space-y-4">
                    <div className="mb-6 pb-6 border-b border-gray-200 dark:border-gray-700">
                        <h3 className="text-md font-medium text-gray-700 dark:text-gray-300 mb-3">Group Avatar</h3>
                        <div className="flex items-start space-x-4">
                            <img 
                                src={avatarPreviewUrl || group.avatarUrl || `https://ui-avatars.com/api/?name=${group.name.replace(/\s/g, '+')}&background=random&color=fff&size=100`} 
                                alt={`${group.name} avatar`}
                                className="w-20 h-20 rounded-full object-cover border-2 border-gray-300 dark:border-gray-500 flex-shrink-0"
                                onError={(e) => { e.currentTarget.src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='%239ca3af' viewBox='0 0 24 24'%3E%3Cpath d='M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z'/%3E%3C/svg%3E"; }}
                            />
                            <div className="flex-grow">
                                <button type="button" onClick={() => avatarFileRef.current?.click()} className="w-full sm:w-auto mb-2 px-3 py-1.5 text-sm font-medium text-blue-700 dark:text-blue-300 bg-blue-100 dark:bg-blue-900/40 hover:bg-blue-200 dark:hover:bg-blue-900/60 border border-blue-300 dark:border-blue-700 rounded-md shadow-sm flex items-center justify-center">
                                    <ArrowUpOnSquareIcon className="w-4 h-4 mr-1.5" />
                                    {selectedAvatarFile ? 'Change Image' : 'Upload Image'}
                                </button>
                                <input type="file" ref={avatarFileRef} onChange={handleAvatarFileChange} accept="image/*" className="hidden" />
                                
                                {selectedAvatarFile && (
                                    <div className="mt-2 space-y-2">
                                        <p className="text-xs text-gray-600 dark:text-gray-400 truncate">Preview: <span className="font-medium">{selectedAvatarFile.name}</span></p>
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
                                <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">Max file size: 2MB.</p>
                            </div>
                        </div>
                    </div>
                    <div>
                        <label htmlFor="groupInfoName" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Group Name</label>
                        <input type="text" id="groupInfoName" value={name} onChange={handleNameChange} className="w-full p-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded-md" required />
                    </div>
                    <div>
                        <label htmlFor="groupInfoDescription" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Description</label>
                        <textarea id="groupInfoDescription" value={description} onChange={handleDescriptionChange} rows={3} className="w-full p-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded-md" />
                    </div>
                    {detailsChanged && <button type="submit" className="w-full px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md">Save Changes</button>}
                </form>
            );
        case 'members':
            return (
                <div className="space-y-6">
                     {isCurrentUserAdmin && inviteLink && (
                        <div className="p-4 bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800 rounded-lg space-y-2">
                           <h3 className="text-sm font-semibold text-indigo-900 dark:text-indigo-200 flex items-center gap-2">
                             <LinkIcon className="w-4 h-4" /> Invite link
                           </h3>
                           <div className="flex items-center gap-2">
                             <code className="flex-1 min-w-0 truncate text-xs font-mono text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 px-2 py-2 rounded-md border border-indigo-100 dark:border-slate-600">
                               {inviteLink}
                             </code>
                             <button
                               type="button"
                               onClick={handleCopyLink}
                               className="shrink-0 px-3 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-md"
                             >
                               {linkCopied ? 'Copied' : 'Copy'}
                             </button>
                           </div>
                        </div>
                     )}
                     {isCurrentUserAdmin && (
                        <div className="p-4 bg-gray-50 dark:bg-gray-700/50 border border-gray-200 dark:border-gray-600 rounded-lg">
                           <button onClick={onOpenAddMembersModal} className="w-full flex items-center justify-center px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md text-sm font-medium"><UserPlusIcon className="w-5 h-5 mr-2" />Add or Invite Members</button>
                        </div>
                     )}

                     {isCurrentUserAdmin && group.pendingMembers && group.pendingMembers.length > 0 && (
                        <div>
                             <h3 className="font-semibold text-gray-800 dark:text-gray-100 mb-2">Pending Join Requests ({group.pendingMembers.length})</h3>
                            <div className="space-y-2">
                            {group.pendingMembers.map(member => (
                                <div key={member.id} className="flex items-center justify-between p-2 bg-yellow-50 dark:bg-yellow-900/30 border-l-4 border-yellow-400 rounded">
                                    <div className="flex items-center">
                                        <img src={member.avatarUrl} alt={member.name} className="w-8 h-8 rounded-full mr-3" onError={(e) => { e.currentTarget.src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='%239ca3af' viewBox='0 0 24 24'%3E%3Cpath d='M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z'/%3E%3C/svg%3E"; }}/>
                                        <span className="text-sm font-medium text-gray-700 dark:text-gray-200">{member.name}</span>
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
                        <h3 className="font-semibold text-gray-800 dark:text-gray-100 mb-2">Members ({(group.members || []).length})</h3>
                        <div className="space-y-2">
                            {(group.members || []).map(member => (
                                <div key={member.id} className="flex items-center justify-between p-2 rounded hover:bg-gray-50 dark:hover:bg-gray-700/50">
                                    <div className="flex items-center">
                                        <img src={member.avatarUrl} alt={member.name} className="w-8 h-8 rounded-full mr-3" onError={(e) => { e.currentTarget.src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='%239ca3af' viewBox='0 0 24 24'%3E%3Cpath d='M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z'/%3E%3C/svg%3E"; }}/>
                                        <span className="text-sm font-medium text-gray-700 dark:text-gray-200">{member.name}</span>
                                        {group.adminIds?.includes(member.id) && <ShieldCheckIcon className="w-4 h-4 text-blue-500 dark:text-blue-400 ml-2" title="Admin"/>}
                                        {member.id === currentUser.id && <span className="text-xs text-gray-500 dark:text-gray-400 ml-2">(You)</span>}
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
                                            </>
                                        )}
                                        {member.id !== currentUser.id && (
                                             <button onClick={() => onInitiateDm(member.id)} className="p-1.5 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-full" title="Message"><ChatBubbleLeftRightIcon className="w-5 h-5"/></button>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                     </div>
                     {isCurrentUserAdmin && hasPendingInvites && (
                        <div>
                            <h3 className="font-semibold text-gray-800 dark:text-gray-100 mb-2">Pending Invitations ({pendingEmailInvites.length + pendingPhoneInvites.length})</h3>
                             <div className="space-y-2">
                                {pendingEmailInvites.map(email => (
                                    <div key={email} className="flex items-center justify-between p-2 rounded bg-gray-100 dark:bg-gray-700">
                                        <span className="text-sm text-gray-600 dark:text-gray-300 italic">{email}</span>
                                        <button onClick={() => onRevokeInvitation(group.id, email)} className="text-xs text-red-600 dark:text-red-400 hover:underline">Revoke</button>
                                    </div>
                                ))}
                                {pendingPhoneInvites.map(phone => (
                                    <div key={phone} className="flex items-center justify-between p-2 rounded bg-gray-100 dark:bg-gray-700">
                                        <span className="text-sm text-gray-600 dark:text-gray-300 italic">{phone}</span>
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
                isCurrentUserAdmin ? (
                    <div className="space-y-4">
                         <div className="p-4 border border-yellow-500/30 dark:border-yellow-600/50 bg-yellow-50 dark:bg-yellow-900/30 rounded-lg">
                            <h4 className="font-semibold text-yellow-800 dark:text-yellow-300">Archive Group</h4>
                            <p className="text-xs text-yellow-700 dark:text-yellow-400 mt-1 mb-3">Archiving will hide the group from the main list for all members and disable new messages.</p>
                            <button onClick={() => onToggleArchiveGroup(group.id)} className="w-full flex items-center justify-center p-2 text-sm font-medium text-white bg-yellow-500 hover:bg-yellow-600 rounded-md">
                                <ArchiveBoxIcon className="w-4 h-4 mr-2"/>
                                {group.isArchived ? 'Unarchive Group' : 'Archive Group'}
                            </button>
                         </div>
                         <div className="p-4 border border-red-500/30 dark:border-red-600/50 bg-red-50 dark:bg-red-900/30 rounded-lg">
                            <h4 className="font-semibold text-red-700 dark:text-red-300">Delete Group</h4>
                            <p className="text-xs text-red-600 dark:text-red-400 mt-1 mb-3">This action is permanent and will delete the group, all its sub-groups, and all messages for everyone.</p>
                            <button onClick={() => onDeleteGroup(group.id)} className="w-full flex items-center justify-center p-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-md">
                                <TrashIcon className="w-4 h-4 mr-2"/>
                                Delete Group Permanently
                            </button>
                         </div>
                    </div>
                ) : (
                    <p className="text-sm text-gray-600 dark:text-gray-400">Only group admins can perform these actions.</p>
                )
            );
      }
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center p-4 z-50 transition-opacity duration-300 ease-in-out" role="dialog" aria-modal="true" aria-labelledby="group-info-modal-title">
      <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-xl w-full max-w-lg transform transition-all duration-300 ease-in-out scale-100 max-h-[90vh] flex flex-col">
        <div className="flex justify-between items-center mb-4 flex-shrink-0">
          <h2 id="group-info-modal-title" className="text-xl font-semibold text-gray-800 dark:text-gray-100">Group Information</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200" aria-label="Close modal">
            <XCircleIcon className="w-6 h-6" />
          </button>
        </div>
        
        <div className="border-b border-gray-200 dark:border-gray-700 mb-4 flex-shrink-0">
            <nav className="-mb-px flex space-x-4" aria-label="Tabs">
                <button onClick={() => setActiveTab('details')} className={`whitespace-nowrap py-2 px-1 border-b-2 font-medium text-sm ${activeTab === 'details' ? 'border-blue-500 text-blue-600 dark:text-blue-400' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-200 dark:hover:border-gray-600'}`}>Details</button>
                <button onClick={() => setActiveTab('members')} className={`whitespace-nowrap py-2 px-1 border-b-2 font-medium text-sm ${activeTab === 'members' ? 'border-blue-500 text-blue-600 dark:text-blue-400' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-200 dark:hover:border-gray-600'}`}>Members</button>
                {isCurrentUserAdmin && <button onClick={() => setActiveTab('danger')} className={`whitespace-nowrap py-2 px-1 border-b-2 font-medium text-sm ${activeTab === 'danger' ? 'border-red-500 text-red-600 dark:text-red-400' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-200 dark:hover:border-gray-600'}`}>Danger Zone</button>}
            </nav>
        </div>
        
        <div className="flex-grow overflow-y-auto pr-2 -mr-2">
            {renderContent()}
        </div>
      </div>
    </div>
  );
};
export default GroupInfoModal;