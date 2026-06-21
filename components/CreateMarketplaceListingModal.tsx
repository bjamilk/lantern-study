import React, { useState, useEffect } from 'react';
import { createMarketplaceListing, updateMarketplaceListing, uploadMarketplaceImage, deleteMarketplaceImage, fetchCustomCategories } from '../services/supabase';
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

  useEffect(() => {
    if (isOpen) {
      fetchCustomCategories().then(setExistingCustomCategories).catch(() => {});
    }
  }, [isOpen]);

  const handleGenerateDescription = async () => {
    if (!formData.title.trim()) { alert('Please enter a title first.'); return; }
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
      alert('Failed to generate description. Please try again.');
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
      alert(`Maximum ${MAX_IMAGES} images allowed.`);
      e.target.value = '';
      return;
    }

    const filesToProcess = files.slice(0, remainingSlots);
    if (files.length > remainingSlots) {
      alert(`Only ${remainingSlots} more image(s) can be added (max ${MAX_IMAGES}).`);
    }

    const validFiles = filesToProcess.filter((file: File) => {
      // Check file type
      if (!file.type.startsWith('image/')) {
        alert(`${file.name} is not a valid image file.`);
        return false;
      }
      // Check file size (max 5MB)
      if (file.size > 5 * 1024 * 1024) {
        alert(`${file.name} is too large. Maximum file size is 5MB.`);
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

  const uploadImages = async (listingId: string) => {
    const uploadedUrls: string[] = [];

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
          }
        }

        if (!success) {
          // Continue with other uploads even if one image fails.
          console.warn('Skipping image after retry failures:', image.file.name);
        }
      } else if (image.url) {
        uploadedUrls.push(image.url);
      }
    }

    return uploadedUrls;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (import.meta.env.DEV) {
      console.log('[CreateMarketplaceListingModal] Form submitted');
    }
    
    if (!formData.subcategory) {
      alert('Please select a category');
      return;
    }

    if (formData.subcategory === 'other' && !customCategory.trim()) {
      alert('Please enter a custom category name');
      return;
    }
    
    if (!formData.title.trim()) {
      alert('Please enter a title');
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
        const uploadedUrls = await uploadImages(listing.id);

        // Update the existing listing with image URLs
        if (uploadedUrls.length > 0) {
          await updateMarketplaceListing(listing.id, {
            images: uploadedUrls
          });
        }
        setUploadingImages(false);
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
      alert('Failed to create listing. Please try again.');
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
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white dark:bg-slate-800 rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-slate-200 dark:border-slate-700">
          <div className="flex items-center">
            {category === 'academic' ? (
              <AcademicCapIcon className="w-6 h-6 text-indigo-600 mr-3" />
            ) : (
              <BriefcaseIcon className="w-6 h-6 text-indigo-600 mr-3" />
            )}
            <h2 className="text-xl font-bold text-slate-800 dark:text-slate-200">
              Create {category === 'academic' ? 'Academic' : 'Student Life'} Listing
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors duration-200"
          >
            <XMarkIcon className="w-5 h-5 text-slate-500 dark:text-slate-400" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {/* Title */}
          <div>
            <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
              Title *
            </label>
            <input
              type="text"
              value={formData.title}
              onChange={(e) => setFormData(prev => ({ ...prev, title: e.target.value }))}
              required
              placeholder="Enter an engaging title for your listing"
              className="w-full px-4 py-3 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 placeholder-slate-500 dark:placeholder-slate-400"
            />
          </div>

          {/* Category */}
          <div>
            <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-3">
              Category *
            </label>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {subcategories.map(subcat => {
                const IconComponent = subcat.icon;
                return (
                  <button
                    key={subcat.id}
                    type="button"
                    onClick={() => setFormData(prev => ({ ...prev, subcategory: subcat.id }))}
                    className={`p-3 border rounded-lg text-left transition-all duration-200 ${
                      formData.subcategory === subcat.id
                        ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-300'
                        : 'border-slate-200 dark:border-slate-600 hover:border-slate-300 dark:hover:border-slate-500 bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    <IconComponent className="w-5 h-5 mb-2 text-slate-500 dark:text-slate-400" />
                    <span className="text-sm font-medium">{subcat.name}</span>
                  </button>
                );
              })}
              {/* Other / Custom Category */}
              <button
                type="button"
                onClick={() => setFormData(prev => ({ ...prev, subcategory: 'other' }))}
                className={`p-3 border rounded-lg text-left transition-all duration-200 ${
                  formData.subcategory === 'other'
                    ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-300'
                    : 'border-slate-200 dark:border-slate-600 hover:border-slate-300 dark:hover:border-slate-500 bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-300'
                }`}
              >
                <PlusIcon className="w-5 h-5 mb-2 text-slate-500 dark:text-slate-400" />
                <span className="text-sm font-medium">Other</span>
              </button>
            </div>
            {formData.subcategory === 'other' && (
              <div className="mt-3 space-y-2">
                <input
                  type="text"
                  value={customCategory}
                  onChange={(e) => setCustomCategory(e.target.value)}
                  placeholder="Enter your custom category name"
                  className="w-full px-4 py-3 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 placeholder-slate-500 dark:placeholder-slate-400"
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

          {/* Category-Specific Fields */}
          {formData.subcategory && getCategoryFields(formData.subcategory).length > 0 && (
            <div className="bg-slate-50 dark:bg-slate-700/30 rounded-lg p-4 space-y-4">
              <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                Additional Details
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {getCategoryFields(formData.subcategory).includes('condition') && (
                  <div>
                    <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Condition</label>
                    <select
                      value={formData.condition}
                      onChange={(e) => setFormData(prev => ({ ...prev, condition: e.target.value as any }))}
                      className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 text-sm focus:ring-2 focus:ring-indigo-500"
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
                    <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">ISBN</label>
                    <input
                      type="text"
                      value={formData.isbn}
                      onChange={(e) => setFormData(prev => ({ ...prev, isbn: e.target.value }))}
                      placeholder="e.g. 978-0-13-468599-1"
                      className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 text-sm focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                )}
                {getCategoryFields(formData.subcategory).includes('edition') && (
                  <div>
                    <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Edition</label>
                    <input
                      type="text"
                      value={formData.edition}
                      onChange={(e) => setFormData(prev => ({ ...prev, edition: e.target.value }))}
                      placeholder="e.g. 4th Edition"
                      className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 text-sm focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                )}
                {getCategoryFields(formData.subcategory).includes('courseCode') && (
                  <div>
                    <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Course Code</label>
                    <input
                      type="text"
                      value={formData.courseCode}
                      onChange={(e) => setFormData(prev => ({ ...prev, courseCode: e.target.value }))}
                      placeholder="e.g. CSC 201"
                      className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 text-sm focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                )}
                {getCategoryFields(formData.subcategory).includes('year') && (
                  <div>
                    <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Year</label>
                    <input
                      type="text"
                      value={formData.year}
                      onChange={(e) => setFormData(prev => ({ ...prev, year: e.target.value }))}
                      placeholder="e.g. 2025"
                      className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 text-sm focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                )}
                {getCategoryFields(formData.subcategory).includes('semester') && (
                  <div>
                    <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Semester</label>
                    <select
                      value={formData.semester}
                      onChange={(e) => setFormData(prev => ({ ...prev, semester: e.target.value as any }))}
                      className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 text-sm focus:ring-2 focus:ring-indigo-500"
                    >
                      <option value="">Select semester</option>
                      <option value="1st">1st Semester</option>
                      <option value="2nd">2nd Semester</option>
                    </select>
                  </div>
                )}
                {getCategoryFields(formData.subcategory).includes('bedrooms') && (
                  <div>
                    <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Bedrooms</label>
                    <input
                      type="number"
                      value={formData.bedrooms}
                      onChange={(e) => setFormData(prev => ({ ...prev, bedrooms: e.target.value }))}
                      placeholder="e.g. 2"
                      min="0"
                      className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 text-sm focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                )}
                {getCategoryFields(formData.subcategory).includes('furnished') && (
                  <div>
                    <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Furnished</label>
                    <select
                      value={formData.furnished}
                      onChange={(e) => setFormData(prev => ({ ...prev, furnished: e.target.value as any }))}
                      className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 text-sm focus:ring-2 focus:ring-indigo-500"
                    >
                      <option value="">Select</option>
                      <option value="yes">Yes</option>
                      <option value="no">No</option>
                    </select>
                  </div>
                )}
                {getCategoryFields(formData.subcategory).includes('distanceToCampus') && (
                  <div>
                    <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Distance to Campus</label>
                    <input
                      type="text"
                      value={formData.distanceToCampus}
                      onChange={(e) => setFormData(prev => ({ ...prev, distanceToCampus: e.target.value }))}
                      placeholder="e.g. 5 min walk"
                      className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 text-sm focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Description */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                Description
              </label>
              <button
                type="button"
                onClick={handleGenerateDescription}
                disabled={isGeneratingDesc || !formData.title.trim()}
                className="flex items-center gap-1.5 px-3 py-1 bg-purple-600 hover:bg-purple-700 disabled:bg-slate-400 disabled:cursor-not-allowed text-white text-xs font-semibold rounded-md transition-colors"
                title={formData.title.trim() ? 'Generate description with AI' : 'Enter a title first'}
              >
                <SparklesIcon className="w-3.5 h-3.5" />
                {isGeneratingDesc ? 'Generating…' : 'AI Generate'}
              </button>
            </div>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
              placeholder="Provide detailed information about your listing..."
              rows={4}
              className="w-full px-4 py-3 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 placeholder-slate-500 dark:placeholder-slate-400 resize-none"
            />
          </div>

          {/* Price and Location */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                <CurrencyDollarIcon className="w-4 h-4 inline mr-1" />
                Price (₦)
              </label>
              <input
                type="number"
                value={formData.price}
                onChange={(e) => setFormData(prev => ({ ...prev, price: e.target.value }))}
                placeholder="0.00"
                step="0.01"
                min="0"
                className="w-full px-4 py-3 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 placeholder-slate-500 dark:placeholder-slate-400"
              />
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Leave empty for free items</p>
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                Quantity in stock
              </label>
              <input
                type="number"
                value={formData.quantity}
                onChange={(e) => setFormData(prev => ({ ...prev, quantity: e.target.value }))}
                placeholder="Unlimited"
                min="0"
                className="w-full px-4 py-3 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100"
              />
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Leave empty for one-of-a-kind items</p>
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                <MapPinIcon className="w-4 h-4 inline mr-1" />
                Location
              </label>
              <input
                type="text"
                value={formData.location}
                onChange={(e) => setFormData(prev => ({ ...prev, location: e.target.value }))}
                placeholder="City, State or Campus"
                className="w-full px-4 py-3 border border-slate-300 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 placeholder-slate-500 dark:placeholder-slate-400"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">Sale price (₦)</label>
              <input
                type="number"
                value={formData.salePrice}
                onChange={(e) => setFormData(prev => ({ ...prev, salePrice: e.target.value }))}
                className="w-full px-4 py-3 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">Sale ends</label>
              <input
                type="datetime-local"
                value={formData.saleEndsAt}
                onChange={(e) => setFormData(prev => ({ ...prev, saleEndsAt: e.target.value }))}
                className="w-full px-4 py-3 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">Promo label</label>
              <input
                type="text"
                value={formData.promoLabel}
                onChange={(e) => setFormData(prev => ({ ...prev, promoLabel: e.target.value }))}
                placeholder="Exam week"
                className="w-full px-4 py-3 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700"
              />
            </div>
          </div>

          {/* Images */}
          <div>
            <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
              <PhotoIcon className="w-4 h-4 inline mr-1" />
              Images
            </label>
            <div className="space-y-3">
              <div className="flex items-center justify-center w-full">
                <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-slate-300 dark:border-slate-600 border-dashed rounded-lg cursor-pointer bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-700/50 transition-colors duration-200">
                  <div className="flex flex-col items-center justify-center pt-5 pb-6">
                    <PhotoIcon className="w-8 h-8 mb-3 text-slate-400 dark:text-slate-500" />
                    <p className="mb-2 text-sm text-slate-500 dark:text-slate-400">
                      <span className="font-semibold">Click to upload</span> or drag and drop
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      PNG, JPG, GIF up to 5MB each
                    </p>
                  </div>
                  <input
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
                        className="w-full h-24 object-cover rounded-lg border border-slate-200 dark:border-slate-600"
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
          <div className="flex justify-end space-x-3 pt-4 border-t border-slate-200 dark:border-slate-700">
            <button
              type="button"
              onClick={onClose}
              className="px-6 py-3 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 font-semibold transition-colors duration-200"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || uploadingImages || !formData.title.trim() || !formData.subcategory}
              className="px-6 py-3 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white rounded-lg font-semibold flex items-center transition-colors duration-200"
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
      </div>
    </div>
  );
};

export default CreateMarketplaceListingModal;