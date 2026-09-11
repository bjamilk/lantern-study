import React, { useEffect, useState } from 'react';
import { isValidStudySetTitle, normalizeStudySetTitle, STUDY_SET_DESCRIPTION_MAX, STUDY_SET_TITLE_MAX } from '@lantern/shared';
import type { StudySet } from '../../types';
import { Button } from '../ui';
import { Input } from '../ui/Input';
import Modal from '../ui/Modal';
import { useStudySetStore } from '../../stores/studySetStore';
import { useToastStore } from '../../stores/toastStore';

interface StudySetSettingsModalProps {
  isOpen: boolean;
  studySet: StudySet | null;
  onClose: () => void;
  onSaved?: () => void;
  onDeleted?: () => void;
}

export const StudySetSettingsModal: React.FC<StudySetSettingsModalProps> = ({
  isOpen,
  studySet,
  onClose,
  onSaved,
  onDeleted,
}) => {
  const updateSet = useStudySetStore((s) => s.updateSet);
  const removeSet = useStudySetStore((s) => s.removeSet);
  const showToast = useToastStore((s) => s.showToast);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState<'private' | 'public'>('private');
  const [folderId, setFolderId] = useState<string>('');
  const folders = useStudySetStore((s) => s.folders);
  const loadFolders = useStudySetStore((s) => s.loadFolders);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!isOpen || !studySet) return;
    setTitle(studySet.title);
    setDescription(studySet.description || '');
    setVisibility(studySet.visibility === 'public' ? 'public' : 'private');
    setFolderId(studySet.folderId || '');
    setConfirmDelete(false);
    setSaving(false);
    void loadFolders().catch(() => undefined);
  }, [isOpen, loadFolders, studySet]);

  if (!studySet) return null;

  const save = async () => {
    const next = normalizeStudySetTitle(title);
    if (!isValidStudySetTitle(next)) {
      showToast(`Name the set in ${STUDY_SET_TITLE_MAX} characters or fewer.`, 'error');
      return;
    }
    setSaving(true);
    try {
      await updateSet(studySet.id, {
        title: next,
        description: description.trim() || null,
        visibility,
        folderId: folderId || null,
      });
      showToast('Study set updated.', 'success');
      onSaved?.();
      onClose();
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not update this set.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const share = async () => {
    const url = `${window.location.origin}/study/sets/${encodeURIComponent(studySet.id)}`;
    try {
      await navigator.clipboard.writeText(url);
      showToast(visibility === 'public' ? 'Link copied.' : 'Link copied. The set is still private.', 'success');
    } catch {
      showToast(url, 'info');
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} ariaLabelledBy="study-set-settings-title" maxWidthClass="max-w-md">
      <h2 id="study-set-settings-title" className="text-heading font-bold text-lantern-text mb-1">
        Set settings
      </h2>
      <p className="text-caption text-lantern-text-secondary mb-4">
        Rename this set, add a description, or delete it.
      </p>
      <div className="space-y-4">
        <Input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          maxLength={STUDY_SET_TITLE_MAX}
          aria-label="Study set name"
        />
        <label className="block">
          <span className="text-caption text-lantern-text-secondary">Description</span>
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value.slice(0, STUDY_SET_DESCRIPTION_MAX))}
            rows={3}
            className="mt-1 w-full rounded-xl border border-lantern-border bg-lantern-surface px-3 py-2 text-body text-lantern-text"
          />
        </label>
        {folders.length > 0 ? (
          <label className="block">
            <span className="text-caption text-lantern-text-secondary">Folder</span>
            <select
              value={folderId}
              onChange={(event) => setFolderId(event.target.value)}
              className="mt-1 min-h-[44px] w-full rounded-xl border border-lantern-border bg-lantern-surface px-3 text-body"
            >
              <option value="">None</option>
              {folders.map((folder) => (
                <option key={folder.id} value={folder.id}>
                  {folder.title}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <div className="flex gap-2">
          {(['private', 'public'] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setVisibility(value)}
              className={`min-h-[44px] rounded-full border px-3 text-caption ${
                visibility === value
                  ? 'border-transparent bg-lantern-primary-fill text-white'
                  : 'border-lantern-border text-lantern-text-secondary'
              }`}
            >
              {value === 'private' ? 'Private' : 'Public'}
            </button>
          ))}
        </div>
        <Button type="button" variant="secondary" onClick={() => void share()}>
          Copy link
        </Button>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" onClick={() => void save()} disabled={saving}>
            Save
          </Button>
        </div>
        <div className="border-t border-lantern-border pt-4">
          {confirmDelete ? (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-caption text-lantern-error">Delete this set? Materials stay, unfiled.</p>
              <div className="flex gap-2">
                <Button type="button" variant="ghost" onClick={() => setConfirmDelete(false)}>
                  Keep
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    void removeSet(studySet.id)
                      .then(() => {
                        showToast('Study set deleted.', 'success');
                        onDeleted?.();
                      })
                      .catch((error) => {
                        showToast(error instanceof Error ? error.message : 'Could not delete this set.', 'error');
                      });
                  }}
                >
                  Delete
                </Button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="text-caption text-lantern-error hover:underline"
            >
              Delete study set
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
};

export default StudySetSettingsModal;
