// ===========================================
// Lantern Study - API Response Mappers
// ===========================================
// Explicit mappers for converting API responses (snake_case) to app types (camelCase)

import type {
  User,
  Group,
  Message,
  Flashcard,
  Deck,
  MarketplaceListing,
  MarketplaceInquiry,
  MarketplaceFavorite,
  AppNotification,
  Badge,
  UserStats,
  SrsData,
  TestQuestion,
  QuestionOption,
  MatchingItem,
  DiagramLabel,
  Transaction,
  TransactionType,
  Budget,
} from '../types';
import { normalizeStorageUrl } from './storageUrl';

// ============================================
// USER MAPPERS
// ============================================

export const mapUserFromApi = (data: any): User => {
  if (!data) return data;
  
  return {
    id: data.id,
    name: data.name || data.full_name || '',
    avatarUrl: data.avatar_url || data.avatarUrl,
    email: data.email,
    password: data.password,
    phoneNumber: data.phone_number || data.phone,
    points: data.points || 0,
    badges: (data.badges || []).map(mapBadgeFromApi),
    stats: mapUserStatsFromApi(data.stats || {}),
    settings: data.settings,
    testPresets: data.test_presets || data.testPresets,
    decks: data.decks,
    flashcards: data.flashcards,
    username: data.username || undefined,
    firstName: data.first_name || data.firstName || undefined,
    lastName: data.last_name || data.lastName || undefined,
  };
};

export const mapBadgeFromApi = (data: any): Badge => {
  if (!data) return data;
  
  return {
    id: data.id,
    level: data.level || 1,
    name: data.name,
    description: data.description,
    icon: data.icon,
    dateAwarded: data.date_awarded || data.dateAwarded,
  };
};

export const mapUserStatsFromApi = (data: any): UserStats => {
  return {
    testsCompleted: data.tests_completed || data.testsCompleted || 0,
    questionsCreated: data.questions_created || data.questionsCreated || 0,
    groupsCreated: data.groups_created || data.groupsCreated || 0,
    highScoreTests: data.high_score_tests || data.highScoreTests || 0,
    perfectScoreTests: data.perfect_score_tests || data.perfectScoreTests || 0,
    gamesWon: data.games_won || data.gamesWon || 0,
    listingsCreated: data.listings_created || data.listingsCreated || 0,
    listingsSold: data.listings_sold || data.listingsSold || 0,
    fiveStarReviews: data.five_star_reviews || data.fiveStarReviews || 0,
    offersMade: data.offers_made || data.offersMade || 0,
  };
};

// ============================================
// GROUP MAPPERS
// ============================================

export const mapGroupFromApi = (data: any): Group => {
  if (!data) return data;
  
  return {
    id: data.id,
    name: data.name,
    avatarUrl: data.avatar_url || data.avatarUrl,
    members: (data.members || []).map(mapUserFromApi),
    description: data.description,
    lastMessage: data.last_message || data.lastMessage,
    lastMessageTime: data.last_message_time || data.lastMessageTime,
    unreadCount: data.unread_count || data.unreadCount || 0,
    memberEmails: data.member_emails || data.memberEmails,
    adminIds: data.admin_ids || data.adminIds || [],
    moderatorIds: data.moderator_ids || data.moderatorIds,
    parentId: data.parent_id || data.parentId,
    isArchived: data.is_archived || data.isArchived || false,
    inviteId: data.invite_id || data.inviteId,
    pendingMembers: (data.pending_members || data.pendingMembers || []).map(mapUserFromApi),
    permissions: data.permissions,
    invitedPhoneNumbers: data.invited_phone_numbers || data.invitedPhoneNumbers,
  };
};

export const mapGroupsFromApi = (data: any[]): Group[] => {
  return (data || []).map(mapGroupFromApi);
};

// ============================================
// MESSAGE MAPPERS
// ============================================

