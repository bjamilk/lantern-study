// ===========================================
// Lantern Study Mobile - Inquiries Screen
// ===========================================

import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  Image,
  TextInput,
  Alert,
  Modal,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useMarketplaceStore, type MarketplaceInquiry } from '../../stores/marketplaceStore';
import { useTheme } from '../../theme';

export default function InquiriesScreen() {
  const navigation = useNavigation<any>();
  const [refreshing, setRefreshing] = useState(false);
  const [showReplyModal, setShowReplyModal] = useState(false);
  const [selectedInquiry, setSelectedInquiry] = useState<MarketplaceInquiry | null>(null);
  const [replyMessage, setReplyMessage] = useState('');
  const { colors } = useTheme();

  const { inquiries, isLoading, fetchInquiries } = useMarketplaceStore();

  useEffect(() => {
    fetchInquiries('demo-user');
  }, []);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchInquiries('demo-user');
    setRefreshing(false);
  }, [fetchInquiries]);

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffHours = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60));
    
    if (diffHours < 1) return 'Just now';
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffHours < 48) return 'Yesterday';
    return date.toLocaleDateString('en-NG', { month: 'short', day: 'numeric' });
  };

  const formatPrice = (price?: number) => {
    if (!price) return 'Free';
    return `₦${price.toLocaleString()}`;
  };

  const handleOpenReply = useCallback((inquiry: MarketplaceInquiry) => {
    setSelectedInquiry(inquiry);
    setReplyMessage('');
    setShowReplyModal(true);
  }, []);

  const handleSendReply = useCallback(() => {
    if (!replyMessage.trim()) {
      Alert.alert('Error', 'Please enter a message.');
      return;
    }

    // Would send reply in real app
    setShowReplyModal(false);
    setSelectedInquiry(null);
    setReplyMessage('');
    Alert.alert('Success', 'Your reply has been sent!');
  }, [replyMessage]);

  const handleViewListing = useCallback((listingId: string) => {
    navigation.navigate('Marketplace', {
      screen: 'ListingDetail',
      params: { listingId },
    });
  }, [navigation]);

  const renderInquiryItem = useCallback(({ item }: { item: MarketplaceInquiry }) => (
    <View style={[styles.inquiryCard, { backgroundColor: colors.card }]}>
      {/* Sender Info */}
      <View style={styles.senderRow}>
        <View style={[styles.senderAvatar, { backgroundColor: colors.border }]}>
          <Ionicons name="person" size={20} color={colors.textSecondary} />
        </View>
        <View style={styles.senderInfo}>
          <Text style={[styles.senderName, { color: colors.text }]}>{item.sender?.name || 'Unknown'}</Text>
          <Text style={[styles.inquiryTime, { color: colors.textSecondary }]}>{formatDate(item.created_at)}</Text>
        </View>
      </View>

      {/* Message */}
      <Text style={[styles.inquiryMessage, { color: colors.text }]}>{item.message}</Text>

      {/* Listing Preview */}
      {item.listing && (
        <TouchableOpacity 
          style={[styles.listingPreview, { backgroundColor: colors.background }]}
          onPress={() => handleViewListing(item.listing_id)}
        >
          <View style={[styles.listingImageContainer, { backgroundColor: colors.border }]}>
            {item.listing.images && item.listing.images.length > 0 ? (
              <Image source={{ uri: item.listing.images[0] }} style={styles.listingImage} />
            ) : (
              <View style={styles.placeholderImage}>
                <Ionicons name="image-outline" size={20} color={colors.textSecondary} />
              </View>
            )}
          </View>
          <View style={styles.listingInfo}>
            <Text style={[styles.listingTitle, { color: colors.text }]} numberOfLines={1}>{item.listing.title}</Text>
            <Text style={styles.listingPrice}>{formatPrice(item.listing.price)}</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
        </TouchableOpacity>
      )}

      {/* Actions */}
      <View style={[styles.actionsRow, { borderTopColor: colors.border }]}>
        <TouchableOpacity 
          style={styles.replyButton}
          onPress={() => handleOpenReply(item)}
        >
          <Ionicons name="arrow-undo" size={18} color="#6366f1" />
          <Text style={styles.replyButtonText}>Reply</Text>
        </TouchableOpacity>
      </View>
    </View>
  ), [handleViewListing, handleOpenReply, colors]);

  const ListEmptyComponent = () => (
    <View style={styles.emptyContainer}>
      <View style={[styles.emptyIcon, { backgroundColor: colors.card }]}>
        <Ionicons name="chatbubbles-outline" size={64} color="#6366f1" />
      </View>
      <Text style={[styles.emptyTitle, { color: colors.text }]}>No inquiries yet</Text>
      <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
        When buyers contact you about your listings, their messages will appear here.
      </Text>
    </View>
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      {/* Header */}
      <View style={[styles.header, { backgroundColor: colors.card }]}>
        <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Inquiries</Text>
        <View style={{ width: 40 }} />
      </View>

      {/* Info Banner */}
      <View style={[styles.infoBanner, { backgroundColor: colors.card }]}>
        <Ionicons name="information-circle" size={20} color="#6366f1" />
        <Text style={[styles.infoBannerText, { color: colors.textSecondary }]}>
          Respond promptly to build trust with potential buyers
        </Text>
      </View>

      {/* Inquiries List */}
      <FlatList
        data={inquiries}
        keyExtractor={(item) => item.id}
        renderItem={renderInquiryItem}
        ListEmptyComponent={!isLoading ? ListEmptyComponent : null}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="#6366f1"
            colors={['#6366f1']}
          />
        }
      />

      {isLoading && inquiries.length === 0 && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color="#6366f1" />
        </View>
      )}

      {/* Reply Modal */}
      <Modal visible={showReplyModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.card }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>Reply to {selectedInquiry?.sender?.name}</Text>
              <TouchableOpacity onPress={() => setShowReplyModal(false)}>
                <Ionicons name="close" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>

            {selectedInquiry && (
              <View style={[styles.originalMessage, { backgroundColor: colors.background }]}>
                <Text style={[styles.originalMessageLabel, { color: colors.textSecondary }]}>Original message:</Text>
                <Text style={[styles.originalMessageText, { color: colors.text }]}>{selectedInquiry.message}</Text>
              </View>
            )}

            <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>Your Reply</Text>
            <TextInput
              style={[styles.replyInput, { backgroundColor: colors.background, color: colors.text, borderColor: colors.border }]}
              placeholder="Type your response..."
              placeholderTextColor={colors.textSecondary}
              value={replyMessage}
              onChangeText={setReplyMessage}
              multiline
              numberOfLines={4}
              textAlignVertical="top"
            />

            <View style={styles.modalActions}>
              <TouchableOpacity 
                style={[styles.cancelButton, { borderColor: colors.border }]}
                onPress={() => setShowReplyModal(false)}
              >
                <Text style={[styles.cancelButtonText, { color: colors.text }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={[styles.sendButton, !replyMessage.trim() && styles.sendButtonDisabled]}
                onPress={handleSendReply}
                disabled={!replyMessage.trim()}
              >
                <Ionicons name="send" size={18} color="#ffffff" />
                <Text style={styles.sendButtonText}>Send Reply</Text>
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
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1e293b',
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#1e293b',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#ffffff',
  },
  infoBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#6366f120',
    marginHorizontal: 16,
    marginTop: 16,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
    gap: 12,
  },
  infoBannerText: {
    flex: 1,
    fontSize: 13,
    color: '#6366f1',
  },
  listContent: {
    padding: 16,
    paddingBottom: 100,
  },
  inquiryCard: {
    backgroundColor: '#1e293b',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
  },
  senderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  senderAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#334155',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  senderInfo: {
    flex: 1,
  },
  senderName: {
    fontSize: 15,
    fontWeight: '600',
    color: '#ffffff',
  },
  inquiryTime: {
    fontSize: 12,
    color: '#6b7280',
    marginTop: 2,
  },
  inquiryMessage: {
    fontSize: 14,
    color: '#d1d5db',
    lineHeight: 20,
    marginBottom: 16,
  },
  listingPreview: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0f172a',
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
  },
  listingImageContainer: {
    width: 48,
    height: 48,
    borderRadius: 8,
    overflow: 'hidden',
    marginRight: 12,
  },
  listingImage: {
    width: '100%',
    height: '100%',
  },
  placeholderImage: {
    width: '100%',
    height: '100%',
    backgroundColor: '#334155',
    justifyContent: 'center',
    alignItems: 'center',
  },
  listingInfo: {
    flex: 1,
  },
  listingTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#ffffff',
    marginBottom: 4,
  },
  listingPrice: {
    fontSize: 13,
    color: '#6366f1',
    fontWeight: '600',
  },
  actionsRow: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: '#334155',
    paddingTop: 12,
  },
  replyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#6366f120',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    gap: 6,
  },
  replyButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#6366f1',
  },
  emptyContainer: {
    alignItems: 'center',
    paddingTop: 60,
    paddingHorizontal: 40,
  },
  emptyIcon: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: '#6366f120',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#ffffff',
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 14,
    color: '#9ca3af',
    textAlign: 'center',
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15, 23, 42, 0.8)',
    justifyContent: 'center',
    alignItems: 'center',
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
    marginBottom: 20,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#ffffff',
  },
  originalMessage: {
    backgroundColor: '#0f172a',
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
  },
  originalMessageLabel: {
    fontSize: 12,
    color: '#6b7280',
    marginBottom: 8,
  },
  originalMessageText: {
    fontSize: 14,
    color: '#d1d5db',
    lineHeight: 20,
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#ffffff',
    marginBottom: 8,
  },
  replyInput: {
    backgroundColor: '#0f172a',
    borderRadius: 12,
    padding: 16,
    fontSize: 15,
    color: '#ffffff',
    minHeight: 100,
    marginBottom: 20,
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
});
