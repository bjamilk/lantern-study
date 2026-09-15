// ===========================================
// Lantern Study - API Response Mappers
// ===========================================
// Explicit mappers for converting API responses (snake_case) to app types (camelCase)
//
// PURPOSE
//   Hand-written translators between the API's snake_case rows and the app's
//   camelCase domain types. Most accept BOTH spellings on input, because the
//   same shape arrives from the REST API (snake_case), from a realtime payload,
//   and from an already-mapped local cache.
//
// CONSUMERS
//   web + mobile stores and services. Not the api (it produces these rows).
//
// WHY THESE ARE EXPLICIT AND NOT A GENERIC CONVERTER
//   A generic snake->camel walk silently carries through every column the
//   server adds, including ones that should never reach a client. Naming each
//   field is the point: what is not written here does not cross.
//
// THE FAILURE MODE TO WATCH
//   These mappers are hand-maintained and the server's shapes are not. When a
//   field is added to a type and to the API but NOT to the mapper here, it
//   arrives as `undefined` at runtime while the typechecker stays perfectly
//   happy — the mapper's return is typed as the full domain type regardless of
//   which keys it actually set. A field that "isn't loading" is almost always
//   a missing line in this file.
//
// GOTCHAS
//   - `packages/shared` is consumed BUILT: run `npm run build` in
//     packages/shared before typechecking or running web/mobile, or consumers
//     resolve a stale `dist/`.
//   - A NEW subpath under src/ needs the file, a `packages/shared/package.json`
//     "exports" entry, AND an `apps/api-server/tsconfig.json` "paths" entry.
//     Mobile jest maps `@lantern/shared/*` subpaths separately, so a subpath
//     imported only by a test fails CI-only with TS2307 (`jest --no-cache`).
//   - The web turbo build compiles with strict `noUncheckedIndexedAccess`.

import { normalizeReactions } from '../chat/reactions';
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
import { normalizeSrsData } from './srs';

// ============================================
// USER MAPPERS
// ============================================

/** Normalize profile test presets from camelCase or snake_case API/DB shapes. */
export const normalizeTestPresets = (data: unknown): NonNullable<User['testPresets']> => {
  if (Array.isArray(data)) {
    return data as NonNullable<User['testPresets']>;
  }
  if (!data || typeof data !== 'object') return [];
  const row = data as Record<string, unknown>;
  const presets = row.testPresets ?? row.test_presets;
  return Array.isArray(presets) ? (presets as NonNullable<User['testPresets']>) : [];
};

export const mapUserFromApi = (data: any): User => {
  if (!data) return data;

  // Prefer camelCase from API User shape; fall back to snake_case DB aliases.
  const avatarUrl = data.avatarUrl || data.avatar_url || undefined;
  const phoneNumber = data.phoneNumber || data.phone_number || data.phone || undefined;
  const firstName = data.firstName || data.first_name || undefined;
  const lastName = data.lastName || data.last_name || undefined;

  return {
    id: data.id,
    name: data.name || data.full_name || '',
    avatarUrl,
    email: data.email,
    password: data.password,
    phoneNumber,
    points: data.points || 0,
    badges: (data.badges || []).map(mapBadgeFromApi),
    stats: mapUserStatsFromApi(data.stats || {}),
    settings: data.settings,
    testPresets: normalizeTestPresets(data),
    decks: data.decks,
    flashcards: data.flashcards,
    username: data.username || undefined,
    firstName,
    lastName,
    // Preserve snake_case aliases — login/restore paths still read these.
    // Matches API mapProfileRowToUser dual-shape contract.
    avatar_url: avatarUrl,
    phone: phoneNumber,
    first_name: firstName,
    last_name: lastName,
    // Academic identity (profiles.institution_id & friends). Undefined stays
    // undefined so partial payloads don't clobber a loaded profile.
    institutionId: data.institutionId !== undefined ? data.institutionId : data.institution_id,
    institution: data.institution ?? undefined,
    faculty: data.faculty,
    programme: data.programme,
    studyLevel: data.studyLevel !== undefined ? data.studyLevel : data.study_level,
    currentSemester:
      data.currentSemester !== undefined ? data.currentSemester : data.current_semester,
    entryYear: data.entryYear !== undefined ? data.entryYear : data.entry_year,
    expectedGraduationYear:
      data.expectedGraduationYear !== undefined
        ? data.expectedGraduationYear
        : data.expected_graduation_year,
    lastSeenAt: data.lastSeenAt ?? data.last_seen_at ?? null,
    onlineStatus: data.onlineStatus,
  } as User;
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
    questionUpvotesMax: data.question_upvotes_max || data.questionUpvotesMax || 0,
    listingsCreated: data.listings_created || data.listingsCreated || 0,
    listingsSold: data.listings_sold || data.listingsSold || 0,
    fiveStarReviews: data.five_star_reviews || data.fiveStarReviews || 0,
    offersMade: data.offers_made || data.offersMade || 0,
    campusAmbassador: Number(data.campus_ambassador || data.campusAmbassador || 0),
  };
};

