import React, { useState, useEffect } from 'react';
import { createMarketplaceListing, updateMarketplaceListing, uploadMarketplaceImage, deleteMarketplaceImage, fetchCustomCategories, fetchMarketplaceCampuses } from '../services/supabase';
import { CoursePicker } from './academic/CoursePicker';
import { TopicPicker } from './academic/TopicPicker';
import { CampusSearchSelect } from './marketplace/CampusSearchSelect';
import usePaystackEnabled from './marketplace/usePaystackEnabled';
import { RightsAttestationCheckbox } from './moderation/RightsAttestationCheckbox';
import { isInlineSubmitError, listingNeedsAttestation, resolveListingCategoryId } from '../utils/moderationForms';
import {
  ATTESTATION_REQUIRED_MESSAGE,
  marketplaceCreateConfirmation,
  HEIC_IMAGE_UPLOAD_ERROR,
  isHeicImageUpload,
  isOtherCityCampus,
  type MarketplaceCampus,
} from '@lantern/shared';
import {
  attributesForNode,
  getTaxonomyNode,
  taxonomyPathLabel,
  type TaxonomyAttributeKey,
} from '@lantern/shared/marketplace';
import ListingClassifier from './marketplace/ListingClassifier';
import { useToastStore } from '../stores/toastStore';
import { compressImage } from '../utils/imageCompression';
import { aiGenerateListingDescription } from '../services/ai';
import {
  XMarkIcon,
  PhotoIcon,
  MapPinIcon,
  CurrencyDollarIcon,
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
  onOpenStudyProducts?: () => void;
}

interface ImageFile {
  file: File;
  preview: string;
  uploaded?: boolean;
  url?: string;
  path?: string;
}

const DRAFT_STORAGE_KEY = 'lantern_marketplace_listing_draft';

/** Draft persists everything except images (File objects can't be serialized). */
type ListingDraft = Omit<CreateListingFormData, 'images'> & {
  customCategory: string;
  savedAt: number;
};

interface CreateListingFormData {
  title: string;
  description: string;
  price: string;
  salePrice: string;
  saleEndsAt: string;
  promoLabel: string;
  quantity: string;
  location: string;
  campusId: string;
  complianceConfirmed: boolean;
  subcategory: string;
  images: ImageFile[];
  condition: '' | 'new' | 'like-new' | 'good' | 'fair';
  /** Legacy free-text code — now derived from the picked course (kept for buyers/search). */
  courseCode: string;
  /** Academic course (marketplace_listings.course_id). */
  courseId: string | null;
  /** Syllabus topic inside `courseId` (marketplace_listings.topic_id). */
  topicId: string | null;
  taxonomyNodeId: string;
  year: string;
  semester: '' | '1st' | '2nd';
  edition: string;
  isbn: string;
  bedrooms: string;
  furnished: '' | 'yes' | 'no';
  distanceToCampus: string;
}

