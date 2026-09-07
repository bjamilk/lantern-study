import React, { useEffect, useState } from 'react';
import { updateMyShop, uploadMarketplaceImage } from '../services/supabase';
import { normalizeStorageUrl } from '../utils/storageUrl';
import { AppIcon } from './ui/AppIcon';

interface EditShopModalProps {
  isOpen: boolean;
  onClose: () => void;
  initial: { shopName: string; bio: string | null; coverImageUrl: string | null };
  onSaved: (shop: { shopName: string; bio: string | null; coverImageUrl: string | null }) => void;
}

const EditShopModal: React.FC<EditShopModalProps> = ({ isOpen, onClose, initial, onSaved }) => {
  const [shopName, setShopName] = useState(initial.shopName);
  const [bio, setBio] = useState(initial.bio || '');
  const [coverImageUrl, setCoverImageUrl] = useState(initial.coverImageUrl);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    setShopName(initial.shopName);
    setBio(initial.bio || '');
    setCoverImageUrl(initial.coverImageUrl);
    setError('');
  }, [isOpen, initial.shopName, initial.bio, initial.coverImageUrl]);

  if (!isOpen) return null;

  const handleCover = async (file: File | null) => {
    if (!file) return;
    setUploading(true);
    setError('');
    try {
      const uploaded = await uploadMarketplaceImage(file);
      setCoverImageUrl(uploaded.path || uploaded.url);
    } catch (e: any) {
      setError(e?.message || 'Failed to upload cover');
    } finally {
      setUploading(false);
    }
  };

  const handleSave = async () => {
    const trimmed = shopName.trim();
    if (!trimmed) {
      setError('Shop name is required');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const shop = await updateMyShop({
        shopName: trimmed,
        bio: bio.trim() || null,
        coverImageUrl: coverImageUrl || null,
      });
      onSaved(shop);
      onClose();
    } catch (e: any) {
      setError(e?.message || 'Failed to save shop');
    } finally {
      setSaving(false);
    }
  };

  const coverSrc = coverImageUrl ? normalizeStorageUrl(coverImageUrl) : null;

  return (
    <div className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4">
      <div
        role="dialog"
        aria-modal
        aria-label="Edit shop"
        className="w-full sm:max-w-md bg-lantern-surface rounded-t-2xl sm:rounded-2xl shadow-xl border border-lantern-border overflow-hidden"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-lantern-border">
          <h2 className="text-base font-bold text-lantern-text">Edit shop</h2>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-lantern-background-secondary"
            aria-label="Close"
          >
            <AppIcon name="close" size={20} className="text-lantern-text-secondary" />
          </button>
        </div>

        <div className="p-4 space-y-4 max-h-[70vh] overflow-y-auto">
          <div>
            <label className="block text-xs font-semibold text-lantern-text-secondary mb-1">Cover</label>
            <div className="h-28 rounded-xl overflow-hidden bg-gradient-to-br from-lantern-primary/80 to-lantern-primary-dark mb-2">
              {coverSrc ? (
                <img src={coverSrc} alt="" className="w-full h-full object-cover" />
              ) : null}
            </div>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(e) => void handleCover(e.target.files?.[0] || null)}
              disabled={uploading || saving}
              className="block w-full text-xs text-lantern-text-secondary"
            />
            {coverImageUrl ? (
              <button
                type="button"
                onClick={() => setCoverImageUrl(null)}
                className="mt-1 text-xs text-rose-600 font-medium"
              >
                Remove cover
              </button>
            ) : null}
          </div>

          <div>
            <label className="block text-xs font-semibold text-lantern-text-secondary mb-1">Shop name</label>
            <input
              value={shopName}
              onChange={(e) => setShopName(e.target.value)}
              maxLength={80}
              className="w-full px-3 py-2 rounded-xl border border-lantern-border bg-lantern-background text-sm text-lantern-text"
              placeholder="Your shop name"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-lantern-text-secondary mb-1">Bio</label>
            <textarea
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              maxLength={500}
              rows={3}
              className="w-full px-3 py-2 rounded-xl border border-lantern-border bg-lantern-background text-sm text-lantern-text resize-none"
              placeholder="Short about your shop (optional)"
            />
            <p className="text-label tracking-normal text-lantern-text-tertiary mt-1">{bio.length}/500</p>
          </div>

          {error ? <p className="text-xs text-rose-600 font-medium">{error}</p> : null}
        </div>

        <div className="px-4 py-3 border-t border-lantern-border flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 h-10 rounded-xl border border-lantern-border text-sm font-semibold text-lantern-text-secondary"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving || uploading}
            className="flex-1 h-10 rounded-xl bg-lantern-primary hover:bg-lantern-primary-dark text-white text-sm font-semibold disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default EditShopModal;