// GROUP MAPPERS — removed (refactor R2). The dead, incomplete
// `mapGroupFromApi` / `mapGroupsFromApi` that lived here (they silently dropped
// `communitySurface`, `tags`, `memberCount` and `questionCount`) are gone. The
// one canonical group row -> `Group` mapping now lives in
// `@lantern/shared/groups` (`mapGroupRow` / `mapGroupRows` /
// `toServerGroupPayload`). Do not add a second one here.

// Messages carry the most variation: text, questions, attachments, reactions
// and reposts, from REST and from realtime. Reactions go through
// ../chat/reactions so the two sources normalise identically.

// ============================================
// MESSAGE MAPPERS
// ============================================

export const mapMessageFromApi = (data: any): Message => {
  if (!data) return data;

  const senderId = data.sender_id ?? data.senderId;
  const rawSender =
    data.sender && typeof data.sender === 'object' && !Array.isArray(data.sender)
      ? data.sender
      : null;
  const senderHasIdentity = !!(
    rawSender &&
    (rawSender.id ||
      rawSender.username ||
      rawSender.name ||
      rawSender.full_name ||
      rawSender.avatar_url ||
      rawSender.avatarUrl)
  );
  // Always prefer auth sender_id so roster lookups and message grouping stay stable
  // even when nested sender payloads omit id.
  const sender = mapUserFromApi(
    senderHasIdentity
      ? { ...rawSender, id: rawSender.id || senderId || 'unknown' }
      : {
          id: senderId || 'unknown',
          name: 'Member',
        }
  );

  const questionData =
    data.question_data && typeof data.question_data === 'object'
      ? data.question_data
      : {};

  const rawOptions = data.options ?? questionData.options;
  const optionsList = Array.isArray(rawOptions) ? rawOptions : [];
  const removedAt = data.removed_at || data.removedAt;
  const isRemoved = data.isRemoved || !!removedAt;

  return {
    id: data.id,
    groupId: data.group_id || data.groupId,
    sender,
    timestamp: new Date(data.timestamp || data.created_at),
    type: data.type,
    text: isRemoved ? undefined : data.text || data.content,
    questionStem: isRemoved
      ? undefined
      : data.question_stem || data.questionStem || questionData.questionStem,
    explanation: data.explanation || questionData.explanation,
    questionType: data.question_type || data.questionType || questionData.questionType,
    options: optionsList.map(mapQuestionOptionFromApi),
    correctAnswerIds:
      data.correct_answer_ids ||
      data.correctAnswerIds ||
      questionData.correctAnswerIds ||
      questionData.correct_answer_ids,
    imageUrl: (() => {
      const raw =
        data.image_url || data.imageUrl || questionData.imageUrl || questionData.image_url;
      return raw ? normalizeStorageUrl(raw) : undefined;
    })(),
    tags: data.tags || questionData.tags,
    questionStatus: data.question_status || data.questionStatus || questionData.questionStatus,
    upvotes: data.upvotes || 0,
    downvotes: data.downvotes || 0,
    // Distinct upvotes from members other than the author — the count that gates
    // VERIFIED. Left undefined (never 0) when the API build does not send it, so
    // the card can tell "no peer votes yet" from "this build has no idea".
    peerUpvotes:
      typeof data.peer_upvotes === 'number'
        ? data.peer_upvotes
        : typeof data.peerUpvotes === 'number'
          ? data.peerUpvotes
          : undefined,
    reactions: normalizeReactions(data.reactions),
    flaggedAsSimilarUserIds: data.flagged_as_similar_user_ids || data.flaggedAsSimilarUserIds,
    isArchived: data.is_archived || data.isArchived || false,
    editedAt: data.edited_at || data.editedAt,
    removedAt,
    isRemoved,
    acceptableAnswers:
      data.acceptable_answers ||
      data.acceptableAnswers ||
      questionData.acceptableAnswers ||
      questionData.acceptable_answers,
    matchingPromptItems: (
      data.matching_prompt_items ||
      data.matchingPromptItems ||
      questionData.matchingPromptItems ||
      questionData.matching_prompt_items ||
      []
    ).map(mapMatchingItemFromApi),
    matchingAnswerItems: (
      data.matching_answer_items ||
      data.matchingAnswerItems ||
      questionData.matchingAnswerItems ||
      questionData.matching_answer_items ||
      []
    ).map(mapMatchingItemFromApi),
    correctMatches:
      data.correct_matches ||
      data.correctMatches ||
      questionData.correctMatches ||
      questionData.correct_matches,
    diagramLabels: (
      data.diagram_labels ||
      data.diagramLabels ||
      questionData.diagramLabels ||
      questionData.diagram_labels ||
      []
    ).map(mapDiagramLabelFromApi),
    replyToMessageId: data.reply_to_message_id || data.replyToMessageId || undefined,
    mentionedUserIds: data.mentioned_user_ids || data.mentionedUserIds || undefined,
    replyTo: data.replyTo || data.reply_to || undefined,
    threadRootId: data.thread_root_id || data.threadRootId || undefined,
    replyCount: typeof data.replyCount === 'number' ? data.replyCount : data.reply_count,
    receiptStatus: data.receiptStatus || data.receipt_status || undefined,
    seenByCount: typeof data.seenByCount === 'number' ? data.seenByCount : data.seen_by_count,
    seenByTotal: typeof data.seenByTotal === 'number' ? data.seenByTotal : data.seen_by_total,
    clientMessageId: data.client_message_id || data.clientMessageId || undefined,
  };
};

