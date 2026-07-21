import React, { useState, useEffect } from 'react';
import { createMarketplaceListing, updateMarketplaceListing, uploadMarketplaceImage, deleteMarketplaceImage, fetchCustomCategories, fetchMarketplaceCampuses } from '../services/supabase';
import { CampusSearchSelect } from './marketplace/CampusSearchSelect';
import { MARKETPLACE_CREATE_CONFIRMATION, type MarketplaceCampus } from '@lantern/shared';
import { useToastStore } from '../stores/toastStore';
import { compressImage } from '../utils/imageCompression';
import { aiGenerateListingDescription } from '../services/ai';
import {
  XMarkIcon,
  PhotoIcon,
  MapPinIcon,
  CurrencyDollarIcon,
  DocumentTextIcon,
  TagIcon,
  AcademicCapIcon,
  BriefcaseIcon,
  PlusIcon,
  TrashIcon,
  SparklesIcon,
} from '@heroicons/react/24/outline';
import Modal from './ui/Modal';

interface CreateMarketplaceListingModalProps {
  isOpen: boolean;
  onClose: () => void;
  category: 'academic' | 'student-life';
  onSuccess: () => void;
}

interface ImageFile {
  file: File;
  preview: string;
  uploaded?: boolean;
  url?: string;
  path?: string;
}