export const mapMessageFromApi = (data: any): Message => {
  if (!data) return data;

  const senderId = data.sender_id ?? data.senderId;
  const sender = data.sender
    ? mapUserFromApi(data.sender)
    : mapUserFromApi({
        id: senderId || 'unknown',
        name: 'Member',
        username: data.sender?.username,
      });

  const questionData =
    data.question_data && typeof data.question_data === 'object'
      ? data.question_data
      : {};

  const rawOptions = data.options ?? questionData.options;
  const optionsList = Array.isArray(rawOptions) ? rawOptions : [];

  return {
    id: data.id,
    groupId: data.group_id || data.groupId,
    sender,
    timestamp: new Date(data.timestamp || data.created_at),
    type: data.type,
    text: data.text || data.content,
    questionStem: data.question_stem || data.questionStem || questionData.questionStem,
    explanation: data.explanation || questionData.explanation,
    questionType: data.question_type || data.questionType || questionData.questionType,
    options: optionsList.map(mapQuestionOptionFromApi),
    correctAnswerIds: data.correct_answer_ids || data.correctAnswerIds || questionData.correctAnswerIds,
    imageUrl: (() => {
      const raw = data.image_url || data.imageUrl;
      return raw ? normalizeStorageUrl(raw) : undefined;
    })(),
    tags: data.tags || questionData.tags,
    questionStatus: data.question_status || data.questionStatus || questionData.questionStatus,
    upvotes: data.upvotes || 0,
    downvotes: data.downvotes || 0,
    flaggedAsSimilarUserIds: data.flagged_as_similar_user_ids || data.flaggedAsSimilarUserIds,
    isArchived: data.is_archived || data.isArchived || false,
    acceptableAnswers: data.acceptable_answers || data.acceptableAnswers,
    matchingPromptItems: (data.matching_prompt_items || data.matchingPromptItems || []).map(mapMatchingItemFromApi),
    matchingAnswerItems: (data.matching_answer_items || data.matchingAnswerItems || []).map(mapMatchingItemFromApi),
    correctMatches: data.correct_matches || data.correctMatches,
    diagramLabels: (data.diagram_labels || data.diagramLabels || []).map(mapDiagramLabelFromApi),
  };
};

export const mapMessagesFromApi = (data: any[]): Message[] => {
  return (data || []).map(mapMessageFromApi);
};

export const mapQuestionOptionFromApi = (data: any): QuestionOption => {
  return {
    id: data.id,
    text: data.text,
  };
};

export const mapMatchingItemFromApi = (data: any): MatchingItem => {
  return {
    id: data.id,
    text: data.text,
  };
};

export const mapDiagramLabelFromApi = (data: any): DiagramLabel => {
  return {
    id: data.id,
    text: data.text,
    x: data.x,
    y: data.y,
  };
};

// ============================================
// FLASHCARD MAPPERS
// ============================================

export const mapSrsDataFromApi = (data: any): SrsData | undefined => {
  if (!data) return undefined;
  
  return {
    interval: data.interval || 0,
    easeFactor: data.ease_factor || data.easeFactor || 2.5,
    repetitions: data.repetitions || 0,
    nextReviewDate: data.next_review_date || data.nextReviewDate || data.next_review,
    failedAttempts: data.failed_attempts || data.failedAttempts || 0,
    isLeech: data.is_leech || data.isLeech || false,
    scheduler: data.scheduler,
    difficulty: data.difficulty,
    stability: data.stability,
  };
};

export const mapFlashcardFromApi = (data: any): Flashcard => {
  if (!data) return data;
  
  return {
    id: data.id,
    deckId: data.deck_id || data.deckId,
    type: data.type,
    front: data.front,
    back: data.back,
    clozeText: data.cloze_text || data.clozeText,
    imageUrl: (() => {
      const raw = data.image_url || data.imageUrl;
      return raw ? normalizeStorageUrl(raw) : undefined;
    })(),
    occlusionData: data.occlusion_data || data.occlusionData,
    srsData: mapSrsDataFromApi(data.srs_data || data.srsData),
    tags: data.tags,
    createdAt: data.created_at || data.createdAt,
  };
};

export const mapFlashcardsFromApi = (data: any[]): Flashcard[] => {
  return (data || []).map(mapFlashcardFromApi);
};

export const mapDeckFromApi = (data: any): Deck => {
  if (!data) return data;
  
  return {
    id: data.id,
    name: data.name,
    description: data.description,
    createdAt: data.created_at || data.createdAt,
  };
};

export const mapDecksFromApi = (data: any[]): Deck[] => {
  return (data || []).map(mapDeckFromApi);
};

// ============================================
// MARKETPLACE MAPPERS
// ============================================

export const mapListingFromApi = (data: any): MarketplaceListing => {
  if (!data) return data;
  
  return {
    id: data.id,
    user_id: data.user_id,
    seller_id: data.seller_id,
    seller: data.seller ? {
      id: data.seller.id,
      name: data.seller.name,
      avatarUrl: data.seller.avatar_url || data.seller.avatarUrl,
    } : undefined,
    profiles: data.profiles,
    category: data.category,
    title: data.title,
    description: data.description,
    price: data.price,
    location: data.location,
    images: data.images,
    status: data.status,
    categorySpecificFields: data.category_specific_fields || data.categorySpecificFields,
    category_specific_fields: data.category_specific_fields,
    views_count: data.views_count,
    favorites_count: data.favorites_count,
    inquiries_count: data.inquiries_count,
    created_at: data.created_at,
    updated_at: data.updated_at,
    reviews: data.reviews,
  };
};