export const mapMessagesFromApi = (data: any[]): Message[] => {
  return (data || []).map(mapMessageFromApi);
};

export const mapQuestionOptionFromApi = (data: any): QuestionOption => {
  if (typeof data === 'string') {
    return { id: data, text: data };
  }
  if (!data || typeof data !== 'object') {
    return { id: String(data ?? ''), text: String(data ?? '') };
  }
  const id = data.id ?? data.value ?? data.key;
  const text = data.text ?? data.label ?? data.value ?? String(id ?? '');
  return {
    id: id != null ? String(id) : text,
    text: String(text),
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

// Flashcards and decks. `mapSrsDataFromApi` is the FSRS scheduling state; it
// returns undefined rather than a zeroed object for a never-reviewed card, so
// the scheduler can tell "new" from "reviewed and reset".

// ============================================
// FLASHCARD MAPPERS
// ============================================

export const mapSrsDataFromApi = (data: any): SrsData | undefined => {
  // Prefer shared normalizer so snake_case JSONB and camelCase FSRS stay consistent.
  return normalizeSrsData(data);
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
    authoredDifficulty: data.authored_difficulty ?? data.authoredDifficulty ?? undefined,
    version:
      typeof data.version === 'number'
        ? data.version
        : data.version != null
          ? Number(data.version) || undefined
          : undefined,
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
    courseId: data.courseId !== undefined ? data.courseId : (data.course_id ?? undefined),
    studySetId: data.studySetId !== undefined ? data.studySetId : (data.study_set_id ?? undefined),
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
    courseId: data.courseId !== undefined ? data.courseId : (data.course_id ?? undefined),
    course_id: data.course_id ?? data.courseId ?? undefined,
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
    course_id: group.courseId,
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
