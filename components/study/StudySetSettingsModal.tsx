import React, { useEffect, useRef, useState } from 'react';
import {
  isValidStudySetTitle,
  normalizeStudySetTitle,
  studySetLabel,
  STUDY_SET_DESCRIPTION_MAX,
  STUDY_SET_TITLE_MAX,
} from '@lantern/shared';
import type { StudySet } from '../../types';
import { Button } from '../ui';
import { Input } from '../ui/Input';
import Modal from '../ui/Modal';
import { useStudySetStore } from '../../stores/studySetStore';
import { useToastStore } from '../../stores/toastStore';
import { SetTile } from './SetRoomTile';
import {
  COVER_ACCEPT_ATTR,
  coverErrorMessage,
  validateCoverFile,
  STUDY_SET_COVER_HINT,
  STUDY_SET_COVER_MAX_BYTES,
} from '../ui/coverPickerModel';

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
  /**
   * The cover is read LIVE from the store, not from the `studySet` prop.
   *
   * The prop is a snapshot the opener passed in; the upload writes to the
   * store, so reading the prop here would leave the preview showing the old
   * picture until the modal was closed and reopened.
   */
  const liveCoverPath = useStudySetStore((s) =>
    studySet ? (s.resolveSet(studySet.id)?.coverPath ?? null) : null
  );
  const coverInputRef = useRef<HTMLInputElement>(null);
  const [coverBusy, setCoverBusy] = useState(false);
  const [coverError, setCoverError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || !studySet) return;
    setTitle(studySet.title);
    setDescription(studySet.description || '');
    setVisibility(studySet.visibility === 'public' ? 'public' : 'private');
    setFolderId(studySet.folderId || '');
    setConfirmDelete(false);
    setSaving(false);
    setCoverError(null);
    setCoverBusy(false);
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

  /**
   * The picture is applied the moment it is chosen, not on Save.
   *
   * That is how the reference behaves, and it is also the honest behaviour
   * here: the upload is its own request against its own route, so holding the
   * picture hostage to the text-field Save would mean a student who pressed
   * Cancel still has the cover the server already stored.
   */
  const uploadCover = async (picked: File | undefined) => {
    if (!picked || coverBusy) return;
    const check = validateCoverFile(picked, STUDY_SET_COVER_MAX_BYTES);
    if (!check.ok) {
      setCoverError(check.message);
      return;
    }
    setCoverError(null);
    setCoverBusy(true);
    try {
      const { setStudySetCover } = await import('../../stores/coverActions');
      await setStudySetCover(studySet.id, picked);
      showToast('Set picture updated.', 'success');
    } catch (err) {
      // The server's own sentence, or the migration line behind a 503 — never
      // a house "something went wrong" over a fixable refusal.
      const described = coverErrorMessage(err);
      setCoverError(described.details ? `${described.message} (${described.details})` : described.message);
    } finally {
      setCoverBusy(false);
    }
  };

  const clearCover = async () => {
    if (coverBusy) return;
    setCoverError(null);
    setCoverBusy(true);
    try {
      const { removeStudySetCover } = await import('../../stores/coverActions');
      await removeStudySetCover(studySet.id);
      showToast('Set picture removed.', 'success');
    } catch (err) {
      const described = coverErrorMessage(err);
      setCoverError(described.details ? `${described.message} (${described.details})` : described.message);
    } finally {
      setCoverBusy(false);
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
        {/* StudyFetch's own block, in its own order: a square preview, ONE
            button that opens the system picker, the recommendation line, and
            Remove only once there is something to remove. No "Generate" (this
            app has no image generation), no camera (the reference's web block
            has none), and no price — a cover is not a purchase. */}
        <div>
          <span className="text-caption text-lantern-text-secondary">Study set picture</span>
          <div className="mt-2 flex items-center gap-3">
            <SetTile
              setId={studySet.id}
              title={studySetLabel(studySet)}
              coverPath={liveCoverPath}
              size={44}
            />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  onClick={() => coverInputRef.current?.click()}
                  disabled={coverBusy}
                >
                  {coverBusy ? 'Uploading…' : 'Upload picture'}
                </Button>
                {liveCoverPath ? (
                  <button
                    type="button"
                    onClick={() => void clearCover()}
                    disabled={coverBusy}
                    className="text-caption text-lantern-error hover:underline disabled:opacity-60"
                  >
                    Remove
                  </button>
                ) : null}
              </div>
              <p className="mt-1 text-caption text-lantern-text-tertiary">
                {STUDY_SET_COVER_HINT}
              </p>
            </div>
          </div>
          <input
            ref={coverInputRef}
            type="file"
            accept={COVER_ACCEPT_ATTR}
            className="hidden"
            onChange={(event) => {
              const picked = event.target.files?.[0];
              // Cleared immediately so re-picking the SAME file fires change.
              event.target.value = '';
              void uploadCover(picked);
            }}
          />
          {coverError ? (
            <p role="alert" className="mt-2 text-caption text-lantern-error">
              {coverError}
            </p>
          ) : null}
        </div>

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
