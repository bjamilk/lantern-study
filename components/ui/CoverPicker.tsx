import React, { useEffect, useRef, useState } from 'react';
import { AppIcon } from './AppIcon';
import { Button } from './Button';
import Modal from './Modal';
import { MenuItem, MenuSubmenu } from './Menu';
import { ResolvedStorageImg } from './ResolvedStorageImg';
import {
  COVER_ACCEPT_ATTR,
  coverErrorMessage,
  coverMenuItems,
  coverMenuLabel,
  validateCoverFile,
  type CoverError,
} from './coverPickerModel';
import type { CoverTargetKind } from '../../stores/coverActions';

/**
 * Cover images, StudyFetch-style: the picture fills the tile the pastel block
 * used to fill, and the type glyph shrinks to a badge in its corner. The badge
 * is what stops a wall of photographs becoming untyped — with a cover set, the
 * pastel square was the only thing saying "deck" rather than "note".
 *
 * There is no "Generate" entry anywhere in here. The app has no image
 * generation; offering it would be a button that cannot work.
 */

// ----------------------------------------------------------------- menu

export interface CoverMenuItemsProps {
  hasCover: boolean;
  onChoose: () => void;
  onRemove: () => void;
  /**
   * `menu` emits the shared <MenuItem> (inside a <Menu>); `button` emits plain
   * buttons for the screens whose row menus are hand-rolled markup rather than
   * the Menu primitive. Same labels, same order, either way.
   */
  as?: 'menu' | 'button';
}

/** The picker's entries, for embedding in a deck/note kebab that already exists. */
export function CoverMenuItems({ hasCover, onChoose, onRemove, as = 'menu' }: CoverMenuItemsProps) {
  const items = coverMenuItems(hasCover);
  const iconFor = (id: string) => (
    <AppIcon name={id === 'choose' ? 'image' : 'trash'} size={16} aria-hidden />
  );
  const selectFor = (id: string) => (id === 'choose' ? onChoose : onRemove);

  // Hand-rolled row menus cannot nest, so there the entry IS the label:
  // "Add cover" / "Change cover", with Remove beside it.
  if (as === 'button') {
    return (
      <>
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            role="menuitem"
            onClick={selectFor(item.id)}
            className={`flex w-full items-center gap-2 px-3 py-2 text-left text-body hover:bg-lantern-background-secondary ${
              item.destructive ? 'text-lantern-error' : 'text-lantern-text'
            }`}
          >
            {iconFor(item.id)}
            {item.id === 'choose' ? coverMenuLabel(hasCover) : item.label}
          </button>
        ))}
      </>
    );
  }

  return (
    <MenuSubmenu
      label={coverMenuLabel(hasCover)}
      icon={<AppIcon name="image" size={16} aria-hidden />}
    >
      {items.map((item) => (
        <MenuItem
          key={item.id}
          destructive={item.destructive}
          onSelect={selectFor(item.id)}
          icon={iconFor(item.id)}
          className="pl-8"
        >
          {item.label}
        </MenuItem>
      ))}
    </MenuSubmenu>
  );
}

// --------------------------------------------------------------- dialog

export interface CoverPickerDialogProps {
  open: boolean;
  kind: CoverTargetKind;
  id: string;
  /** Shown in the heading: "Add cover" first time, "Change cover" after. */
  hasCover: boolean;
  onClose: () => void;
  onSaved?: () => void;
}

/**
 * Choose-image → preview → Save. Validation runs on pick, so an oversized
 * screenshot is refused before the upload rather than after it.
 */
