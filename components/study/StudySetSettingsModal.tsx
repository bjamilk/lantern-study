import React, { useEffect, useRef, useState } from 'react';
import {
  SET_TILE_GLYPHS,
  SET_TILE_HUES,
  setTileArt,
  type SetTileGlyph,
  type SetTileHue,
} from '@lantern/shared/study/setPresentation';
import {
  SET_TILE_UNSUPPORTED_MESSAGE,
  changedSetTilePick,
  isSetTileUnsupportedMessage,
  setTileSaveDropped,
} from '@lantern/shared/study/setTileSave';
import {
  isValidStudySetTitle,
  normalizeStudySetTitle,
  studySetLabel,
  STUDY_SET_DESCRIPTION_MAX,
  STUDY_SET_TITLE_MAX,
} from '@lantern/shared';
import type { StudySet } from '../../types';
import { Button } from '../ui';
import { AppIcon } from '../ui/AppIcon';
import { Input } from '../ui/Input';
import Modal from '../ui/Modal';
import { useStudySetStore } from '../../stores/studySetStore';
import { useToastStore } from '../../stores/toastStore';
import { GLYPH_ICON, SetTile } from './SetRoomTile';
import { shareStudySet } from './shareStudySet';
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
  /**
   * The tile pick, `null` for "derive it". Held locally and written by Save,
   * like the name and the visibility — and unlike the picture, which is its
   * own upload against its own route and lands the moment it is chosen.
   */
  const [tileHue, setTileHue] = useState<SetTileHue | null>(null);
  const [tileGlyph, setTileGlyph] = useState<SetTileGlyph | null>(null);
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
  /**
   * Why the tile did not save, shown IN the tile block rather than as a green
   * toast over a modal that just closed. A pre-migration api answers 200 and
   * strips the tile keys, so success here has to be checked, not assumed.
   */
  const [tileError, setTileError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || !studySet) return;
    setTitle(studySet.title);
    setDescription(studySet.description || '');
    setVisibility(studySet.visibility === 'public' ? 'public' : 'private');
    setFolderId(studySet.folderId || '');
    setTileHue((studySet.tileHue as SetTileHue) || null);
    setTileGlyph((studySet.tileGlyph as SetTileGlyph) || null);
    setConfirmDelete(false);
    setSaving(false);
    setCoverError(null);
    setTileError(null);
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
    // Only the halves that MOVED: Save sends the whole form, so a rename on a
    // pre-migration api must not report a tile the student never touched.
    const askedTile = changedSetTilePick(studySet, { hue: tileHue, glyph: tileGlyph });
    setTileError(null);
    try {
      const updated = await updateSet(studySet.id, {
        title: next,
        description: description.trim() || null,
        visibility,
        folderId: folderId || null,
        tileHue,
        tileGlyph,
      });
      // An api older than the 503 strips what it does not know and answers a
      // cheerful 200. Compare what came back with what was sent, and keep the
      // modal open with the pick still chosen when the tile did not land.
      if (setTileSaveDropped(askedTile, updated)) {
        setTileError(SET_TILE_UNSUPPORTED_MESSAGE);
        return;
      }
      showToast('Study set updated.', 'success');
      onSaved?.();
      onClose();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not update this set.';
      // The api's own 503 for the unapplied migration. Same sentence, same
      // place as the comparison above.
      if (isSetTileUnsupportedMessage(message)) {
        setTileError(SET_TILE_UNSUPPORTED_MESSAGE);
        return;
      }
      showToast(message, 'error');
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

  /**
   * Was a local copy-to-clipboard that toasted "Link copied." for a public
   * set. That was false: `visibility = 'public'` is written to the row and
   * never read — the SELECT policy is owner-only — so no recipient can open
   * the link either way. It now goes through the one shared helper, which
   * says so, and which the header pill and the card kebab also use.
   */
  /**
   * What the tile WOULD draw with the current pick — the derivation filling in
   * whichever half is still null. This is what the swatches mark as selected,
   * so an untouched set opens with its real colour ringed instead of nothing.
   */
  const preview = setTileArt(studySet.id, studySetLabel(studySet), {
    hue: tileHue,
    glyph: tileGlyph,
  });

  const share = () =>
    shareStudySet({ setId: studySet.id, title: studySet.title, visibility });

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
              tileHue={tileHue}
              tileGlyph={tileGlyph}
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

        {/* The tile, which the reference lets a student CHOOSE rather than
            only derive: one row of the six pastels, one of the six glyphs.
            Both halves are independent and either can be left derived, so the
            selected state is drawn against what the tile would ACTUALLY show
            (`preview`) rather than against the raw pick — otherwise a set with
            no pick would open with no swatch marked while plainly being mint.

            Below a cover this block still edits something real: removing the
            picture reveals the tile again, so it is never dead. The hint says
            so rather than leaving the student to discover it. */}
        <div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-caption text-lantern-text-secondary">Tile</span>
            {tileHue || tileGlyph ? (
              <button
                type="button"
                onClick={() => {
                  setTileHue(null);
                  setTileGlyph(null);
                  setTileError(null);
                }}
                className="text-caption text-lantern-text-secondary hover:underline"
              >
                Reset
              </button>
            ) : null}
          </div>
          <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Tile colour">
            {SET_TILE_HUES.map((hue) => (
              <button
                key={hue}
                type="button"
                onClick={() => {
                  setTileHue(hue);
                  setTileError(null);
                }}
                aria-pressed={preview.hue === hue}
                aria-label={`${hue} tile`}
                className={`rounded-xl p-0.5 ${
                  preview.hue === hue
                    ? 'ring-2 ring-lantern-primary-fill'
                    : 'ring-1 ring-transparent'
                }`}
              >
                <SetTile setId={studySet.id} title="" tileHue={hue} tileGlyph={preview.glyph} size={32} />
              </button>
            ))}
          </div>
          <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Tile symbol">
            {SET_TILE_GLYPHS.map((glyph) => (
              <button
                key={glyph}
                type="button"
                onClick={() => {
                  setTileGlyph(glyph);
                  setTileError(null);
                }}
                aria-pressed={preview.glyph === glyph}
                aria-label={`${glyph} symbol`}
                className={`flex h-11 w-11 items-center justify-center rounded-xl border text-lantern-text ${
                  preview.glyph === glyph
                    ? 'border-transparent bg-lantern-primary-fill text-white'
                    : 'border-lantern-border text-lantern-text-secondary'
                }`}
              >
                <AppIcon name={GLYPH_ICON[glyph]} size={18} />
              </button>
            ))}
          </div>
          <p className="mt-1 text-caption text-lantern-text-tertiary">
            {liveCoverPath
              ? 'Shown wherever this set appears, once the picture is removed.'
              : 'Shown wherever this set appears.'}
          </p>
          {/* The failure belongs to the block that failed, not to a toast that
              slides in over a modal which has already closed. `role="alert"`
              matches the cover block's line right above. */}
          {tileError ? (
            <p role="alert" className="mt-2 text-caption text-lantern-error">
              {tileError}
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
        {/* Named for what it does. "Copy link" described the mechanism; the
            student is looking for the word Share, which is also what the room
            header and the hub card now say. */}
        <Button type="button" variant="secondary" onClick={() => void share()}>
          <AppIcon name="share" size={16} />
          Share
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