const CreateMarketplaceListingModal: React.FC<CreateMarketplaceListingModalProps> = ({
  isOpen,
  onClose,
  category,
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
    location: '',
    campusId: '',
    complianceConfirmed: false,
    subcategory: '',
    images: [] as ImageFile[],
    // Category-specific fields
    condition: '' as '' | 'new' | 'like-new' | 'good' | 'fair',
    courseCode: '',
    year: '',
    semester: '' as '' | '1st' | '2nd',
    edition: '',
    isbn: '',
    bedrooms: '',
    furnished: '' as '' | 'yes' | 'no',
    distanceToCampus: '',
  });
  const [loading, setLoading] = useState(false);
  const [uploadingImages, setUploadingImages] = useState(false);
  const [isGeneratingDesc, setIsGeneratingDesc] = useState(false);
  const [customCategory, setCustomCategory] = useState('');
  const [existingCustomCategories, setExistingCustomCategories] = useState<{id: string; name: string; usage_count: number}[]>([]);
  const [campuses, setCampuses] = useState<MarketplaceCampus[]>([]);

  useEffect(() => {
    if (isOpen) {
      fetchCustomCategories().then(setExistingCustomCategories).catch(() => {});
      fetchMarketplaceCampuses('NG').then(setCampuses).catch(() => {});
    }
  }, [isOpen]);

  const handleGenerateDescription = async () => {
    if (!formData.title.trim()) { useToastStore.getState().showToast('Please enter a title first.'); return; }
    setIsGeneratingDesc(true);
    try {
      const { description } = await aiGenerateListingDescription({
        title: formData.title,
        category,
        subcategory: formData.subcategory,
        price: formData.price,
        condition: formData.condition,
        courseCode: formData.courseCode,
        isbn: formData.isbn,
        edition: formData.edition,
        bedrooms: formData.bedrooms,
        furnished: formData.furnished,
        distanceToCampus: formData.distanceToCampus,
      });
      setFormData(prev => ({ ...prev, description }));
    } catch {
      useToastStore.getState().showToast('Failed to generate description. Please try again.');
    } finally {
      setIsGeneratingDesc(false);
    }
  };

  // Helper to determine which category-specific fields to show
  const getCategoryFields = (subcategory: string) => {
    switch (subcategory) {
      case 'textbook_exchange':
        return ['condition', 'isbn', 'edition'];
      case 'pq_bank':
      case 'lecture_notes':
        return ['courseCode', 'year', 'semester'];
      case 'project_thesis':
        return ['courseCode', 'year'];
      case 'equipment_rental':
        return ['condition'];
      case 'accommodation':
        return ['bedrooms', 'furnished', 'distanceToCampus'];
      case 'personal_goods':
      case 'aso_ebi':
        return ['condition'];
      default:
        return [];
    }
  };

  // Map to database category values
  const academicSubcategories = [
    { id: 'textbook_exchange', name: 'Textbooks', icon: DocumentTextIcon },
    { id: 'pq_bank', name: 'Past Questions', icon: AcademicCapIcon },
    { id: 'lecture_notes', name: 'Lecture Notes', icon: DocumentTextIcon },
    { id: 'project_thesis', name: 'Projects & Thesis', icon: TagIcon },
    { id: 'data_collection', name: 'Data Collection', icon: TagIcon },
    { id: 'equipment_rental', name: 'Lab Equipment', icon: TagIcon }
  ];

  const studentLifeSubcategories = [
    { id: 'accommodation', name: 'Accommodation', icon: TagIcon },
    { id: 'travel_transport', name: 'Transportation', icon: TagIcon },
    { id: 'personal_goods', name: 'Personal Goods', icon: TagIcon },
    { id: 'aso_ebi', name: 'Fashion', icon: TagIcon },
    { id: 'campus_services', name: 'Campus Services', icon: BriefcaseIcon },
    { id: 'events_social', name: 'Events & Social', icon: TagIcon }
  ];

  const subcategories = category === 'academic' ? academicSubcategories : studentLifeSubcategories;

  const MAX_IMAGES = 5;

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []) as File[];
    const remainingSlots = MAX_IMAGES - formData.images.length;
    
    if (remainingSlots <= 0) {
      useToastStore.getState().showToast(`Maximum ${MAX_IMAGES} images allowed.`);
      e.target.value = '';
      return;
    }

    const filesToProcess = files.slice(0, remainingSlots);
    if (files.length > remainingSlots) {
      useToastStore.getState().showToast(`Only ${remainingSlots} more image(s) can be added (max ${MAX_IMAGES}).`);
    }

    const validFiles = filesToProcess.filter((file: File) => {
      // Check file type
      if (!file.type.startsWith('image/')) {
        useToastStore.getState().showToast(`${file.name} is not a valid image file.`);
        return false;
      }
      // Check file size (max 5MB)
      if (file.size > 5 * 1024 * 1024) {
        useToastStore.getState().showToast(`${file.name} is too large. Maximum file size is 5MB.`);
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

      const newImages: ImageFile[] = compressedFiles.map((file: File) => ({
        file,
        preview: URL.createObjectURL(file)
      }));

      setFormData(prev => ({
        ...prev,
        images: [...prev.images, ...newImages]
      }));
    } catch (err) {
      console.error('Error compressing files:', err);
      // Fallback
      const newImages: ImageFile[] = validFiles.map((file: File) => ({
        file,
        preview: URL.createObjectURL(file)
      }));

      setFormData(prev => ({
        ...prev,
        images: [...prev.images, ...newImages]
      }));
    }

    // Reset input
    e.target.value = '';
  };

  const removeImage = async (index: number) => {
    const image = formData.images[index];

    // If image was uploaded, delete from storage
    if (image.uploaded && image.path) {
      try {
        await deleteMarketplaceImage(image.path);
      } catch (error) {
        console.error('Error deleting uploaded image:', error);
      }
    }

    // Clean up object URL
    if (image.preview) {
      URL.revokeObjectURL(image.preview);
    }

    setFormData(prev => ({
      ...prev,
      images: prev.images.filter((_, i) => i !== index)
    }));
  };

  const uploadImages = async (listingId: string): Promise<{ urls: string[]; failedNames: string[] }> => {
    const uploadedUrls: string[] = [];
    const failedNames: string[] = [];

    for (const image of formData.images) {
      if (!image.uploaded) {
        let success = false;
        for (let attempt = 1; attempt <= 2 && !success; attempt++) {
          try {
            const result = await uploadMarketplaceImage(image.file, listingId);
            uploadedUrls.push(result.url);
            image.uploaded = true;
            image.url = result.url;
            image.path = result.path;
            success = true;
          } catch (error) {
            console.error(`Error uploading image (attempt ${attempt}/2):`, error);
            if (attempt < 2) {
              await new Promise((r) => setTimeout(r, 400 * attempt));
            }
          }
        }

        if (!success) {
          failedNames.push(image.file.name || 'image');
        }
      } else if (image.url) {
        uploadedUrls.push(image.url);
      }
    }

    return { urls: uploadedUrls, failedNames };
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (import.meta.env.DEV) {
      console.log('[CreateMarketplaceListingModal] Form submitted');
    }
    
    if (!formData.subcategory) {
      useToastStore.getState().showToast('Please select a category');
      return;
    }

    if (formData.subcategory === 'other' && !customCategory.trim()) {
      useToastStore.getState().showToast('Please enter a custom category name');
      return;
    }
    
    if (!formData.title.trim()) {
      useToastStore.getState().showToast('Please enter a title');
      return;
    }

    if (!formData.campusId) {
      useToastStore.getState().showToast('Please select a campus');
      return;
    }

    if (!formData.complianceConfirmed) {
      useToastStore.getState().showToast('Please confirm on-campus pickup compliance');
      return;
    }
    
    setLoading(true);

    try {
      // Build category-specific fields
      const categorySpecificFields: any = {
        parentCategory: category,
      };
      const fields = getCategoryFields(formData.subcategory);
      if (fields.includes('condition') && formData.condition) categorySpecificFields.condition = formData.condition;
      if (fields.includes('isbn') && formData.isbn) categorySpecificFields.isbn = formData.isbn;
      if (fields.includes('edition') && formData.edition) categorySpecificFields.edition = formData.edition;
      if (fields.includes('courseCode') && formData.courseCode) categorySpecificFields.courseCode = formData.courseCode;
      if (fields.includes('year') && formData.year) categorySpecificFields.year = formData.year;
      if (fields.includes('semester') && formData.semester) categorySpecificFields.semester = formData.semester;
      if (fields.includes('bedrooms') && formData.bedrooms) categorySpecificFields.bedrooms = parseInt(formData.bedrooms);
      if (fields.includes('furnished') && formData.furnished) categorySpecificFields.furnished = formData.furnished === 'yes';
      if (fields.includes('distanceToCampus') && formData.distanceToCampus) categorySpecificFields.distanceToCampus = formData.distanceToCampus;

      // First create the listing - use subcategory as the database category
      const resolvedCategory = formData.subcategory === 'other' ? `custom:${customCategory.trim()}` : formData.subcategory;
      const listingData = {
        category: resolvedCategory,
        title: formData.title,
        description: formData.description || undefined,
        price: formData.price ? parseFloat(formData.price) : undefined,
        sale_price: formData.salePrice ? parseFloat(formData.salePrice) : undefined,
        sale_ends_at: formData.saleEndsAt ? new Date(formData.saleEndsAt).toISOString() : undefined,
        promo_label: formData.promoLabel || undefined,
        quantity: formData.quantity ? parseInt(formData.quantity, 10) : undefined,
        location: formData.location || undefined,
        campus_id: formData.campusId,
        country_code: 'NG',
        currency: 'NGN',
        images: [],
        categorySpecificFields,
      };
      
      if (import.meta.env.DEV) {
        console.log('[CreateMarketplaceListingModal] Creating listing');
      }

      const listing = await createMarketplaceListing(listingData);
      if (import.meta.env.DEV) {
        console.log('[CreateMarketplaceListingModal] Listing created');
      }

      // Then upload images if any
      if (formData.images.length > 0) {
        setUploadingImages(true);
        const { urls: uploadedUrls, failedNames } = await uploadImages(listing.id);

        if (uploadedUrls.length > 0) {
          await updateMarketplaceListing(listing.id, {
            images: uploadedUrls
          });
        }
        setUploadingImages(false);

        if (failedNames.length > 0 && uploadedUrls.length === 0) {
          useToastStore.getState().showToast(
            'Listing created, but all photos failed to upload. Edit the listing to add photos.',
            'error'
          );
        } else if (failedNames.length > 0) {
          useToastStore.getState().showToast(
            `Listing created, but ${failedNames.length} photo(s) failed to upload.`,
            'error'
          );
        }
      }

      onSuccess();
      onClose();

      // Clean up object URLs
      formData.images.forEach(image => {
        if (image.preview) {
          URL.revokeObjectURL(image.preview);
        }
      });

      setFormData({
        title: '',
        description: '',
        price: '',
        salePrice: '',
        saleEndsAt: '',
        promoLabel: '',
        quantity: '',
        location: '',
        campusId: '',
        complianceConfirmed: false,
        subcategory: '',
        images: [],
        condition: '',
        courseCode: '',
        year: '',
        semester: '',
        edition: '',
        isbn: '',
        bedrooms: '',
        furnished: '',
        distanceToCampus: '',
      });
      setCustomCategory('');
    } catch (error) {
      console.error('Error creating listing:', error);
      useToastStore.getState().showToast('Failed to create listing. Please try again.');
    } finally {
      setLoading(false);
      setUploadingImages(false);
    }
  };

  if (!isOpen) return null;

  if (import.meta.env.DEV) {
    console.log('[CreateMarketplaceListingModal] Rendering with category:', category);
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      ariaLabelledBy="create-listing-title"
      maxWidthClass="max-w-2xl"
      loading={loading || uploadingImages}
      closeOnBackdrop={!loading && !uploadingImages}
      panelClassName="!p-0 max-h-[90vh] overflow-y-auto rounded-xl"
    >
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-lantern-border">
          <div className="flex items-center">
            {category === 'academic' ? (
              <AcademicCapIcon className="w-6 h-6 text-lantern-primary mr-3" aria-hidden />
            ) : (
              <BriefcaseIcon className="w-6 h-6 text-lantern-primary mr-3" aria-hidden />
            )}
            <h2 id="create-listing-title" className="text-xl font-bold text-lantern-text">
              Create {category === 'academic' ? 'Academic' : 'Student Life'} Listing
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={loading || uploadingImages}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center p-2 hover:bg-lantern-background-secondary rounded-lg transition-colors duration-200 disabled:opacity-50"
            aria-label="Close create listing dialog"
          >
            <XMarkIcon className="w-5 h-5 text-lantern-text-secondary" aria-hidden />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {/* Title */}
          <div>
            <label htmlFor="listing-title" className="block text-sm font-semibold text-lantern-text mb-2">
              Title *
            </label>
            <input
              id="listing-title"
              type="text"
              value={formData.title}
              onChange={(e) => setFormData(prev => ({ ...prev, title: e.target.value }))}
              required
              placeholder="Enter an engaging title for your listing"
              className="w-full px-4 py-3 border border-lantern-border rounded-lg focus:ring-2 focus:ring-lantern-primary focus:border-lantern-primary bg-lantern-surface dark:bg-lantern-surface-secondary text-lantern-text placeholder:text-lantern-text-tertiary"
            />
          </div>

          {/* Category */}
          <div>
            <p id="listing-category-label" className="block text-sm font-semibold text-lantern-text mb-3">
              Category *
            </p>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3" role="radiogroup" aria-labelledby="listing-category-label">
              {subcategories.map(subcat => {
                const IconComponent = subcat.icon;
                const selected = formData.subcategory === subcat.id;
                return (
                  <button
                    key={subcat.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => setFormData(prev => ({ ...prev, subcategory: subcat.id }))}
                    className={`p-3 border rounded-lg text-left transition-all duration-200 ${
                      selected
                        ? 'border-lantern-primary bg-lantern-primary-background text-lantern-primary'
                        : 'border-lantern-border hover:border-lantern-border dark:hover:border-lantern-border bg-lantern-surface dark:bg-lantern-surface-secondary text-lantern-text'
                    }`}
                  >
                    <IconComponent className="w-5 h-5 mb-2 text-lantern-text-secondary" aria-hidden="true" />
                    <span className="text-sm font-medium">{subcat.name}</span>
                  </button>
                );
              })}
              {/* Other / Custom Category */}
              <button
                type="button"
                role="radio"
                aria-checked={formData.subcategory === 'other'}
                onClick={() => setFormData(prev => ({ ...prev, subcategory: 'other' }))}
                className={`p-3 border rounded-lg text-left transition-all duration-200 ${
                  formData.subcategory === 'other'
                    ? 'border-lantern-primary bg-lantern-primary-background text-lantern-primary'
                    : 'border-lantern-border hover:border-lantern-border dark:hover:border-lantern-border bg-lantern-surface dark:bg-lantern-surface-secondary text-lantern-text'
                }`}
              >
                <PlusIcon className="w-5 h-5 mb-2 text-lantern-text-secondary" aria-hidden="true" />
                <span className="text-sm font-medium">Other</span>
              </button>
            </div>
            {formData.subcategory === 'other' && (
              <div className="mt-3 space-y-2">
                <label htmlFor="listing-custom-category" className="sr-only">Custom category name</label>
                <input
                  id="listing-custom-category"
                  type="text"
                  value={customCategory}
                  onChange={(e) => setCustomCategory(e.target.value)}
                  placeholder="Enter your custom category name"
                  className="w-full px-4 py-3 border border-lantern-border rounded-lg focus:ring-2 focus:ring-lantern-primary focus:border-lantern-primary bg-lantern-surface dark:bg-lantern-surface-secondary text-lantern-text placeholder:text-lantern-text-tertiary"
                />
                {existingCustomCategories.length > 0 && (
                  <div>
                    <p className="text-xs text-lantern-text-secondary mb-1">Or choose an existing custom category:</p>
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
                                ? 'border-lantern-primary bg-lantern-primary-background text-lantern-primary'
                                : 'border-lantern-border text-lantern-text-secondary hover:border-lantern-primary hover:text-lantern-primary'
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

          {/* Category-Specific Fields */}
          {formData.subcategory && getCategoryFields(formData.subcategory).length > 0 && (
            <div className="bg-lantern-background dark:bg-lantern-surface-secondary/30 rounded-lg p-4 space-y-4">
              <h4 className="text-sm font-semibold text-lantern-text">
                Additional Details
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {getCategoryFields(formData.subcategory).includes('condition') && (
                  <div>
                    <label htmlFor="listing-condition" className="block text-xs font-medium text-lantern-text-secondary mb-1">Condition</label>
                    <select
                      id="listing-condition"
                      value={formData.condition}
                      onChange={(e) => setFormData(prev => ({ ...prev, condition: e.target.value as any }))}
                      className="w-full px-3 py-2 border border-lantern-border rounded-lg bg-lantern-surface dark:bg-lantern-surface-secondary text-lantern-text text-sm focus:ring-2 focus:ring-lantern-primary"
                    >
                      <option value="">Select condition</option>
                      <option value="new">New</option>
                      <option value="like-new">Like New</option>
                      <option value="good">Good</option>
                      <option value="fair">Fair</option>
                    </select>
                  </div>
                )}
                {getCategoryFields(formData.subcategory).includes('isbn') && (
                  <div>
                    <label htmlFor="listing-isbn" className="block text-xs font-medium text-lantern-text-secondary mb-1">ISBN</label>
                    <input
                      id="listing-isbn"
                      type="text"
                      value={formData.isbn}
                      onChange={(e) => setFormData(prev => ({ ...prev, isbn: e.target.value }))}
                      placeholder="e.g. 978-0-13-468599-1"
                      className="w-full px-3 py-2 border border-lantern-border rounded-lg bg-lantern-surface dark:bg-lantern-surface-secondary text-lantern-text text-sm focus:ring-2 focus:ring-lantern-primary"
                    />
                  </div>
                )}
                {getCategoryFields(formData.subcategory).includes('edition') && (
                  <div>
                    <label htmlFor="listing-edition" className="block text-xs font-medium text-lantern-text-secondary mb-1">Edition</label>
                    <input
                      id="listing-edition"
                      type="text"
                      value={formData.edition}
                      onChange={(e) => setFormData(prev => ({ ...prev, edition: e.target.value }))}
                      placeholder="e.g. 4th Edition"
                      className="w-full px-3 py-2 border border-lantern-border rounded-lg bg-lantern-surface dark:bg-lantern-surface-secondary text-lantern-text text-sm focus:ring-2 focus:ring-lantern-primary"
                    />
                  </div>
                )}
                {getCategoryFields(formData.subcategory).includes('courseCode') && (
                  <div>
                    <label htmlFor="listing-course-code" className="block text-xs font-medium text-lantern-text-secondary mb-1">Course Code</label>
                    <input
                      id="listing-course-code"
                      type="text"
                      value={formData.courseCode}
                      onChange={(e) => setFormData(prev => ({ ...prev, courseCode: e.target.value }))}
                      placeholder="e.g. CSC 201"
                      className="w-full px-3 py-2 border border-lantern-border rounded-lg bg-lantern-surface dark:bg-lantern-surface-secondary text-lantern-text text-sm focus:ring-2 focus:ring-lantern-primary"
                    />
                  </div>
                )}
                {getCategoryFields(formData.subcategory).includes('year') && (
                  <div>
                    <label htmlFor="listing-year" className="block text-xs font-medium text-lantern-text-secondary mb-1">Year</label>
                    <input
                      id="listing-year"
                      type="text"
                      value={formData.year}
                      onChange={(e) => setFormData(prev => ({ ...prev, year: e.target.value }))}
                      placeholder="e.g. 2025"
                      className="w-full px-3 py-2 border border-lantern-border rounded-lg bg-lantern-surface dark:bg-lantern-surface-secondary text-lantern-text text-sm focus:ring-2 focus:ring-lantern-primary"
                    />
                  </div>
                )}
                {getCategoryFields(formData.subcategory).includes('semester') && (
                  <div>
                    <label htmlFor="listing-semester" className="block text-xs font-medium text-lantern-text-secondary mb-1">Semester</label>
                    <select
                      id="listing-semester"
                      value={formData.semester}
                      onChange={(e) => setFormData(prev => ({ ...prev, semester: e.target.value as any }))}
                      className="w-full px-3 py-2 border border-lantern-border rounded-lg bg-lantern-surface dark:bg-lantern-surface-secondary text-lantern-text text-sm focus:ring-2 focus:ring-lantern-primary"
                    >
                      <option value="">Select semester</option>
                      <option value="1st">1st Semester</option>
                      <option value="2nd">2nd Semester</option>
                    </select>
                  </div>
                )}
                {getCategoryFields(formData.subcategory).includes('bedrooms') && (
                  <div>
                    <label htmlFor="listing-bedrooms" className="block text-xs font-medium text-lantern-text-secondary mb-1">Bedrooms</label>
                    <input
                      id="listing-bedrooms"
                      type="number"
                      value={formData.bedrooms}
                      onChange={(e) => setFormData(prev => ({ ...prev, bedrooms: e.target.value }))}
                      placeholder="e.g. 2"
                      min="0"
                      className="w-full px-3 py-2 border border-lantern-border rounded-lg bg-lantern-surface dark:bg-lantern-surface-secondary text-lantern-text text-sm focus:ring-2 focus:ring-lantern-primary"
                    />
                  </div>
                )}
                {getCategoryFields(formData.subcategory).includes('furnished') && (
                  <div>
                    <label htmlFor="listing-furnished" className="block text-xs font-medium text-lantern-text-secondary mb-1">Furnished</label>
                    <select
                      id="listing-furnished"
                      value={formData.furnished}
                      onChange={(e) => setFormData(prev => ({ ...prev, furnished: e.target.value as any }))}
                      className="w-full px-3 py-2 border border-lantern-border rounded-lg bg-lantern-surface dark:bg-lantern-surface-secondary text-lantern-text text-sm focus:ring-2 focus:ring-lantern-primary"
                    >
                      <option value="">Select</option>
                      <option value="yes">Yes</option>
                      <option value="no">No</option>
                    </select>
                  </div>
                )}
                {getCategoryFields(formData.subcategory).includes('distanceToCampus') && (
                  <div>
                    <label htmlFor="listing-distance" className="block text-xs font-medium text-lantern-text-secondary mb-1">Distance to Campus</label>
                    <input
                      id="listing-distance"
                      type="text"
                      value={formData.distanceToCampus}
                      onChange={(e) => setFormData(prev => ({ ...prev, distanceToCampus: e.target.value }))}
                      placeholder="e.g. 5 min walk"
                      className="w-full px-3 py-2 border border-lantern-border rounded-lg bg-lantern-surface dark:bg-lantern-surface-secondary text-lantern-text text-sm focus:ring-2 focus:ring-lantern-primary"
                    />
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Description */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label htmlFor="listing-description" className="text-sm font-semibold text-lantern-text">
                Description
              </label>
              <button
                type="button"
                onClick={handleGenerateDescription}
                disabled={isGeneratingDesc || !formData.title.trim()}
                className="flex items-center gap-1.5 px-3 py-1 bg-lantern-primary hover:bg-lantern-primary-dark disabled:bg-lantern-border disabled:cursor-not-allowed text-white text-xs font-semibold rounded-md transition-colors"
                title={formData.title.trim() ? 'Generate description with AI' : 'Enter a title first'}
              >
                <SparklesIcon className="w-3.5 h-3.5" />
                {isGeneratingDesc ? 'Generating…' : 'AI Generate'}
              </button>
            </div>
            <textarea
              id="listing-description"
              value={formData.description}
              onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
              placeholder="Provide detailed information about your listing..."
              rows={4}
              className="w-full px-4 py-3 border border-lantern-border rounded-lg focus:ring-2 focus:ring-lantern-primary focus:border-lantern-primary bg-lantern-surface dark:bg-lantern-surface-secondary text-lantern-text placeholder:text-lantern-text-tertiary resize-none"
            />
          </div>

          {/* Price and Location */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label htmlFor="listing-price" className="block text-sm font-semibold text-lantern-text mb-2">
                <CurrencyDollarIcon className="w-4 h-4 inline mr-1" />
                Price (₦)
              </label>
              <input
                id="listing-price"
                type="number"
                value={formData.price}
                onChange={(e) => setFormData(prev => ({ ...prev, price: e.target.value }))}
                placeholder="0.00"
                step="0.01"
                min="0"
                className="w-full px-4 py-3 border border-lantern-border rounded-lg focus:ring-2 focus:ring-lantern-primary focus:border-lantern-primary bg-lantern-surface dark:bg-lantern-surface-secondary text-lantern-text placeholder:text-lantern-text-tertiary"
              />
              <p className="text-xs text-lantern-text-secondary mt-1">Leave empty for free items</p>
            </div>

            <div>
              <label htmlFor="listing-quantity" className="block text-sm font-semibold text-lantern-text mb-2">
                Quantity in stock
              </label>
              <input
                id="listing-quantity"
                type="number"
                value={formData.quantity}
                onChange={(e) => setFormData(prev => ({ ...prev, quantity: e.target.value }))}
                placeholder="Unlimited"
                min="0"
                className="w-full px-4 py-3 border border-lantern-border rounded-lg focus:ring-2 focus:ring-lantern-primary focus:border-lantern-primary bg-lantern-surface dark:bg-lantern-surface-secondary text-lantern-text"
              />
              <p className="text-xs text-lantern-text-secondary mt-1">Leave empty for one-of-a-kind items</p>
            </div>

            <div>
              <label htmlFor="listing-campus" className="block text-sm font-semibold text-lantern-text mb-2">
                <MapPinIcon className="w-4 h-4 inline mr-1" />
                Campus <span className="text-red-500">*</span>
              </label>
              <CampusSearchSelect
                id="listing-campus"
                campuses={campuses}
                value={formData.campusId}
                emptyLabel="Select campus"
                onChange={(campusId) => setFormData((prev) => ({ ...prev, campusId: campusId || '' }))}
              />
            </div>

            <div>
              <label htmlFor="listing-location" className="block text-sm font-semibold text-lantern-text mb-2">
                Meetup detail (optional)
              </label>
              <input
                id="listing-location"
                type="text"
                value={formData.location}
                onChange={(e) => setFormData(prev => ({ ...prev, location: e.target.value }))}
                placeholder="Faculty gate, hall, landmark…"
                className="w-full px-4 py-3 border border-lantern-border rounded-lg focus:ring-2 focus:ring-lantern-primary focus:border-lantern-primary bg-lantern-surface dark:bg-lantern-surface-secondary text-lantern-text placeholder:text-lantern-text-tertiary"
              />
            </div>

            <label className="flex items-start gap-2 text-sm text-lantern-text-secondary">
              <input
                type="checkbox"
                checked={formData.complianceConfirmed}
                onChange={(e) => setFormData(prev => ({ ...prev, complianceConfirmed: e.target.checked }))}
                className="mt-1"
              />
              <span>{MARKETPLACE_CREATE_CONFIRMATION}</span>
            </label>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label htmlFor="listing-sale-price" className="block text-sm font-semibold text-lantern-text mb-2">Sale price (₦)</label>
              <input
                id="listing-sale-price"
                type="number"
                value={formData.salePrice}
                onChange={(e) => setFormData(prev => ({ ...prev, salePrice: e.target.value }))}
                className="w-full px-4 py-3 border border-lantern-border rounded-lg bg-lantern-surface dark:bg-lantern-surface-secondary"
              />
            </div>
            <div>
              <label htmlFor="listing-sale-ends" className="block text-sm font-semibold text-lantern-text mb-2">Sale ends</label>
              <input
                id="listing-sale-ends"
                type="datetime-local"
                value={formData.saleEndsAt}
                onChange={(e) => setFormData(prev => ({ ...prev, saleEndsAt: e.target.value }))}
                className="w-full px-4 py-3 border border-lantern-border rounded-lg bg-lantern-surface dark:bg-lantern-surface-secondary"
              />
            </div>
            <div>
              <label htmlFor="listing-promo-label" className="block text-sm font-semibold text-lantern-text mb-2">Promo label</label>
              <input
                id="listing-promo-label"
                type="text"
                value={formData.promoLabel}
                onChange={(e) => setFormData(prev => ({ ...prev, promoLabel: e.target.value }))}
                placeholder="Exam week"
                className="w-full px-4 py-3 border border-lantern-border rounded-lg bg-lantern-surface dark:bg-lantern-surface-secondary"
              />
            </div>
          </div>

          {/* Images */}
          <div>
            <label htmlFor="listing-images" className="block text-sm font-semibold text-lantern-text mb-2">
              <PhotoIcon className="w-4 h-4 inline mr-1" />
              Images
            </label>
            <div className="space-y-3">
              <div className="flex items-center justify-center w-full">
                <label htmlFor="listing-images" className="flex flex-col items-center justify-center w-full h-32 border-2 border-lantern-border border-dashed rounded-lg cursor-pointer bg-lantern-background-secondary/50 hover:bg-lantern-background-secondary/50 transition-colors duration-200">
                  <div className="flex flex-col items-center justify-center pt-5 pb-6">
                    <PhotoIcon className="w-8 h-8 mb-3 text-lantern-text-tertiary" />
                    <p className="mb-2 text-sm text-lantern-text-secondary">
                      <span className="font-semibold">Click to upload</span> or drag and drop
                    </p>
                    <p className="text-xs text-lantern-text-secondary">
                      PNG, JPG, GIF up to 5MB each
                    </p>
                  </div>
                  <input
                    id="listing-images"
                    type="file"
                    multiple
                    accept="image/*"
                    onChange={handleFileSelect}
                    className="hidden"
                  />
                </label>
              </div>

              {/* Image Preview */}
              {formData.images.length > 0 && (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {formData.images.map((image, index) => (
                    <div key={index} className="relative group">
                      <img
                        src={image.preview}
                        alt={`Preview ${index + 1}`}
                        className="w-full h-24 object-cover rounded-lg border border-lantern-border"
                        onError={(e) => { e.currentTarget.style.display = 'none'; }}
                      />
                      <button
                        type="button"
                        onClick={() => removeImage(index)}
                        className="absolute top-2 right-2 p-1 bg-red-500 hover:bg-red-600 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-200"
                      >
                        <TrashIcon className="w-4 h-4" />
                      </button>
                      {uploadingImages && (
                        <div className="absolute inset-0 bg-black bg-opacity-50 rounded-lg flex items-center justify-center">
                          <div className="text-white text-xs">Uploading...</div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="flex justify-end space-x-3 pt-4 border-t border-lantern-border">
            <button
              type="button"
              onClick={onClose}
              className="px-6 py-3 border border-lantern-border text-lantern-text rounded-lg hover:bg-lantern-background dark:hover:bg-lantern-surface-secondary font-semibold transition-colors duration-200"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || uploadingImages || !formData.title.trim() || !formData.subcategory}
              className="px-6 py-3 bg-lantern-primary hover:bg-lantern-primary-dark disabled:bg-lantern-border disabled:cursor-not-allowed text-white rounded-lg font-semibold flex items-center transition-colors duration-200"
            >
              {uploadingImages ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                  Uploading Images...
                </>
              ) : loading ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                  Creating...
                </>
              ) : (
                <>
                  <PlusIcon className="w-5 h-5 mr-2" />
                  Create Listing
                </>
              )}
            </button>
          </div>
        </form>
    </Modal>
  );
};

export default CreateMarketplaceListingModal;