export function CoverPickerDialog({
  open,
  kind,
  id,
  hasCover,
  onClose,
  onSaved,
}: CoverPickerDialogProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<CoverError | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) return;
    setFile(null);
    setPreview(null);
    setError(null);
    setShowDetails(false);
    setSaving(false);
  }, [open]);

  // The preview is an object URL, so it has to be released or every re-pick
  // leaks a copy of the image for the life of the tab.
  useEffect(() => {
    if (!preview || !preview.startsWith('blob:')) return;
    return () => URL.revokeObjectURL(preview);
  }, [preview]);

  const pick = (picked: File | undefined) => {
    if (!picked) return;
    const check = validateCoverFile(picked);
    if (!check.ok) {
      setFile(null);
      setPreview(null);
      setError({ message: check.message });
      return;
    }
    setError(null);
    setFile(picked);
    setPreview(URL.createObjectURL(picked));
  };

  const save = async () => {
    if (!file || saving) return;
    setSaving(true);
    setError(null);
    try {
      const { applyCover } = await import('../../stores/coverActions');
      await applyCover(kind, id, file);
      onSaved?.();
      onClose();
    } catch (err) {
      setError(coverErrorMessage(err));
      setShowDetails(false);
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <Modal isOpen={open} onClose={onClose} ariaLabelledBy="cover-picker-title" maxWidthClass="max-w-lg">
      <div className="p-5 space-y-4">
        <h2 id="cover-picker-title" className="text-heading font-semibold text-lantern-text">
          {hasCover ? 'Change cover' : 'Add cover'}
        </h2>

        <div className="aspect-[16/5] w-full overflow-hidden rounded-2xl border border-lantern-border bg-lantern-background-secondary">
          {preview ? (
            <img src={preview} alt="Cover preview" className="h-full w-full object-cover" />
          ) : (
            <span className="flex h-full w-full items-center justify-center text-caption text-lantern-text-secondary">
              No image chosen
            </span>
          )}
        </div>

        <input
          ref={inputRef}
          type="file"
          accept={COVER_ACCEPT_ATTR}
          className="hidden"
          onChange={(e) => {
            pick(e.target.files?.[0]);
            e.target.value = '';
          }}
        />

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => inputRef.current?.click()}>
            <AppIcon name="image" size={16} className="mr-1" />
            Choose image
          </Button>
          <span className="text-caption text-lantern-text-secondary">
            JPEG, PNG, WebP or GIF, up to 10 MB.
          </span>
        </div>

        {error ? (
          <div role="alert" className="space-y-1 text-caption text-lantern-error">
            <p>{error.message}</p>
            {error.details ? (
              showDetails ? (
                <p className="text-lantern-text-secondary break-words">{error.details}</p>
              ) : (
                <button
                  type="button"
                  onClick={() => setShowDetails(true)}
                  className="underline text-lantern-text-secondary"
                >
                  Details
                </button>
              )
            ) : null}
          </div>
        ) : null}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button size="sm" onClick={() => void save()} disabled={!file || saving}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// --------------------------------------------------------------- renders

export interface CoverThumbProps {
  coverPath?: string | null;
  alt?: string;
  /** The pastel tile this replaces — also what shows if the URL cannot be signed. */
  fallback: React.ReactNode;
  /** Tile height; the box is 4:3 around it. */
  heightClass?: string;
  radiusClass?: string;
  /** The type glyph, drawn as a small badge over the picture. */
  badge?: React.ReactNode;
}

/**
 * A 4:3 cover in place of a row's pastel tile.
 *
 * With no cover — or a cover that cannot be signed — the caller's own tile is
 * what renders, so a broken signature degrades to today's UI rather than to a
 * grey hole.
 */
export function CoverThumb({
  coverPath,
  alt = '',
  fallback,
  heightClass = 'h-10',
  radiusClass = 'rounded-[14px]',
  badge,
}: CoverThumbProps) {
  if (!coverPath) return <>{fallback}</>;
  return (
    <span
      className={`relative shrink-0 block aspect-[4/3] ${heightClass} overflow-hidden ${radiusClass} bg-lantern-background-secondary`}
    >
      {/* The tile's own art is the fallback, so an unsignable or dead cover
          degrades to today's UI instead of an empty grey box. */}
      <ResolvedStorageImg
        src={coverPath}
        variant="thumb"
        alt={alt}
        className="h-full w-full object-cover"
        fallback={<span className="absolute inset-0 block">{fallback}</span>}
      />
      {badge ? (
        <span className="absolute bottom-0.5 right-0.5 inline-flex items-center justify-center rounded-md bg-lantern-surface/90 p-0.5 text-lantern-text">
          {badge}
        </span>
      ) : null}
    </span>
  );
}

export interface CoverBannerProps {
  coverPath?: string | null;
  alt?: string;
  className?: string;
  /** Drawn inside the banner box when the cover cannot be signed. */
  fallback?: React.ReactNode;
}

/** The wide 16:5 banner used by the deck header and the note editor header. */
export function CoverBanner({ coverPath, alt = '', className = '', fallback }: CoverBannerProps) {
  if (!coverPath) return null;
  return (
    <div
      className={`aspect-[16/5] w-full overflow-hidden rounded-2xl bg-lantern-background-secondary ${className}`}
    >
      <ResolvedStorageImg
        src={coverPath}
        variant="original"
        alt={alt}
        className="h-full w-full object-cover"
        fallback={fallback ?? null}
      />
    </div>
  );
}

export default CoverPickerDialog;
