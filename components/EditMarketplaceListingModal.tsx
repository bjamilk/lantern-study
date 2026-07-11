import React, { useState, useEffect } from 'react';
import { useToastStore } from '../stores/toastStore';
import { updateMarketplaceListing, uploadMarketplaceImage, deleteMarketplaceImage, fetchCustomCategories, fetchMarketplaceCampuses } from '../services/supabase';
import { formatCampusLabel, type MarketplaceCampus } from '@lantern/shared';
import { compressImage } from '../utils/imageCompression';
import { MarketplaceListing } from '../types';
import {
  XMarkIcon,
  PhotoIcon,
  MapPinIcon,
  CurrencyDollarIcon,
  DocumentTextIcon,
  TagIcon,
  PlusIcon,
  TrashIcon
} from '@heroicons/react/24/outline';
import Modal from './ui/Modal';

interface EditMarketplaceListingModalProps {
  isOpen: boolean;
  onClose: () => void;
  listing: MarketplaceListing;
  onSuccess: () => void;
}

interface ImageFile {
  file?: File;
  preview: string;
  uploaded: boolean;
  url?: string;
  path?: string;
  isExisting?: boolean;
}

const EditMarketplaceListingModal: React.FC<EditMarketplaceListingModalProps> = ({
  isOpen,
  onClose,
  listing,
  onSuccess
}) => {
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    price: '',
    salePrice: '',
    saleEndsAt: '',
    promoLabel: '',
    quantity: '',
    campusId: '',
    location: '',
    category: '',
    images: [] as ImageFile[]
  });
  const [loading, setLoading] = useState(false);
  const [uploadingImages, setUploadingImages] = useState(false);
  const [customCategory, setCustomCategory] = useState('');
  const [existingCustomCategories, setExistingCustomCategories] = useState<{id: string; name: string; usage_count: number}[]>([]);
  const [campuses, setCampuses] = useState<MarketplaceCampus[]>([]);

  useEffect(() => {
    if (isOpen) {
      fetchCustomCategories().then(setExistingCustomCategories).catch(() => {});
      fetchMarketplaceCampuses('NG').then(setCampuses).catch(() => {});
    }
  }, [isOpen]);

  const allCategories = [
    { id: 'textbook_exchange', name: 'Textbooks' },
    { id: 'pq_bank', name: 'Past Questions' },
    { id: 'lecture_notes', name: 'Lecture Notes' },
    { id: 'project_thesis', name: 'Projects & Thesis' },
    { id: 'data_collection', name: 'Data Collection' },
    { id: 'equipment_rental', name: 'Lab Equipment' },
    { id: 'accommodation', name: 'Accommodation' },
    { id: 'travel_transport', name: 'Transportation' },
    { id: 'personal_goods', name: 'Personal Goods' },
    { id: 'aso_ebi', name: 'Fashion' },
    { id: 'campus_services', name: 'Campus Services' },
    { id: 'events_social', name: 'Events & Social' }
  ];

  useEffect(() => {
    if (listing) {
      const isCustom = listing.category?.startsWith('custom:');
      setFormData({
        title: listing.title || '',
        description: listing.description || '',
        price: listing.price?.toString() || '',
        salePrice: listing.sale_price?.toString() || '',
        saleEndsAt: listing.sale_ends_at ? listing.sale_ends_at.slice(0, 16) : '',
        promoLabel: listing.promo_label || '',
        quantity: listing.quantity != null ? String(listing.quantity) : '',
        campusId: listing.campus_id || listing.campus?.id || '',
        location: listing.location || '',
        category: isCustom ? 'other' : (listing.category || ''),
        images: (listing.images || []).map(url => ({
          preview: url,
          uploaded: true,
          url: url,
          isExisting: true
        }))
      });
      setCustomCategory(isCustom ? listing.category.replace('custom:', '') : '');
    }
  }, [listing]);

  const MAX_IMAGES = 5;

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []) as File[];
    const remainingSlots = MAX_IMAGES - formData.images.length;
    
    if (remainingSlots <= 0) {
      useToastStore.getState().showToast(`Maximum ${MAX_IMAGES} images allowed.`, 'error');
      e.target.value = '';
      return;
    }

    const filesToProcess = files.slice(0, remainingSlots);
    if (files.length > remainingSlots) {
      useToastStore.getState().showToast(`Only ${remainingSlots} more image(s) can be added (max ${MAX_IMAGES}).`, 'error');
    }

    const validFiles = filesToProcess.filter((file: File) => {
      if (!file.type.startsWith('image/')) {
        useToastStore.getState().showToast(`${file.name} is not a valid image file.`, 'error');
        return false;
      }
      if (file.size > 5 * 1024 * 1024) {
        useToastStore.getState().showToast(`${file.name} exceeds 5MB limit.`, 'info');
        return false;
      }
      return true;
    });

    try {
      const compressedFiles = await Promise.all(
        validFiles.map(async (file) => {
          const compressed = await compressImage(file, {
            maxWidth: 800,
            maxHeight: 800,
            quality: 0.75,
            outputType: 'file'
          });
          return compressed as File;
        })
      );

      const newImages = compressedFiles.map((file: File) => ({
        file,
        preview: URL.createObjectURL(file),
        uploaded: false
      }));

      setFormData(prev => ({
        ...prev,
        images: [...prev.images, ...newImages]
      }));
    } catch (err) {
      console.error('Error compressing files:', err);
      // Fallback
      const newImages = validFiles.map((file: File) => ({
        file,
        preview: URL.createObjectURL(file),
        uploaded: false
      }));

      setFormData(prev => ({
        ...prev,
        images: [...prev.images, ...newImages]
      }));
    }
  };

  const removeImage = async (index: number) => {
    const image = formData.images[index];
    
    // If it's an uploaded image, delete from storage
    if (image.path && !image.isExisting) {
      try {
        await deleteMarketplaceImage(image.path);
      } catch (error) {
        console.error('Error deleting image:', error);
      }
    }

    // Clean up object URL
    if (!image.isExisting && image.preview) {
      URL.revokeObjectURL(image.preview);
    }

    setFormData(prev => ({
      ...prev,
      images: prev.images.filter((_, i) => i !== index)
    }));
  };

  const uploadImages = async (): Promise<string[]> => {
    const uploadedUrls: string[] = [];

    for (const image of formData.images) {
      if (image.isExisting && image.url) {
        uploadedUrls.push(image.url);
      } else if (image.file && !image.uploaded) {
        try {
          const result = await uploadMarketplaceImage(image.file, listing.id);
          uploadedUrls.push(result.url);
          image.uploaded = true;
          image.url = result.url;
          image.path = result.path;
        } catch (error) {
          console.error('Error uploading image:', error);
        }
      } else if (image.url) {
        uploadedUrls.push(image.url);
      }
    }

    return uploadedUrls;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.campusId) {
      useToastStore.getState().showToast('Please select a campus');
      return;
    }
    setLoading(true);

    try {
      // Upload new images first
      setUploadingImages(true);
      const imageUrls = await uploadImages();
      setUploadingImages(false);

      // Update listing
      const resolvedCategory = formData.category === 'other' ? `custom:${customCategory.trim()}` : formData.category;
      const updates = {
        title: formData.title,
        description: formData.description || undefined,
        price: formData.price ? parseFloat(formData.price) : undefined,
        sale_price: formData.salePrice ? parseFloat(formData.salePrice) : null,
        sale_ends_at: formData.saleEndsAt ? new Date(formData.saleEndsAt).toISOString() : null,
        promo_label: formData.promoLabel || null,
        quantity: formData.quantity ? parseInt(formData.quantity, 10) : null,
        campus_id: formData.campusId,
        location: formData.location || undefined,
        category: resolvedCategory,
        images: imageUrls
      };

      await updateMarketplaceListing(listing.id, updates);

      onSuccess();
      onClose();
    } catch (error) {
      console.error('Error updating listing:', error);
      useToastStore.getState().showToast('Failed to update listing. Please try again.', 'error');
    } finally {
      setLoading(false);
      setUploadingImages(false);
    }
  };

  if (!isOpen) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      ariaLabelledBy="edit-listing-title"
      maxWidthClass="max-w-2xl"
      loading={loading || uploadingImages}
      closeOnBackdrop={!loading && !uploadingImages}
      panelClassName="!p-0 max-h-[90vh] overflow-y-auto rounded-xl"
    >
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-slate-200 dark:border-slate-700">
          <h2 id="edit-listing-title" className="text-xl font-bold text-slate-800 dark:text-slate-200">
            Edit Listing
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={loading || uploadingImages}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors disabled:opacity-50"
            aria-label="Close edit listing dialog"
          >
            <XMarkIcon className="w-5 h-5 text-slate-500 dark:text-slate-400" aria-hidden />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {/* Category */}
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
              <TagIcon className="w-4 h-4 inline mr-2" />
              Category
            </label>
            <select
              value={formData.category}
              onChange={(e) => setFormData(prev => ({ ...prev, category: e.target.value }))}
              className="w-full px-4 py-3 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-indigo-500 bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100"
              required
            >
              <option value="">Select a category</option>
              {allCategories.map(cat => (
                <option key={cat.id} value={cat.id}>{cat.name}</option>
              ))}
              <option value="other">Other (Custom)</option>
            </select>
            {formData.category === 'other' && (
              <div className="mt-2 space-y-2">
                <input
                  type="text"
                  value={customCategory}
                  onChange={(e) => setCustomCategory(e.target.value)}
                  placeholder="Enter your custom category name"
                  className="w-full px-4 py-3 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-indigo-500 bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 placeholder-slate-500 dark:placeholder-slate-400"
                  required
                />
                {existingCustomCategories.length > 0 && (
                  <div>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">Or choose an existing custom category:</p>
                    <div className="flex flex-wrap gap-2">
                      {existingCustomCategories
                        .filter(cat => !customCategory || cat.name.toLowerCase().includes(customCategory.toLowerCase()))
                        .slice(0, 10)
                        .map(cat => (
                          <button
                            key={cat.id}
                            type="button"
                            onClick={() => setCustomCategory(cat.name)}
                            className={`px-3 py-1.5 text-xs rounded-full border transition-colors ${
                              customCategory === cat.name
                                ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-300'
                                : 'border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-400 hover:border-indigo-400 hover:text-indigo-600'
                            }`}
                          >
                            {cat.name}
                          </button>
                        ))
                      }
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Title */}
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
              <DocumentTextIcon className="w-4 h-4 inline mr-2" />
              Title *
            </label>
            <input
              type="text"
              value={formData.title}
              onChange={(e) => setFormData(prev => ({ ...prev, title: e.target.value }))}
              placeholder="Enter a descriptive title"
              className="w-full px-4 py-3 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-indigo-500 bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100"
              required
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
              Description
            </label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
              placeholder="Describe your item or service..."
              rows={4}
              className="w-full px-4 py-3 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-indigo-500 bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100"
            />
          </div>

          {/* Price, quantity, and location */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                <CurrencyDollarIcon className="w-4 h-4 inline mr-2" />
                Price (₦)
              </label>
              <input
                type="number"
                value={formData.price}
                onChange={(e) => setFormData(prev => ({ ...prev, price: e.target.value }))}
                placeholder="0.00"
                min="0"
                step="0.01"
                className="w-full px-4 py-3 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-indigo-500 bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                Quantity in stock
              </label>
              <input
                type="number"
                value={formData.quantity}
                onChange={(e) => setFormData(prev => ({ ...prev, quantity: e.target.value }))}
                placeholder="Unlimited"
                min="0"
                className="w-full px-4 py-3 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-indigo-500 bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                <MapPinIcon className="w-4 h-4 inline mr-2" />
                Campus <span className="text-red-500">*</span>
              </label>
              <select
                value={formData.campusId}
                onChange={(e) => setFormData(prev => ({ ...prev, campusId: e.target.value }))}
                className="w-full px-4 py-3 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-indigo-500 bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100"
                required
              >
                <option value="">Select campus</option>
                {campuses.map((campus) => (
                  <option key={campus.id} value={campus.id}>
                    {formatCampusLabel(campus)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
              Meetup detail (optional)
            </label>
            <input
              type="text"
              value={formData.location}
              onChange={(e) => setFormData(prev => ({ ...prev, location: e.target.value }))}
              placeholder="Faculty gate, hall, landmark…"
              className="w-full px-4 py-3 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-indigo-500 bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                Sale price (₦)
              </label>
              <input
                type="number"
                value={formData.salePrice}
                onChange={(e) => setFormData(prev => ({ ...prev, salePrice: e.target.value }))}
                placeholder="Promo price"
                min="0"
                className="w-full px-4 py-3 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                Sale ends
              </label>
              <input
                type="datetime-local"
                value={formData.saleEndsAt}
                onChange={(e) => setFormData(prev => ({ ...prev, saleEndsAt: e.target.value }))}
                className="w-full px-4 py-3 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                Promo label
              </label>
              <input
                type="text"
                value={formData.promoLabel}
                onChange={(e) => setFormData(prev => ({ ...prev, promoLabel: e.target.value }))}
                placeholder="Exam week deal"
                className="w-full px-4 py-3 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700"
              />
            </div>
          </div>

          {/* Images */}
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
              <PhotoIcon className="w-4 h-4 inline mr-2" />
              Images
            </label>
            <div className="grid grid-cols-3 gap-4">
              {formData.images.map((image, index) => (
                <div key={index} className="relative aspect-square rounded-lg overflow-hidden border border-slate-300 dark:border-slate-600">
                  <img
                    src={image.preview}
                    alt={`Image ${index + 1}`}
                    className="w-full h-full object-cover"
                    onError={(e) => { e.currentTarget.style.display = 'none'; }}
                  />
                  <button
                    type="button"
                    onClick={() => removeImage(index)}
                    className="absolute top-2 right-2 p-1 bg-red-500 text-white rounded-full hover:bg-red-600"
                  >
                    <TrashIcon className="w-4 h-4" />
                  </button>
                </div>
              ))}
              {formData.images.length < 5 && (
                <label className="aspect-square rounded-lg border-2 border-dashed border-slate-300 dark:border-slate-600 flex flex-col items-center justify-center cursor-pointer hover:border-indigo-500 transition-colors">
                  <PlusIcon className="w-8 h-8 text-slate-400" />
                  <span className="text-sm text-slate-500 mt-1">Add Image</span>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleFileSelect}
                    className="hidden"
                    multiple
                  />
                </label>
              )}
            </div>
          </div>

          {/* Submit Button */}
          <div className="flex justify-end gap-3 pt-4 border-t border-slate-200 dark:border-slate-700">
            <button
              type="button"
              onClick={onClose}
              className="px-6 py-3 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 rounded-lg font-semibold hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || uploadingImages || !formData.title.trim()}
              className="px-6 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-semibold disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {uploadingImages ? 'Uploading Images...' : loading ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </form>
    </Modal>
  );
};

export default EditMarketplaceListingModal;