export const mapListingsFromApi = (data: any[]): MarketplaceListing[] => {
  return (data || []).map(mapListingFromApi);
};

export const mapInquiryFromApi = (data: any): MarketplaceInquiry => {
  if (!data) return data;
  
  return {
    id: data.id,
    listing_id: data.listing_id,
    dm_thread_id: data.dm_thread_id,
    buyer_id: data.buyer_id,
    seller_id: data.seller_id,
    status: data.status,
    initial_message: data.initial_message,
    created_at: data.created_at,
    updated_at: data.updated_at,
    listing: data.listing ? mapListingFromApi(data.listing) : undefined,
    buyer: data.buyer,
    seller: data.seller,
  };
};

export const mapFavoriteFromApi = (data: any): MarketplaceFavorite => {
  if (!data) return data;
  
  return {
    id: data.id,
    user_id: data.user_id,
    listing_id: data.listing_id,
    listing: data.listing ? mapListingFromApi(data.listing) : undefined,
    created_at: data.created_at,
  };
};

// ============================================
// NOTIFICATION MAPPERS
// ============================================

export const mapNotificationFromApi = (data: any): AppNotification => {
  if (!data) return data;
  
  return {
    id: data.id,
    message: data.message,
    date: data.date || data.created_at,
    read: data.read || false,
    link: data.link,
  };
};

export const mapNotificationsFromApi = (data: any[]): AppNotification[] => {
  return (data || []).map(mapNotificationFromApi);
};

// ============================================
// TEST MAPPERS
// ============================================

export const mapTestQuestionFromApi = (data: any): TestQuestion => {
  const message = mapMessageFromApi(data);
  return {
    ...message,
    questionNumber: data.question_number || data.questionNumber || 0,
  };
};

export const mapTestQuestionsFromApi = (data: any[]): TestQuestion[] => {
  return (data || []).map(mapTestQuestionFromApi);
};

// ============================================
// BUDGET MAPPERS
// ============================================

export const mapTransactionFromApi = (data: any): Transaction => {
  if (!data) return data;
  
  return {
    id: data.id,
    userId: data.user_id || data.userId,
    type: (data.type || '').toUpperCase() as TransactionType,
    amount: parseFloat(data.amount) || 0,
    category: data.category,
    description: data.description,
    date: data.date,
  };
};

export const mapTransactionsFromApi = (data: any[]): Transaction[] => {
  return (data || []).map(mapTransactionFromApi);
};

export const mapBudgetFromApi = (data: any): Budget => {
  if (!data) return data;
  
  return {
    userId: data.user_id || data.userId,
    monthYear: data.month_year || data.monthYear || data.month,
    monthlyLimit: parseFloat(data.monthly_limit || data.monthlyLimit || data.targetAmount) || 0,
    categoryBudgets: data.category_budgets || data.categoryBudgets,
  };
};

// ============================================
// TO API MAPPERS (camelCase -> snake_case)
// ============================================

export const mapFlashcardToApi = (flashcard: Partial<Flashcard>): any => {
  return {
    id: flashcard.id,
    deck_id: flashcard.deckId,
    type: flashcard.type,
    front: flashcard.front,
    back: flashcard.back,
    cloze_text: flashcard.clozeText,
    srs_data: flashcard.srsData ? {
      interval: flashcard.srsData.interval,
      ease_factor: flashcard.srsData.easeFactor,
      repetitions: flashcard.srsData.repetitions,
      next_review_date: flashcard.srsData.nextReviewDate,
      failed_attempts: flashcard.srsData.failedAttempts,
      is_leech: flashcard.srsData.isLeech,
      scheduler: flashcard.srsData.scheduler,
      difficulty: flashcard.srsData.difficulty,
      stability: flashcard.srsData.stability,
    } : undefined,
    tags: flashcard.tags,
  };
};

export const mapGroupToApi = (group: Partial<Group>): any => {
  return {
    id: group.id,
    name: group.name,
    avatar_url: group.avatarUrl,
    description: group.description,
    admin_ids: group.adminIds,
    moderator_ids: group.moderatorIds,
    parent_id: group.parentId,
    is_archived: group.isArchived,
    permissions: group.permissions,
  };
};

export const mapTransactionToApi = (transaction: Partial<Transaction>): any => {
  return {
    id: transaction.id,
    user_id: transaction.userId,
    type: (transaction.type || '').toLowerCase(),
    amount: transaction.amount,
    category: transaction.category,
    description: transaction.description,
    date: transaction.date,
  };
};
