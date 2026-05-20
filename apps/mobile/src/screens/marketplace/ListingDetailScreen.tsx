// ===========================================
// Lantern Study Mobile - Listing Detail Screen
// ===========================================

import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  Dimensions,
  TextInput,
  Alert,
  Modal,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useMarketplaceStore, getCategoryInfo } from '../../stores/marketplaceStore';
import { useTheme } from '../../theme';

const { width } = Dimensions.get('window');

export default function ListingDetailScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { listingId } = route.params || {};

  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [showContactModal, setShowContactModal] = useState(false);
  const [showReviewModal, setShowReviewModal] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  const [contactMessage, setContactMessage] = useState('');
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewComment, setReviewComment] = useState('');
  const [reportReason, setReportReason] = useState('');
  const [reportDetails, setReportDetails] = useState('');
  const [sending, setSending] = useState(false);

  const { currentListing, favorites, isLoading, fetchListing, toggleFavorite, sendInquiry } = useMarketplaceStore();
  const isFavorite = currentListing ? favorites.has(currentListing.id) : false;
  const { colors } = useTheme();

  useEffect(() => {
    if (listingId) {
      fetchListing(listingId);
    }
  }, [listingId]);

  const formatPrice = (price?: number) => {
    if (!price) return 'Free';
    return `₦${price.toLocaleString()}`;
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-NG', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  const handleContactSeller = useCallback(async () => {
    if (!contactMessage.trim()) return;
    
    setSending(true);
    try {
      await sendInquiry(listingId, contactMessage.trim());
      setShowContactModal(false);
      setContactMessage('');
      Alert.alert('Success', 'Your inquiry has been sent to the seller!');
    } catch (error) {
      Alert.alert('Error', 'Failed to send inquiry. Please try again.');
    } finally {
      setSending(false);
    }
  }, [contactMessage, listingId, sendInquiry]);

  const handleSubmitReview = useCallback(() => {
    // Would submit review in real app
    setShowReviewModal(false);
    setReviewRating(5);
    setReviewComment('');
    Alert.alert('Success', 'Your review has been submitted!');
  }, []);

  const handleSubmitReport = useCallback(() => {
    if (!reportReason) {
      Alert.alert('Error', 'Please select a reason for reporting');
      return;
    }
    // Would submit report in real app
    setShowReportModal(false);
    setReportReason('');
    setReportDetails('');
    Alert.alert('Report Submitted', 'Thank you for your report. We will review it shortly.');
  }, [reportReason]);

  const handleShare = useCallback(() => {
    // Would share listing in real app
    Alert.alert('Share', 'Sharing functionality coming soon!');
  }, []);

  if (isLoading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={[styles.loadingText, { color: colors.textSecondary }]}>Loading listing...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!currentListing) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.errorContainer}>
          <Ionicons name="alert-circle-outline" size={64} color={colors.textSecondary} />
          <Text style={[styles.errorTitle, { color: colors.text }]}>Listing not found</Text>
          <Text style={[styles.errorSubtitle, { color: colors.textSecondary }]}>This listing may have been removed.</Text>
          <TouchableOpacity style={[styles.backButton, { backgroundColor: colors.primary }]} onPress={() => navigation.goBack()}>
            <Ionicons name="arrow-back" size={20} color="#ffffff" />
            <Text style={styles.backButtonText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const categoryInfo = getCategoryInfo(currentListing.category);
  const images = currentListing.images || [];

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      {/* Header */}
      <View style={[styles.header, { backgroundColor: colors.card }]}>
        <TouchableOpacity style={styles.headerButton} onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <View style={styles.headerActions}>
          <TouchableOpacity style={styles.headerButton} onPress={() => toggleFavorite(currentListing.id)}>
            <Ionicons name={isFavorite ? 'heart' : 'heart-outline'} size={24} color={isFavorite ? '#ef4444' : colors.text} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.headerButton} onPress={handleShare}>
            <Ionicons name="share-outline" size={24} color={colors.text} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.headerButton} onPress={() => setShowReportModal(true)}>
            <Ionicons name="flag-outline" size={24} color={colors.text} />
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {/* Image Carousel */}
        <View style={styles.imageCarousel}>
          {images.length > 0 ? (
            <>
              <ScrollView
                horizontal
                pagingEnabled
                showsHorizontalScrollIndicator={false}
                onMomentumScrollEnd={(e) => {
                  const index = Math.round(e.nativeEvent.contentOffset.x / width);
                  setCurrentImageIndex(index);
                }}
              >
                {images.map((uri, index) => (
                  <Image key={index} source={{ uri }} style={styles.carouselImage} />
                ))}
              </ScrollView>
              {images.length > 1 && (
                <View style={styles.imageDots}>
                  {images.map((_, index) => (
                    <View
                      key={index}
                      style={[styles.imageDot, index === currentImageIndex && styles.imageDotActive]}
                    />
                  ))}
                </View>
              )}
            </>
          ) : (
            <View style={[styles.placeholderImage, { backgroundColor: colors.card }]}>
              <Ionicons name="image-outline" size={64} color={colors.textSecondary} />
              <Text style={[styles.placeholderText, { color: colors.textSecondary }]}>No images</Text>
            </View>
          )}
        </View>

        {/* Listing Info */}
        <View style={styles.infoContainer}>
          {/* Category Badge */}
          <View style={[styles.categoryBadge, { backgroundColor: colors.card }]}>
            <Ionicons name="pricetag" size={14} color="#6366f1" />
            <Text style={styles.categoryText}>{categoryInfo.name}</Text>
          </View>

          {/* Title and Price */}
          <Text style={[styles.listingTitle, { color: colors.text }]}>{currentListing.title}</Text>
          <Text style={styles.listingPrice}>{formatPrice(currentListing.price)}</Text>

          {/* Meta Info */}
          <View style={styles.metaContainer}>
            <View style={styles.metaItem}>
              <Ionicons name="location-outline" size={16} color={colors.textSecondary} />
              <Text style={[styles.metaText, { color: colors.textSecondary }]}>{currentListing.location || 'Location not specified'}</Text>
            </View>
            <View style={styles.metaItem}>
              <Ionicons name="time-outline" size={16} color={colors.textSecondary} />
              <Text style={[styles.metaText, { color: colors.textSecondary }]}>Posted {formatDate(currentListing.created_at)}</Text>
            </View>
            <View style={styles.metaItem}>
              <Ionicons name="eye-outline" size={16} color={colors.textSecondary} />
              <Text style={[styles.metaText, { color: colors.textSecondary }]}>{currentListing.views_count || 0} views</Text>
            </View>
          </View>

          {/* Description */}
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Description</Text>
            <Text style={[styles.description, { color: colors.textSecondary }]}>
              {currentListing.description || 'No description provided.'}
            </Text>
          </View>

          {/* Seller Info */}
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Seller</Text>
            <View style={[styles.sellerCard, { backgroundColor: colors.card }]}>
              <View style={[styles.sellerAvatar, { backgroundColor: colors.border }]}>
                <Ionicons name="person" size={24} color={colors.textSecondary} />
              </View>
              <View style={styles.sellerInfo}>
                <Text style={[styles.sellerName, { color: colors.text }]}>{currentListing.seller?.name || 'Anonymous Seller'}</Text>
                <View style={styles.sellerRating}>
                  <Ionicons name="star" size={14} color="#fbbf24" />
                  <Text style={[styles.ratingText, { color: colors.text }]}>4.5</Text>
                  <Text style={[styles.ratingCount, { color: colors.textSecondary }]}>(12 reviews)</Text>
                </View>
              </View>
            </View>
          </View>

          {/* Reviews Section */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>Reviews</Text>
              <TouchableOpacity onPress={() => setShowReviewModal(true)}>
                <Text style={styles.sectionLink}>Write Review</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.noReviews}>
              <Ionicons name="chatbubble-outline" size={32} color={colors.textSecondary} />
              <Text style={[styles.noReviewsText, { color: colors.textSecondary }]}>No reviews yet</Text>
            </View>
          </View>
        </View>
      </ScrollView>

      {/* Bottom Actions */}
      <View style={[styles.bottomActions, { backgroundColor: colors.card, borderTopColor: colors.border }]}>
        <TouchableOpacity 
          style={[styles.contactButton, { borderColor: colors.border }]} 
          onPress={() => setShowContactModal(true)}
        >
          <Ionicons name="chatbubble-outline" size={20} color="#6366f1" />
          <Text style={styles.contactButtonText}>Contact Seller</Text>
        </TouchableOpacity>
        
        {currentListing.price && currentListing.price > 0 && (
          <TouchableOpacity style={styles.buyButton}>
            <Ionicons name="cart-outline" size={20} color="#ffffff" />
            <Text style={styles.buyButtonText}>Buy Now</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Contact Modal */}
      <Modal visible={showContactModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.card }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>Contact Seller</Text>
              <TouchableOpacity onPress={() => setShowContactModal(false)}>
                <Ionicons name="close" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>
            
            <View style={[styles.inquiryPreview, { backgroundColor: colors.background }]}>
              <Text style={[styles.inquiryLabel, { color: colors.textSecondary }]}>Inquiring about:</Text>
              <Text style={[styles.inquiryTitle, { color: colors.text }]}>{currentListing.title}</Text>
              <Text style={styles.inquiryPrice}>{formatPrice(currentListing.price)}</Text>
            </View>

            <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>Your Message</Text>
            <TextInput
              style={[styles.messageInput, { backgroundColor: colors.background, color: colors.text, borderColor: colors.border }]}
              placeholder="Hi, I'm interested in this item..."
              placeholderTextColor={colors.textSecondary}
              value={contactMessage}
              onChangeText={setContactMessage}
              multiline
              numberOfLines={4}
              textAlignVertical="top"
            />

            <View style={styles.modalActions}>
              <TouchableOpacity 
                style={[styles.cancelButton, { borderColor: colors.border }]} 
                onPress={() => setShowContactModal(false)}
              >
                <Text style={[styles.cancelButtonText, { color: colors.text }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={[styles.sendButton, !contactMessage.trim() && styles.sendButtonDisabled]}
                onPress={handleContactSeller}
                disabled={!contactMessage.trim() || sending}
              >
                {sending ? (
                  <ActivityIndicator size="small" color="#ffffff" />
                ) : (
                  <>
                    <Ionicons name="send" size={18} color="#ffffff" />
                    <Text style={styles.sendButtonText}>Send</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Review Modal */}
      <Modal visible={showReviewModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.card }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>Write a Review</Text>
              <TouchableOpacity onPress={() => setShowReviewModal(false)}>
                <Ionicons name="close" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>

            <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>Rating</Text>
            <View style={styles.ratingInput}>
              {[1, 2, 3, 4, 5].map(num => (
                <TouchableOpacity key={num} onPress={() => setReviewRating(num)}>
                  <Ionicons
                    name={num <= reviewRating ? 'star' : 'star-outline'}
                    size={32}
                    color={num <= reviewRating ? '#fbbf24' : colors.textSecondary}
                  />
                </TouchableOpacity>
              ))}
            </View>

            <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>Comment</Text>
            <TextInput
              style={[styles.messageInput, { backgroundColor: colors.background, color: colors.text, borderColor: colors.border }]}
              placeholder="Share your experience..."
              placeholderTextColor={colors.textSecondary}
              value={reviewComment}
              onChangeText={setReviewComment}
              multiline
              numberOfLines={4}
              textAlignVertical="top"
            />

            <View style={styles.modalActions}>
              <TouchableOpacity style={[styles.cancelButton, { borderColor: colors.border }]} onPress={() => setShowReviewModal(false)}>
                <Text style={[styles.cancelButtonText, { color: colors.text }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.sendButton} onPress={handleSubmitReview}>
                <Text style={styles.sendButtonText}>Submit</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Report Modal */}
      <Modal visible={showReportModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.card }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>Report Listing</Text>
              <TouchableOpacity onPress={() => setShowReportModal(false)}>
                <Ionicons name="close" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>

            <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>Reason</Text>
            <View style={styles.reportOptions}>
              {['Spam', 'Inappropriate', 'Scam', 'Wrong Category', 'Other'].map(reason => (
                <TouchableOpacity
                  key={reason}
                  style={[styles.reportOption, { backgroundColor: colors.background }, reportReason === reason && styles.reportOptionActive]}
                  onPress={() => setReportReason(reason)}
                >
                  <Text style={[styles.reportOptionText, { color: colors.textSecondary }, reportReason === reason && styles.reportOptionTextActive]}>
                    {reason}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>Additional Details (optional)</Text>
            <TextInput
              style={[styles.messageInput, { backgroundColor: colors.background, color: colors.text, borderColor: colors.border }]}
              placeholder="Provide more context..."
              placeholderTextColor={colors.textSecondary}
              value={reportDetails}
              onChangeText={setReportDetails}
              multiline
              numberOfLines={3}
              textAlignVertical="top"
            />

            <View style={styles.modalActions}>
              <TouchableOpacity style={[styles.cancelButton, { borderColor: colors.border }]} onPress={() => setShowReportModal(false)}>
                <Text style={[styles.cancelButtonText, { color: colors.text }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.sendButton, styles.reportButton]} onPress={handleSubmitReport}>
                <Text style={styles.sendButtonText}>Report</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f172a',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
    color: '#9ca3af',
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  errorTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#ffffff',
    marginTop: 16,
    marginBottom: 8,
  },
  errorSubtitle: {
    fontSize: 14,
    color: '#9ca3af',
    marginBottom: 24,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#6366f1',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 12,
    gap: 8,
  },
  backButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#ffffff',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    position: 'absolute',
    top: 50,
    left: 0,
    right: 0,
    zIndex: 10,
  },
  headerButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(15, 23, 42, 0.8)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerActions: {
    flexDirection: 'row',
    gap: 8,
  },
  content: {
    flex: 1,
  },
  imageCarousel: {
    height: 300,
    backgroundColor: '#1e293b',
  },
  carouselImage: {
    width,
    height: 300,
    resizeMode: 'cover',
  },
  placeholderImage: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  placeholderText: {
    marginTop: 8,
    fontSize: 14,
    color: '#6b7280',
  },
  imageDots: {
    position: 'absolute',
    bottom: 16,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
  },
  imageDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.4)',
  },
  imageDotActive: {
    backgroundColor: '#ffffff',
  },
  infoContainer: {
    padding: 20,
  },
  categoryBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: '#6366f120',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    marginBottom: 12,
    gap: 6,
  },
  categoryText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#6366f1',
  },
  listingTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#ffffff',
    marginBottom: 8,
  },
  listingPrice: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#6366f1',
    marginBottom: 16,
  },
  metaContainer: {
    backgroundColor: '#1e293b',
    borderRadius: 12,
    padding: 16,
    marginBottom: 24,
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  metaText: {
    fontSize: 14,
    color: '#9ca3af',
  },
  section: {
    marginBottom: 24,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#ffffff',
    marginBottom: 12,
  },
  sectionLink: {
    fontSize: 14,
    color: '#6366f1',
    fontWeight: '600',
  },
  description: {
    fontSize: 15,
    color: '#d1d5db',
    lineHeight: 24,
  },
  sellerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1e293b',
    borderRadius: 12,
    padding: 16,
  },
  sellerAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#334155',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  sellerInfo: {
    flex: 1,
  },
  sellerName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#ffffff',
    marginBottom: 4,
  },
  sellerRating: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  ratingText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#ffffff',
  },
  ratingCount: {
    fontSize: 12,
    color: '#9ca3af',
  },
  noReviews: {
    alignItems: 'center',
    paddingVertical: 24,
    backgroundColor: '#1e293b',
    borderRadius: 12,
  },
  noReviewsText: {
    marginTop: 8,
    fontSize: 14,
    color: '#6b7280',
  },
  bottomActions: {
    flexDirection: 'row',
    padding: 16,
    paddingBottom: 32,
    backgroundColor: '#1e293b',
    borderTopWidth: 1,
    borderTopColor: '#334155',
    gap: 12,
  },
  contactButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#6366f1',
    gap: 8,
  },
  contactButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#6366f1',
  },
  buyButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#6366f1',
    paddingVertical: 14,
    borderRadius: 12,
    gap: 8,
  },
  buyButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#ffffff',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#1e293b',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    paddingBottom: 40,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#ffffff',
  },
  inquiryPreview: {
    backgroundColor: '#334155',
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
  },
  inquiryLabel: {
    fontSize: 12,
    color: '#9ca3af',
    marginBottom: 4,
  },
  inquiryTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#ffffff',
  },
  inquiryPrice: {
    fontSize: 14,
    color: '#6366f1',
    fontWeight: '600',
    marginTop: 4,
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#ffffff',
    marginBottom: 8,
  },
  messageInput: {
    backgroundColor: '#0f172a',
    borderRadius: 12,
    padding: 16,
    fontSize: 15,
    color: '#ffffff',
    minHeight: 100,
    marginBottom: 20,
  },
  ratingInput: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 20,
  },
  reportOptions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 16,
  },
  reportOption: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: '#0f172a',
    borderWidth: 1,
    borderColor: '#334155',
  },
  reportOptionActive: {
    backgroundColor: '#6366f120',
    borderColor: '#6366f1',
  },
  reportOptionText: {
    fontSize: 14,
    color: '#9ca3af',
  },
  reportOptionTextActive: {
    color: '#6366f1',
    fontWeight: '600',
  },
  modalActions: {
    flexDirection: 'row',
    gap: 12,
  },
  cancelButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#334155',
    alignItems: 'center',
  },
  cancelButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#9ca3af',
  },
  sendButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#6366f1',
    paddingVertical: 14,
    borderRadius: 12,
    gap: 8,
  },
  sendButtonDisabled: {
    backgroundColor: '#334155',
  },
  sendButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#ffffff',
  },
  reportButton: {
    backgroundColor: '#ef4444',
  },
});
