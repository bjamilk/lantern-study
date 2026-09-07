import React, { useEffect, useState } from 'react';
import { confirmDialog } from '../stores/confirmStore';
import { useToastStore } from '../stores/toastStore';
import { User } from '../types';
import { searchUsers } from '../services/supabase';
import * as notesApi from '../services/notes';
import Modal from './ui/Modal';
import { buildNoteSharePath } from '../utils/appRoutes';
import { AppIcon } from './ui/AppIcon';

interface NoteCollaborator {
  noteId: string;
  userId: string;
  role: string;
  addedAt: string;
  user?: { id: string; name?: string; avatarUrl?: string };
}

interface NoteShareLink {
  id: string;
  token?: string;
  role: 'viewer' | 'editor';
  expiresAt?: string | null;
  createdAt?: string;
  isActive?: boolean;
}

interface NoteCollaboratorsModalProps {
  isOpen: boolean;
  onClose: () => void;
  noteId: string;
  currentUserId?: string;
}

const NoteCollaboratorsModal: React.FC<NoteCollaboratorsModalProps> = ({
  isOpen,
  onClose,
  noteId,
  currentUserId,
}) => {
  const [collaborators, setCollaborators] = useState<NoteCollaborator[]>([]);
  const [inviteValue, setInviteValue] = useState('');
  const [selectedUserId, setSelectedUserId] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [userQuery, setUserQuery] = useState('');
  const [userSuggestions, setUserSuggestions] = useState<User[]>([]);
  const [isSearchingUsers, setIsSearchingUsers] = useState(false);
  const [inviteRole, setInviteRole] = useState<'viewer' | 'editor'>('editor');
  const [shareLinks, setShareLinks] = useState<NoteShareLink[]>([]);
  const [linkRole, setLinkRole] = useState<'viewer' | 'editor'>('viewer');

  const loadCollaborators = async () => {
    if (!noteId) return;
    setIsLoading(true);
    try {
      const data = await notesApi.fetchNoteCollaborators(noteId);
      setCollaborators(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Failed to load note collaborators', err);
    } finally {
      setIsLoading(false);
    }
  };

  const loadShareLinks = async () => {
    try {
      const data = await notesApi.fetchNoteShareLinks(noteId);
      setShareLinks(Array.isArray(data) ? data.filter((link: NoteShareLink) => link.isActive !== false) : []);
    } catch (err) {
      console.error('Failed to load note share links', err);
      setShareLinks([]);
    }
  };

  useEffect(() => {
    if (isOpen) {
      void loadCollaborators();
      void loadShareLinks();
      setInviteValue('');
      setSelectedUserId('');
      setUserQuery('');
      setUserSuggestions([]);
    }
  }, [isOpen, noteId]);

  useEffect(() => {
    const handler = setTimeout(() => {
      if (!userQuery.trim()) {
        setUserSuggestions([]);
        return;
      }
      if (userQuery.trim().replace(/^@+/, '').length < 2) {
        setUserSuggestions([]);
        return;
      }
      setIsSearchingUsers(true);
      searchUsers(userQuery.trim(), 10)
        .then((users) => setUserSuggestions(users.map((u) => ({
          id: u.id,
          name: u.name || '',
          username: u.username || undefined,
          avatarUrl: u.avatarUrl,
        }))))
        .catch(() => setUserSuggestions([]))
        .finally(() => setIsSearchingUsers(false));
    }, 250);
    return () => clearTimeout(handler);
  }, [userQuery]);

  const handleAdd = async () => {
    const target = (selectedUserId || inviteValue).trim();
    if (!target) return;
    setIsSaving(true);
    try {
      await notesApi.addNoteCollaborator(noteId, target, inviteRole);
      await loadCollaborators();
      setInviteValue('');
      setSelectedUserId('');
      setUserQuery('');
      setUserSuggestions([]);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to add collaborator.';
      useToastStore.getState().showToast(message, 'info');
    } finally {
      setIsSaving(false);
    }
  };

  const handleRoleChange = async (userId: string, role: 'viewer' | 'editor') => {
    setIsSaving(true);
    try {
      await notesApi.updateNoteCollaboratorRole(noteId, userId, role);
      setCollaborators((items) => items.map((item) => item.userId === userId ? { ...item, role } : item));
    } catch (err: unknown) {
      useToastStore.getState().showToast(err instanceof Error ? err.message : 'Failed to update collaborator role.', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const copyShareUrl = async (urlOrToken: string) => {
    const url = urlOrToken.startsWith('http')
      ? urlOrToken
      : `https://lanternstudy.com${buildNoteSharePath(urlOrToken)}`;
    try {
      await navigator.clipboard.writeText(url);
      useToastStore.getState().showToast('Share link copied.', 'success');
    } catch {
      useToastStore.getState().showToast('Could not copy the share link.', 'error');
    }
  };

  const handleCreateLink = async () => {
    setIsSaving(true);
    try {
      const link = await notesApi.createNoteShareLink(noteId, linkRole) as NoteShareLink;
      await loadShareLinks();
      if (link.url || link.token) await copyShareUrl(link.url || link.token!);
      else useToastStore.getState().showToast('Share link created.', 'success');
    } catch (err: unknown) {
      useToastStore.getState().showToast(err instanceof Error ? err.message : 'Failed to create share link.', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleRevokeLink = async (linkId: string) => {
    if (!(await confirmDialog({ title: 'Revoke share link?', message: 'This stops new people from accepting the link. Existing collaborators keep access until you remove them.', danger: true }))) return;
    try {
      await notesApi.revokeNoteShareLink(noteId, linkId);
      setShareLinks((links) => links.filter((link) => link.id !== linkId));
    } catch (err: unknown) {
      useToastStore.getState().showToast(err instanceof Error ? err.message : 'Failed to revoke share link.', 'error');
    }
  };

  const handleRemove = async (userId: string) => {
    if (!(await confirmDialog({ title: 'Please confirm', message: "Remove this collaborator?", danger: true }))) return;
    try {
      await notesApi.removeNoteCollaborator(noteId, userId);
      setCollaborators(prev => prev.filter(c => c.userId !== userId));
    } catch (err) {
      console.error('Failed to remove collaborator', err);
      useToastStore.getState().showToast('Failed to remove collaborator.', 'error');
    }
  };

  if (!isOpen) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      ariaLabelledBy="note-collaborators-title"
      maxWidthClass="max-w-lg"
      panelClassName="!p-0 overflow-hidden"
    >
        <div className="flex items-center justify-between px-5 py-4 border-b border-lantern-border">
          <h2 id="note-collaborators-title" className="text-lg font-semibold text-lantern-text flex items-center gap-2">
            <AppIcon name="person" size={20} className="text-lantern-primary" aria-hidden />
            Share note
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center text-lantern-text-muted hover:text-lantern-text rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-lantern-primary"
            aria-label="Close note collaborators dialog"
          >
            <AppIcon name="close-circle" size={24} aria-hidden />
          </button>
        </div>

        <div className="p-5">
          <p className="text-sm text-lantern-text-secondary mb-4">
            Invite people directly or create a share link. Group sharing remains available from the editor.
          </p>

          <div className="relative mb-4">
            <input
              value={userQuery || inviteValue}
              onChange={(e) => {
                const value = e.target.value;
                setUserQuery(value);
                setInviteValue(value);
                setSelectedUserId('');
              }}
              placeholder="Search name, @username, or email"
              aria-label="Search users to invite"
              className="w-full min-h-[44px] p-2 border rounded-lg bg-lantern-surface border-lantern-border text-lantern-text focus:ring-2 focus:ring-lantern-primary focus:border-transparent"
            />
            {isSearchingUsers && (
              <div className="absolute right-2 top-2 text-xs text-lantern-text-muted">Searching…</div>
            )}
            {userSuggestions.length > 0 && (
              <div className="absolute left-0 right-0 mt-1 max-h-48 overflow-y-auto bg-lantern-surface border border-lantern-border rounded-lg shadow-lg z-50">
                {userSuggestions.map(user => (
                  <button
                    key={user.id}
                    type="button"
                    onClick={() => {
                      setSelectedUserId(user.id);
                      setInviteValue(user.id);
                      setUserQuery(user.name ? `${user.name}${user.email ? ` (${user.email})` : ''}` : user.email || user.id);
                      setUserSuggestions([]);
                    }}
                    className="w-full text-left px-3 py-2 min-h-[44px] hover:bg-lantern-background-secondary"
                  >
                    <div className="text-sm font-medium text-lantern-text">
                      {user.name || user.email || user.id}
                    </div>
                    <div className="text-xs text-lantern-text-muted">
                      {user.username ? `@${user.username}` : user.email || user.id}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="flex gap-2 justify-end mb-5">
            <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value as 'viewer' | 'editor')} className="min-h-[44px] rounded-lg border border-lantern-border bg-lantern-surface px-2 text-sm text-lantern-text" aria-label="Collaborator permission">
              <option value="viewer">Viewer</option>
              <option value="editor">Editor</option>
            </select>
            <button
              type="button"
              onClick={() => void handleAdd()}
              disabled={!(selectedUserId || inviteValue).trim() || isSaving}
              className="min-h-[44px] px-4 py-2 bg-lantern-primary hover:bg-lantern-primary-dark disabled:opacity-50 text-white rounded-lg text-sm font-semibold"
            >
              {isSaving ? 'Adding…' : 'Invite'}
            </button>
          </div>

          <div className="border-t border-lantern-border pt-4">
            <h3 className="mb-2 text-sm font-semibold text-lantern-text flex items-center gap-2"><AppIcon name="link" size={16} />Share link</h3>
            <div className="flex gap-2">
              <select value={linkRole} onChange={(e) => setLinkRole(e.target.value as 'viewer' | 'editor')} className="min-h-[44px] flex-1 rounded-lg border border-lantern-border bg-lantern-surface px-2 text-sm text-lantern-text" aria-label="Share link permission">
                <option value="viewer">Viewer link</option>
                <option value="editor">Editor link</option>
              </select>
              <button type="button" onClick={() => void handleCreateLink()} disabled={isSaving} className="min-h-[44px] rounded-lg bg-lantern-primary px-3 text-sm font-semibold text-white disabled:opacity-50">
                Create link
              </button>
            </div>
            <div className="mt-3 space-y-2">
              {shareLinks.length === 0 ? <p className="text-xs text-lantern-text-muted">No active share links.</p> : shareLinks.map((link) => (
                <div key={link.id} className="flex items-center gap-2 rounded-lg bg-lantern-background-secondary p-2">
                  <span className="flex-1 text-xs capitalize text-lantern-text">{link.role} link{link.expiresAt ? ` · expires ${new Date(link.expiresAt).toLocaleDateString()}` : ''}</span>
                  {link.token && <button type="button" onClick={() => void copyShareUrl(link.token!)} className="min-h-[36px] min-w-[36px] text-lantern-primary" aria-label="Copy share link"><AppIcon name="clipboard-copy" size={16} className="mx-auto" /></button>}
                  <button type="button" onClick={() => void handleRevokeLink(link.id)} className="min-h-[36px] min-w-[36px] text-lantern-error" aria-label="Revoke share link"><AppIcon name="trash" size={16} className="mx-auto" /></button>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-5 space-y-3 max-h-60 overflow-y-auto">
            {isLoading ? (
              <div className="text-sm text-lantern-text-muted">Loading collaborators…</div>
            ) : collaborators.length === 0 ? (
              <div className="text-sm text-lantern-text-muted">No collaborators yet.</div>
            ) : (
              collaborators.map(collab => (
                <div key={collab.userId} className="flex items-center justify-between p-3 bg-lantern-background-secondary rounded-lg">
                  <div>
                    <div className="text-sm font-semibold text-lantern-text">
                      {collab.user?.name || collab.userId}
                    </div>
                    <div className="text-xs text-lantern-text-muted capitalize">{collab.role}</div>
                  </div>
                  {collab.userId !== currentUserId && (
                    <div className="flex items-center gap-1">
                      <select value={collab.role} onChange={(e) => void handleRoleChange(collab.userId, e.target.value as 'viewer' | 'editor')} disabled={isSaving} className="min-h-[36px] rounded border border-lantern-border bg-lantern-surface px-1 text-xs text-lantern-text" aria-label={`Change ${collab.user?.name || 'collaborator'} role`}>
                        <option value="viewer">Viewer</option>
                        <option value="editor">Editor</option>
                      </select>
                      <button type="button" onClick={() => void handleRemove(collab.userId)} className="min-h-[44px] min-w-[44px] flex items-center justify-center text-lantern-error hover:opacity-80 rounded-lg" title="Remove collaborator" aria-label="Remove collaborator">
                        <AppIcon name="trash" size={20} aria-hidden />
                      </button>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
    </Modal>
  );
};

export default NoteCollaboratorsModal;