const CreateMarketplaceListingModal: React.FC<CreateMarketplaceListingModalProps> = ({
  isOpen,
  onClose,
  category,
  onSuccess,
  onOpenStudyProducts,
}) => {
  const paystackEnabled = usePaystackEnabled();
  const [formData, setFormData] = useState<CreateListingFormData>({
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
    courseId: null,
    topicId: null,
    taxonomyNodeId: '',
    year: '',
    semester: '' as '' | '1st' | '2nd',
    edition: '',
    isbn: '',
    bedrooms: '',
    furnished: '' as '' | 'yes' | 'no',
    distanceToCampus: '',
  });
  const [loading, setLoading] = useState(false);
  // One-shot: the first photoless Publish warns; the second goes through.
  const [skipPhotoNudge, setSkipPhotoNudge] = useState(false);
  // Rights attestation (academic categories only) + the 400s the seller can
  // fix in the form (missing attestation, blocked wording) shown inline.
  const [attested, setAttested] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [uploadingImages, setUploadingImages] = useState(false);
  const [isGeneratingDesc, setIsGeneratingDesc] = useState(false);
  const [customCategory, setCustomCategory] = useState('');
  const [existingCustomCategories, setExistingCustomCategories] = useState<{id: string; name: string; usage_count: number}[]>([]);
  const [campuses, setCampuses] = useState<MarketplaceCampus[]>([]);
  const selectedCampus = campuses.find((campus) => campus.id === formData.campusId);
  const usesOtherCity = isOtherCityCampus(selectedCampus);

  useEffect(() => {
    if (isOpen) {
      fetchCustomCategories().then(setExistingCustomCategories).catch(() => {});
      fetchMarketplaceCampuses('NG').then(setCampuses).catch(() => {});
    }
  }, [isOpen]);

  // Restore a saved draft when the modal opens with a pristine form.
  useEffect(() => {
    if (!isOpen) return;
    setFormData(prev => {
      const pristine = !prev.title && !prev.description && prev.images.length === 0;
      if (!pristine) return prev;
      try {
        const raw = localStorage.getItem(DRAFT_STORAGE_KEY);
        if (!raw) return prev;
        const draft = JSON.parse(raw) as ListingDraft;
        if (!draft.title && !draft.description && !draft.price) return prev;
        const { customCategory: draftCustomCategory, savedAt: _savedAt, ...fields } = draft;
        setCustomCategory(draftCustomCategory || '');
        useToastStore.getState().showToast('Draft restored — your progress was saved.');
        return { ...prev, ...fields, images: prev.images };
      } catch {
        return prev;
      }
    });
  }, [isOpen]);

  // Autosave the draft (debounced) while the modal is open.
  useEffect(() => {
    if (!isOpen) return;
    const timer = setTimeout(() => {
      const hasContent = formData.title || formData.description || formData.price;
      try {
        if (!hasContent) {
          localStorage.removeItem(DRAFT_STORAGE_KEY);
          return;
        }
        const { images: _images, ...fields } = formData;
        const draft: ListingDraft = { ...fields, customCategory, savedAt: Date.now() };
        localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft));
      } catch { /* storage full or unavailable — draft is best-effort */ }
    }, 500);
    return () => clearTimeout(timer);
  }, [isOpen, formData, customCategory]);

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

  const selectedTaxonomyNode = getTaxonomyNode(formData.taxonomyNodeId);
  const categoryAttributes = attributesForNode(selectedTaxonomyNode);
  const attributeKeys = new Set<TaxonomyAttributeKey>(categoryAttributes.map((attr) => attr.key));
  const isDigitalPublishFlow =
    selectedTaxonomyNode?.publishFlow === 'question_bank' ||
    selectedTaxonomyNode?.publishFlow === 'study_pack';

  // Academic content categories (past questions, notes, projects, textbooks)
  // need the rights attestation; the API refuses them without it (400).
  const needsAttestation = listingNeedsAttestation({
    listingKind: 'single',
    category: resolveListingCategoryId(formData.subcategory, customCategory),
  });

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
      if (isHeicImageUpload({ contentType: file.type, fileName: file.name })) {
        useToastStore.getState().showToast(HEIC_IMAGE_UPLOAD_ERROR, 'error');
        return false;
      }
      // Check file type
      if (!file.type.startsWith('image/')) {
        useToastStore.getState().showToast(`${file.name} is not a valid image file.`, 'error');
        return false;
      }
      const allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
      if (!allowed.includes(file.type.toLowerCase())) {
        useToastStore
          .getState()
          .showToast(
            `${file.name}: only JPEG, PNG, GIF, and WebP are supported (not HEIC).`,
            'error'
          );
        return false;
      }
      // Check file size (max 5MB)
      if (file.size > 5 * 1024 * 1024) {
        useToastStore.getState().showToast(`${file.name} is too large. Maximum file size is 5MB.`, 'error');
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
            // Persist stable object URLs (not short-lived signed URLs) on the listing.
            const persisted = result.storageUrl || result.path || result.url;
            uploadedUrls.push(persisted);
            image.uploaded = true;
            image.url = persisted;
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
      } else if (image.path || image.url) {
        // Prefer stable path/storage URL over any leftover signed preview URL.
        uploadedUrls.push(image.path || image.url);
      }
    }

    return { urls: uploadedUrls, failedNames };
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (import.meta.env.DEV) {
      console.log('[CreateMarketplaceListingModal] Form submitted');
    }
    
    if (!formData.taxonomyNodeId || !formData.subcategory) {
      useToastStore.getState().showToast('Please choose a listing type');
      return;
    }

    if (isDigitalPublishFlow) {
      useToastStore
        .getState()
        .showToast('Publish this from Study products, or pick the printed/PDF type instead.');
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
      useToastStore.getState().showToast('Please select a campus or Other city');
      return;
    }

    if (usesOtherCity && !formData.location.trim()) {
      useToastStore.getState().showToast('Please enter the Nigerian city for this listing');
      return;
    }

    if (!formData.complianceConfirmed) {
      useToastStore.getState().showToast('Please confirm the marketplace fulfillment terms');
      return;
    }

    const missingRequired = categoryAttributes.find((attr) => {
      if (!attr.required) return false;
      if (attr.key === 'condition') return !formData.condition;
      return false;
    });
    if (missingRequired) {
      useToastStore.getState().showToast(`Please add ${missingRequired.label.toLowerCase()} for this listing type`);
      return;
    }

    if (needsAttestation && !attested) {
      setSubmitError(ATTESTATION_REQUIRED_MESSAGE);
      return;
    }
    setSubmitError(null);

    // Photos are the strongest conversion lever a listing has; nudge — but
    // don't block — before publishing a photoless one. Mirrors mobile.
    if (formData.images.length === 0 && !skipPhotoNudge) {
      setSkipPhotoNudge(true);
      useToastStore
        .getState()
        .showToast('Listings with photos get far more buyers. Add one, or press Publish again to continue.');
      return;
    }

    setLoading(true);

    try {
      // Build category-specific fields
      const categorySpecificFields: Record<string, unknown> = {
        parentCategory: selectedTaxonomyNode?.department || category,
        taxonomyNodeId: formData.taxonomyNodeId,
        taxonomyPath: formData.taxonomyNodeId ? taxonomyPathLabel(formData.taxonomyNodeId) : undefined,
      };
      if (attributeKeys.has('condition') && formData.condition) categorySpecificFields.condition = formData.condition;
      if (attributeKeys.has('isbn') && formData.isbn) categorySpecificFields.isbn = formData.isbn;
      if (attributeKeys.has('edition') && formData.edition) categorySpecificFields.edition = formData.edition;
      // courseCode stays in category_specific_fields for backwards compat — it is the picked course's code.
      if (attributeKeys.has('courseCode') && formData.courseCode) categorySpecificFields.courseCode = formData.courseCode;
      if (attributeKeys.has('year') && formData.year) categorySpecificFields.year = formData.year;
      if (attributeKeys.has('semester') && formData.semester) categorySpecificFields.semester = formData.semester;
      if (attributeKeys.has('bedrooms') && formData.bedrooms) categorySpecificFields.bedrooms = parseInt(formData.bedrooms);
      if (attributeKeys.has('furnished') && formData.furnished) categorySpecificFields.furnished = formData.furnished === 'yes';
      if (attributeKeys.has('distanceToCampus') && formData.distanceToCampus) categorySpecificFields.distanceToCampus = formData.distanceToCampus;
      if (usesOtherCity) categorySpecificFields.otherCity = formData.location.trim();

      const parsedPrice = formData.price.trim() ? parseFloat(formData.price) : undefined;
      const parsedSalePrice = formData.salePrice.trim()
        ? parseFloat(formData.salePrice)
        : undefined;
      if (parsedPrice != null && (!Number.isFinite(parsedPrice) || parsedPrice < 0)) {
        useToastStore.getState().showToast('Please enter a valid price');
        setLoading(false);
        return;
      }
      if (parsedSalePrice != null) {
        if (!Number.isFinite(parsedSalePrice) || parsedSalePrice < 0) {
          useToastStore.getState().showToast('Please enter a valid sale price');
          setLoading(false);
          return;
        }
        if (parsedPrice == null || parsedSalePrice >= parsedPrice) {
          useToastStore
            .getState()
            .showToast('Discounted price must be lower than the asking price, or leave it blank');
          setLoading(false);
          return;
        }
        if (parsedSalePrice > 0 && !formData.saleEndsAt.trim()) {
          useToastStore
            .getState()
            .showToast(
              "Add a promo end date, or clear the discounted price — a sale with no end date won't show to buyers."
            );
          setLoading(false);
          return;
        }
      }

      // First create the listing - use subcategory as the database category
      const resolvedCategory = formData.subcategory === 'other' ? `custom:${customCategory.trim()}` : formData.subcategory;
      const listingData = {
        category: resolvedCategory,
        title: formData.title,
        description: formData.description || undefined,
        price: parsedPrice,
        sale_price: parsedSalePrice,
        sale_ends_at:
          parsedSalePrice != null && formData.saleEndsAt
            ? new Date(formData.saleEndsAt).toISOString()
            : undefined,
        promo_label: formData.promoLabel || undefined,
        quantity: formData.quantity ? parseInt(formData.quantity, 10) : undefined,
        location: formData.location || undefined,
        campus_id: formData.campusId,
        country_code: 'NG',
        currency: 'NGN',
        images: [],
        categorySpecificFields,
        courseId: formData.courseId,
        // A topic without its course is what the server rejects — never send one.
        topicId: formData.courseId ? formData.topicId : null,
        // Sent whenever the seller ticked it; required by the API for academic categories.
        ...(attested ? { attestation: true } : {}),
      };
      
      if (import.meta.env.DEV) {
        console.log('[CreateMarketplaceListingModal] Creating listing');
      }

      const listing = await createMarketplaceListing(listingData);
      if (import.meta.env.DEV) {
        console.log('[CreateMarketplaceListingModal] Listing created');
      }

      // The listing is now LIVE. Any failure while attaching photos must NOT be
      // reported as a create failure — otherwise the seller resubmits and
      // duplicates the live listing. Isolate the post-create steps.
      try {
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
          } else {
            useToastStore.getState().showToast('Listing published — it is now live!', 'success');
          }
        } else {
          useToastStore.getState().showToast('Listing published — it is now live!', 'success');
        }
      } catch (attachError) {
        console.error('Error attaching photos to created listing:', attachError);
        setUploadingImages(false);
        useToastStore.getState().showToast(
          "Listing published, but photos couldn't be attached — edit the listing to add them",
          'error'
        );
      }

      try { localStorage.removeItem(DRAFT_STORAGE_KEY); } catch { /* best-effort */ }
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
        courseId: null,
        topicId: null,
        year: '',
        semester: '',
        edition: '',
        isbn: '',
        bedrooms: '',
        furnished: '',
        distanceToCampus: '',
      });
      setCustomCategory('');
      setAttested(false);
      setSubmitError(null);
    } catch (error) {
      console.error('Error creating listing:', error);
      // 400s the seller can fix (missing attestation, blocked wording) go inline
      // next to the submit button; everything else stays a toast.
      if (isInlineSubmitError(error)) {
        setSubmitError((error as Error).message);
      } else {
        useToastStore.getState().showToast(
          error instanceof Error && error.message && !/^HTTP error/i.test(error.message)
            ? error.message
            : 'Failed to create listing. Please try again.',
          'error'
        );
      }
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
      maxWidthClass="max-w-3xl"
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
              What are you listing? *
            </label>
            <input
              id="listing-title"
              type="text"
              value={formData.title}
              onChange={(e) => setFormData(prev => ({ ...prev, title: e.target.value }))}
              required
              placeholder="e.g. BIO 201 past questions 2023, or 2 bedroom flat near campus"
              className="w-full px-4 py-3 border border-lantern-border rounded-lg focus:ring-2 focus:ring-lantern-primary focus:border-lantern-primary bg-lantern-surface dark:bg-lantern-surface-secondary text-lantern-text placeholder:text-lantern-text-tertiary"
            />
          </div>

          <ListingClassifier
            department={category}
            title={formData.title}
            description={formData.description}
            selectedNodeId={formData.taxonomyNodeId}
            customCategory={customCategory}
            existingCustomCategories={existingCustomCategories}
            onOpenStudyProducts={onOpenStudyProducts}
            onCustomCategoryChange={setCustomCategory}
            onSelectNode={(nodeId) => {
              const node = getTaxonomyNode(nodeId);
              const listingCategory = node?.listingCategory || '';
              setFormData((prev) => ({
                ...prev,
                taxonomyNodeId: nodeId,
                subcategory: listingCategory === 'other' ? 'other' : listingCategory,
              }));
              if (listingCategory !== 'other') setCustomCategory('');
            }}
          />

          {/* Category-Specific Fields */}
          {formData.taxonomyNodeId && !isDigitalPublishFlow && categoryAttributes.length > 0 && (
            <div className="bg-lantern-background dark:bg-lantern-surface-secondary/30 rounded-lg p-4 space-y-4">
              <h4 className="text-sm font-semibold text-lantern-text">
                Details for this type
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {attributeKeys.has('condition') && (
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
                {attributeKeys.has('isbn') && (
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
                {attributeKeys.has('edition') && (
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
                {attributeKeys.has('courseCode') && (
                  <div className="space-y-2">
                    <CoursePicker
                      id="listing-course"
                      label={<span className="text-xs font-medium text-lantern-text-secondary">Course</span>}
                      value={formData.courseId}
                      onChange={(course) =>
                        setFormData(prev => ({
                          ...prev,
                          courseId: course?.id ?? null,
                          courseCode: course?.code ?? '',
                          topicId: null,
                        }))
                      }
                      placeholder="e.g. CSC 201"
                      compact
                    />
                    <TopicPicker
                      id="listing-topic"
                      label={<span className="text-xs font-medium text-lantern-text-secondary">Topic</span>}
                      courseId={formData.courseId}
                      value={formData.topicId}
                      onChange={(topic) => setFormData(prev => ({ ...prev, topicId: topic?.id ?? null }))}
                      placeholder="e.g. Recursion"
                      compact
                    />
                  </div>
                )}
                {attributeKeys.has('year') && (
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
                {attributeKeys.has('semester') && (
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
                {attributeKeys.has('bedrooms') && (
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
                {attributeKeys.has('furnished') && (
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
                {attributeKeys.has('distanceToCampus') && (
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
                Asking price (₦)
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
              <p className="text-xs text-lantern-text-secondary mt-1">
                What buyers normally pay. Leave empty for free items.
              </p>
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
                Campus or city <span className="text-red-500">*</span>
              </label>
              <CampusSearchSelect
                id="listing-campus"
                campuses={campuses}
                value={formData.campusId}
                otherCity={usesOtherCity ? formData.location : ''}
                otherCityRequired
                emptyLabel="Select campus or Other city"
                onChange={(campusId) => {
                  const nextCampus = campuses.find((campus) => campus.id === campusId);
                  const locationModeChanged =
                    isOtherCityCampus(selectedCampus) !== isOtherCityCampus(nextCampus);
                  setFormData((prev) => ({
                    ...prev,
                    campusId: campusId || '',
                    location: locationModeChanged ? '' : prev.location,
                  }));
                }}
                onOtherCityChange={(city) =>
                  setFormData((prev) => ({ ...prev, location: city }))
                }
              />
            </div>

            {!usesOtherCity && (
              <div>
                <label htmlFor="listing-location" className="block text-sm font-semibold text-lantern-text mb-2">
                  Pickup or delivery details (optional)
                </label>
                <input
                  id="listing-location"
                  type="text"
                  value={formData.location}
                  onChange={(e) => setFormData(prev => ({ ...prev, location: e.target.value }))}
                  placeholder="Meetup point, delivery area, landmark…"
                  className="w-full px-4 py-3 border border-lantern-border rounded-lg focus:ring-2 focus:ring-lantern-primary focus:border-lantern-primary bg-lantern-surface dark:bg-lantern-surface-secondary text-lantern-text placeholder:text-lantern-text-tertiary"
                />
              </div>
            )}

            <label className="flex items-start gap-2 text-sm text-lantern-text-secondary">
              <input
                type="checkbox"
                checked={formData.complianceConfirmed}
                onChange={(e) => setFormData(prev => ({ ...prev, complianceConfirmed: e.target.checked }))}
                className="mt-1"
              />
              <span>{marketplaceCreateConfirmation(paystackEnabled)}</span>
            </label>
            {needsAttestation ? (
              <RightsAttestationCheckbox
                id="create-listing-attestation"
                checked={attested}
                onChange={(checked) => {
                  setAttested(checked);
                  if (checked && submitError === ATTESTATION_REQUIRED_MESSAGE) setSubmitError(null);
                }}
                disabled={loading || uploadingImages}
              />
            ) : null}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label htmlFor="listing-sale-price" className="block text-sm font-semibold text-lantern-text mb-2">
                Discounted price (₦, optional)
              </label>
              <input
                id="listing-sale-price"
                type="number"
                value={formData.salePrice}
                onChange={(e) => setFormData(prev => ({ ...prev, salePrice: e.target.value }))}
                placeholder="Only if on promo"
                min="0"
                step="0.01"
                className="w-full px-4 py-3 border border-lantern-border rounded-lg bg-lantern-surface dark:bg-lantern-surface-secondary"
              />
              <p className="text-xs text-lantern-text-secondary mt-1">
                Optional markdown for a sale badge. Must be lower than asking price — not your cost/profit.
              </p>
            </div>
            <div>
              <label htmlFor="listing-sale-ends" className="block text-sm font-semibold text-lantern-text mb-2">Promo ends</label>
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
                      JPEG, PNG, GIF, or WebP up to 5MB each (HEIC not supported)
                    </p>
                  </div>
                  <input
                    id="listing-images"
                    type="file"
                    multiple
                    accept="image/jpeg,image/png,image/gif,image/webp,.jpg,.jpeg,.png,.gif,.webp"
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

          {submitError ? (
            <p role="alert" className="text-sm text-lantern-error">
              {submitError}
            </p>
          ) : null}

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