import { body, param, query, validationResult } from 'express-validator';
import { Request, Response, NextFunction } from 'express';
import { BOARD_POST_SUBJECT_MAX } from '@lantern/shared/network';

// Middleware to handle validation errors
export const handleValidationErrors = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({
      error: 'Validation Error',
      message: 'Invalid request data',
      details: errors.array(),
    });
    return;
  }
  next();
};

export const validateAccountPasswordBody = [
  body('password').isString().isLength({ min: 8, max: 128 }).withMessage('Password is required'),
];

export const validateAccountImportBody = [
  body('export').isObject().withMessage('Backup export payload is required'),
  body('password').isString().isLength({ min: 8, max: 128 }).withMessage('Password is required'),
  body('confirmEmailMismatch').optional().isBoolean(),
];

// User validation rules
export const validateUserId = [
  param('userId').isUUID().withMessage('User ID must be a valid UUID'),
];

export const validateCreateUser = [
  body('name').trim().isLength({ min: 1, max: 100 }).withMessage('Name must be 1-100 characters'),
  body('email').optional().isEmail().normalizeEmail().withMessage('Invalid email format'),
  body('phoneNumber').optional().isMobilePhone('any').withMessage('Invalid phone number'),
  body('phone').optional().isString().withMessage('Invalid phone'),
  body('avatarUrl').optional().isURL().withMessage('Invalid avatar URL'),
  body('username').optional().isLength({ min: 3, max: 20 }).withMessage('Username must be 3-20 characters'),
  body('first_name').optional().isString().withMessage('Invalid first name'),
  body('last_name').optional().isString().withMessage('Invalid last name'),
  body('firstName').optional().isString().withMessage('Invalid first name'),
  body('lastName').optional().isString().withMessage('Invalid last name'),
];

export const validateUpdateUser = [
  body('name').optional().trim().isLength({ min: 1, max: 100 }).withMessage('Name must be 1-100 characters'),
  body('phoneNumber').optional().isMobilePhone('any').withMessage('Invalid phone number'),
  body('phone').optional().isString().withMessage('Invalid phone'),
  body('avatarUrl').optional().isString().withMessage('Invalid avatar URL'),
  body('avatar_url').optional().isString().withMessage('Invalid avatar URL'),
  body('points').optional().isInt({ min: 0 }).withMessage('Points must be a non-negative integer'),
  body('stats').optional().isObject().withMessage('Stats must be an object'),
  body('badges').optional().isArray().withMessage('Badges must be an array'),
  // settings updates must use PUT /users/settings (merge + CAS); rejected in route.
  body('settings').optional().isObject().withMessage('Settings must be an object'),
  body('test_presets').optional().isArray().withMessage('Test presets must be an array'),
  // Academic identity (profiles.institution_id & friends). null clears.
  body('institutionId').optional({ values: 'null' }).isUUID().withMessage('institutionId must be a valid UUID'),
  body('faculty').optional({ values: 'null' }).isString().trim().isLength({ max: 200 }).withMessage('Faculty must be at most 200 characters'),
  body('programme').optional({ values: 'null' }).isString().trim().isLength({ max: 200 }).withMessage('Programme must be at most 200 characters'),
  body('studyLevel')
    .optional({ values: 'null' })
    .isInt({ min: 100, max: 900 })
    .custom((value) => Number(value) % 100 === 0)
    .withMessage('studyLevel must be one of 100, 200, … 900'),
  body('entryYear').optional({ values: 'null' }).isInt({ min: 1990, max: 2100 }).withMessage('entryYear must be 1990-2100'),
  body('expectedGraduationYear')
    .optional({ values: 'null' })
    .isInt({ min: 1990, max: 2100 })
    .withMessage('expectedGraduationYear must be 1990-2100'),
];

/** Shared rule: nullable course reference on artefact create/update bodies. */
export const courseIdBodyRule = () =>
  body('courseId').optional({ values: 'null' }).isUUID().withMessage('courseId must be a valid UUID');

/**
 * Shared rule: nullable topic reference, one level under the course. Whether
 * the topic actually belongs to that course is settled by
 * CourseTopicsService.resolveForArtefact — this only fails a malformed id fast,
 * with the same message shape as courseId. Not applied to groups: `groups` has
 * no topic_id column, so accepting one there would advertise a field that can
 * never be stored.
 */
export const topicIdBodyRule = () =>
  body('topicId').optional({ values: 'null' }).isUUID().withMessage('topicId must be a valid UUID');

// Group validation rules
export const validateGroupId = [
  param('groupId').isUUID().withMessage('Group ID must be a valid UUID'),
];

export const validateCreateGroup = [
  body('name').trim().isLength({ min: 1, max: 100 }).withMessage('Group name must be 1-100 characters'),
  body('description').optional().trim().isLength({ max: 500 }).withMessage('Description must be max 500 characters'),
  body('avatarUrl').optional().isString().withMessage('Invalid avatar URL'),
  body('permissions').optional().isObject().withMessage('Permissions must be an object'),
  body('memberIds').optional().isArray().withMessage('Member IDs must be an array'),
  body('memberIds.*').optional().isUUID().withMessage('Each member ID must be a valid UUID'),
  courseIdBodyRule(),
  body('visibility')
    .optional()
    .isIn(['private', 'community', 'public'])
    .withMessage('visibility must be private, community or public'),
  body('communityId').optional({ nullable: true }).isUUID().withMessage('Invalid communityId'),
  // Which surface a community group renders as. Defaults to 'board'
  // server-side when communityId is set; ignored otherwise.
  body('communitySurface')
    .optional({ nullable: true })
    .isIn(['board', 'study_group'])
    .withMessage('communitySurface must be board or study_group'),
];

export const validateUpdateGroup = [
  body('name').optional().trim().isLength({ min: 1, max: 100 }).withMessage('Group name must be 1-100 characters'),
  body('description').optional().trim().isLength({ max: 500 }).withMessage('Description must be max 500 characters'),
  body('avatarUrl').optional().isURL().withMessage('Invalid avatar URL'),
  body('isArchived').optional().isBoolean().withMessage('isArchived must be a boolean'),
  // Phase 3 L: without a way to SET this, groups stay 'private' forever and
  // Discover's Groups tab can never match anything.
  body('visibility')
    .optional()
    .isIn(['private', 'community', 'public'])
    .withMessage('visibility must be private, community or public'),
  body('communityId').optional({ nullable: true }).isUUID().withMessage('Invalid communityId'),
  body('tags').optional().isArray({ max: 10 }).withMessage('tags must be an array of at most 10'),
  body('tags.*').optional().trim().isLength({ min: 1, max: 30 }).withMessage('Each tag must be 1-30 characters'),
  courseIdBodyRule(),
];

// Message validation rules
export const validateSendMessage = [
  param('groupId').isUUID().withMessage('Group ID must be a valid UUID'),
  // Question payloads are JSON-encoded in `content` (stem + options + explanation).
  // Keep aligned with Joi createMessage (50k) so MCQ submissions are not rejected.
  body('content').trim().isLength({ min: 1, max: 50000 }).withMessage('Message content must be 1-50000 characters'),
  body('clientMessageId').optional().isUUID().withMessage('clientMessageId must be a valid UUID'),
  body('replyToMessageId').optional().isUUID().withMessage('replyToMessageId must be a valid UUID'),
  body('mentionedUserIds').optional().isArray().withMessage('mentionedUserIds must be an array'),
  body('mentionedUserIds.*').optional().isUUID().withMessage('Each mentioned user ID must be a valid UUID'),
  // A board post's optional title. Rejected here with the same string the
  // client shows (COMMUNITY_BOARD_COPY.subjectTooLong), so the two halves
  // cannot disagree about the limit.
  body('subject')
    .optional({ nullable: true })
    .isString()
    .trim()
    .isLength({ max: BOARD_POST_SUBJECT_MAX })
    .withMessage(`Title must be ${BOARD_POST_SUBJECT_MAX} characters or fewer`),
];

export const validateMessageId = [
  param('messageId').isUUID().withMessage('Message ID must be a valid UUID'),
];

/** PUT /messages/:messageId/pin — one boolean, nothing else. */
export const validatePinMessage = [
  param('messageId').isUUID().withMessage('Message ID must be a valid UUID'),
  body('pinned').isBoolean().withMessage('pinned must be a boolean'),
];

// Notification validation rules
export const validateCreateNotification = [
  body('userId').isUUID().withMessage('User ID must be a valid UUID'),
  body('message').trim().isLength({ min: 1, max: 500 }).withMessage('Message must be 1-500 characters'),
  body('link').optional().isString().withMessage('Link must be a string'),
];

// Test/Study validation rules
export const validateTestConfig = [
  body('numberOfQuestions').optional().isInt({ min: 1, max: 1000 }).withMessage('Number of questions must be 1-1000'),
  body('allowedQuestionTypes').optional().isArray().withMessage('Allowed question types must be an array'),
  body('selectedTags').optional().isArray().withMessage('Selected tags must be an array'),
  body('timerDuration').optional().isInt({ min: 60, max: 36000 }).withMessage('Timer duration must be 60-36000 seconds'),
  body('focusOnNew').optional().isBoolean().withMessage('Focus on new must be a boolean'),
  body('config').optional().isObject().withMessage('Config must be an object'),
  body('questions').optional().isArray().withMessage('Questions must be an array'),
  body('user_answers').optional().isObject().withMessage('User answers must be an object'),
  body('start_time').optional().isString().withMessage('Start time must be a string'),
  body('end_time').optional().isString().withMessage('End time must be a string'),
  body('is_offline').optional().isBoolean().withMessage('Is offline must be a boolean'),
  body('userId').optional().isUUID().withMessage('User ID must be a valid UUID'),
  courseIdBodyRule(),
  topicIdBodyRule(),
  body('config.courseId').optional({ values: 'null' }).isUUID().withMessage('config.courseId must be a valid UUID'),
];

// Pagination validation
export const validatePagination = [
  query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
  query('limit').optional().isInt({ min: 1, max: 1000 }).withMessage('Limit must be 1-1000'),
  query('offset').optional().isInt({ min: 0 }).withMessage('Offset must be a non-negative integer'),
];

// Search validation
export const validateSearch = [
  query('q').optional().trim().isLength({ min: 1, max: 100 }).withMessage('Search query must be 1-100 characters'),
  query('sortBy').optional().isIn([
    'created_at',
    'name',
    'updated_at',
    'price',
    'trending',
    'sale_first',
  ]).withMessage('Invalid sort field'),
  query('sortOrder').optional().isIn(['asc', 'desc']).withMessage('Sort order must be asc or desc'),
];

// API Key validation
export const validateApiKeyCreation = [
  body('name').trim().isLength({ min: 1, max: 50 }).withMessage('API key name must be 1-50 characters'),
  body('permissions').optional().isArray().withMessage('Permissions must be an array'),
  body('permissions.*').optional().isIn(['read', 'write', 'ai']).withMessage('Invalid permission'),
];

// File upload validation (for future use)
export const validateFileUpload = [
  body('file').custom((value, { req }) => {
    if (!req.file) {
      throw new Error('File is required');
    }

    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (!allowedTypes.includes(req.file.mimetype)) {
      throw new Error('Invalid file type. Only JPEG, PNG, GIF, and WebP are allowed.');
    }

    const maxSize = 2 * 1024 * 1024; // 2MB
    if (req.file.size > maxSize) {
      throw new Error('File too large. Maximum size is 2MB.');
    }

    return true;
  }),
];

export const validateChallengeId = [
  param('challengeId').isUUID().withMessage('Challenge ID must be a valid UUID'),
];

export const validateCreateChallenge = [
  body('groupId').isUUID().withMessage('Group ID must be a valid UUID'),
  body('opponentId').isUUID().withMessage('Opponent ID must be a valid UUID'),
  body('config').isObject().withMessage('Config must be an object'),
  body('config.numberOfQuestions').isInt({ min: 1, max: 50 }).withMessage('Number of questions must be 1-50'),
  body('config.allowedQuestionTypes').optional().isArray(),
  body('config.selectedTags').optional().isArray(),
];

export const validateSubmitChallenge = [
  body('answers').isObject().withMessage('Answers must be an object'),
];

// Shared primitives
export const validateUuidParam = (name: string) => [
  param(name).isUUID().withMessage(`${name} must be a valid UUID`),
];

export const validateListingId = validateUuidParam('id');
export const validateNoteId = validateUuidParam('noteId');
export const validateFolderId = validateUuidParam('folderId');
export const validateKeyId = validateUuidParam('keyId');
export const validateDeckId = validateUuidParam('deckId');

export const validateUserStatsUpsert = [
  body('userId').isUUID().withMessage('userId must be a valid UUID'),
  body('questionId').isUUID().withMessage('questionId must be a valid UUID'),
  body('correctAttempts').optional().isInt({ min: 0 }).withMessage('correctAttempts must be non-negative'),
  body('incorrectAttempts').optional().isInt({ min: 0 }).withMessage('incorrectAttempts must be non-negative'),
  body('lastAttempted').optional().isISO8601().withMessage('lastAttempted must be a valid ISO date'),
];

export const validateNoteCreate = [
  body('title').optional().trim().isLength({ max: 500 }).withMessage('Title must be at most 500 characters'),
  body('body').optional().isString().isLength({ max: 500000 }).withMessage('Body is too large'),
  body('folderId').optional().isUUID().withMessage('folderId must be a valid UUID'),
  body('groupId').optional().isUUID().withMessage('groupId must be a valid UUID'),
  body('sourceType').optional().isIn(['typed', 'youtube', 'pdf', 'audio', 'import', 'presentation', 'photos']).withMessage('Invalid sourceType'),
  courseIdBodyRule(),
  topicIdBodyRule(),
];

export const validateNoteUpdate = [
  body('title').optional().trim().isLength({ max: 500 }).withMessage('Title must be at most 500 characters'),
  body('body').optional().isString().isLength({ max: 500000 }).withMessage('Body is too large'),
  body('summary').optional().isString().isLength({ max: 10000 }).withMessage('Summary is too large'),
  // null clears folder (unfiled / All notes)
  body('folderId')
    .optional({ values: 'null' })
    .isUUID()
    .withMessage('folderId must be a valid UUID'),
  body('isArchived').optional().isBoolean().withMessage('isArchived must be a boolean'),
  body('isPinned').optional().isBoolean().withMessage('isPinned must be a boolean'),
  courseIdBodyRule(),
  topicIdBodyRule(),
];

// No topicIdBodyRule here: a folder is not a filed artefact. Notes, decks and
// test sessions carry the topic; nothing reads note_folders.topic_id and no
// folder UI on either client can send one, so accepting it would advertise a
// field that stays null forever.
export const validateFolderCreate = [
  body('name').trim().isLength({ min: 1, max: 200 }).withMessage('Folder name must be 1-200 characters'),
  body('color').optional().isString().isLength({ max: 32 }),
  body('groupId').optional().isUUID(),
  body('parentId').optional().isUUID(),
  courseIdBodyRule(),
];

// PATCH reuses the create shape but every field is optional (a "move to course"
// edit sends only courseId), so name must not be required here.
export const validateFolderUpdate = [
  body('name').optional().trim().isLength({ min: 1, max: 200 }).withMessage('Folder name must be 1-200 characters'),
  body('color').optional().isString().isLength({ max: 32 }),
  body('parentId').optional().isUUID(),
  courseIdBodyRule(),
];

export const validateAdminUserStatus = [
  param('id').isUUID().withMessage('User ID must be a valid UUID'),
  body('status').isIn(['active', 'banned', 'suspended']).withMessage('Invalid status'),
  body('reason').optional().trim().isLength({ max: 500 }),
];

export const validateAdminUserRole = [
  param('id').isUUID().withMessage('User ID must be a valid UUID'),
  body('isPlatformAdmin').isBoolean().withMessage('isPlatformAdmin must be a boolean'),
];

export const validateAdminPointsAdjust = [
  param('id').isUUID().withMessage('User ID must be a valid UUID'),
  body('delta').isInt().withMessage('delta must be an integer'),
  body('reason').optional().trim().isLength({ max: 500 }),
];

export const validateAdminNotification = [
  body('message').trim().isLength({ min: 1, max: 500 }).withMessage('Message must be 1-500 characters'),
  body('userId').optional().isUUID(),
  body('link').optional().isString().isLength({ max: 500 }),
];

// The bulk textarea splits free text on whitespace/commas, so malformed ids
// used to reach Postgres as FK violations and surface as generic 500s.
export const validateAdminBulkNotification = [
  body('message').trim().isLength({ min: 1, max: 500 }).withMessage('Message must be 1-500 characters'),
  body('userIds').isArray({ min: 1, max: 100 }).withMessage('userIds must contain 1-100 entries'),
  body('userIds.*').isUUID().withMessage('Every userId must be a valid UUID'),
  body('link').optional().isString().isLength({ max: 500 }),
];

export const validateMarketplaceListingWrite = [
  body('title').trim().isLength({ min: 1, max: 200 }).withMessage('Title must be 1-200 characters'),
  // Categories include marketplace subcategories (e.g. textbook_exchange) and
  // user-defined "custom:<name>" values, so validate shape rather than an enum.
  body('category')
    .isString()
    .trim()
    .isLength({ min: 1, max: 100 })
    .withMessage('Category must be 1-100 characters'),
  body('price')
    .optional({ values: 'null' })
    .isFloat({ min: 0, max: 10000000 })
    .withMessage('Price must be between 0 and 10,000,000'),
  body('sale_price')
    .optional({ values: 'null' })
    .isFloat({ min: 0, max: 10000000 })
    .withMessage('Sale price must be between 0 and 10,000,000'),
  body('quantity')
    .optional({ values: 'null' })
    .isInt({ min: 0, max: 1000000 })
    .withMessage('Quantity must be between 0 and 1,000,000'),
  body('campus_id')
    .optional()
    .isUUID()
    .withMessage('campus_id must be a valid campus identifier'),
  body('campusId')
    .optional()
    .isUUID()
    .withMessage('campusId must be a valid campus identifier'),
  body('description').optional().isString().isLength({ max: 10000 }),
  body('location').optional().isString().isLength({ max: 200 }),
  body('promo_label').optional({ values: 'null' }).isString().isLength({ max: 100 }),
  courseIdBodyRule(),
  topicIdBodyRule(),
];

export const validateMarketplaceListingUpdate = [
  body('title').optional().trim().isLength({ min: 1, max: 200 }),
  body('price').optional({ values: 'null' }).isFloat({ min: 0, max: 10000000 }),
  body('description').optional().isString().isLength({ max: 10000 }),
  body('location').optional().isString().isLength({ max: 200 }),
  body('campus_id')
    .optional()
    .isUUID()
    .withMessage('campus_id must be a valid campus identifier'),
  body('campusId')
    .optional()
    .isUUID()
    .withMessage('campusId must be a valid campus identifier'),
  body('status').optional().isIn(['active', 'sold', 'inactive', 'archived', 'draft']),
  courseIdBodyRule(),
  topicIdBodyRule(),
];

export const validateDeckCreate = [
  body('name').trim().isLength({ min: 1, max: 200 }).withMessage('Deck name must be 1-200 characters'),
  body('description').optional().isString().isLength({ max: 2000 }),
  courseIdBodyRule(),
  topicIdBodyRule(),
];

export const validateDeckUpdate = [
  body('name').optional().trim().isLength({ min: 1, max: 200 }),
  body('description').optional().isString().isLength({ max: 2000 }),
  courseIdBodyRule(),
  topicIdBodyRule(),
];

export const validateFlashcardCreate = [
  body('deckId').isUUID().withMessage('deckId must be a valid UUID'),
  body('type').optional().isIn(['BASIC', 'CLOZE', 'IMAGE_OCCLUSION']),
  // IMAGE_OCCLUSION / CLOZE send null for unused sides; optional() alone does not skip null.
  body('front').optional({ values: 'null' }).isString().isLength({ max: 10000 }),
  body('back').optional({ values: 'null' }).isString().isLength({ max: 10000 }),
  body('clozeText').optional({ values: 'null' }).isString().isLength({ max: 10000 }),
  body('imageUrl').optional({ values: 'null' }).isString().isLength({ max: 5000 }),
  body('occlusionData').optional({ values: 'null' }).isObject(),
  body('tags').optional().isArray(),
  body().custom((value) => {
    const type = value?.type || 'BASIC';
    if (type === 'BASIC') {
      if (typeof value?.front !== 'string' || !value.front.trim()) {
        throw new Error('front is required for basic cards');
      }
      if (typeof value?.back !== 'string' || !value.back.trim()) {
        throw new Error('back is required for basic cards');
      }
    } else if (type === 'CLOZE') {
      if (typeof value?.clozeText !== 'string' || !value.clozeText.trim()) {
        throw new Error('clozeText is required for cloze cards');
      }
    } else if (type === 'IMAGE_OCCLUSION') {
      if (typeof value?.imageUrl !== 'string' || !value.imageUrl.trim()) {
        throw new Error('imageUrl is required for image occlusion cards');
      }
      if (typeof value?.front !== 'string' || !value.front.trim()) {
        throw new Error('front prompt is required for image occlusion cards');
      }
    }
    return true;
  }),
];

export const validateFlashcardReview = [
  body('rating').isIn(['again', 'hard', 'good', 'easy']).withMessage('rating must be again, hard, good, or easy'),
  body('responseTime').optional().isInt({ min: 0, max: 300000 }),
  // Offline replay: when the grade was actually given (learning_events.occurred_at).
  body('reviewedAt').optional({ values: 'null' }).isISO8601().withMessage('reviewedAt must be an ISO 8601 timestamp'),
];

export const validateAIMessage = [
  body('message').optional().trim().isLength({ max: 20000 }),
  body('context').optional().isObject(),
  body('notes').optional().custom((value) => {
    if (value === undefined || value === null) return true;
    if (typeof value === 'string') {
      if (value.length > 50000) throw new Error('notes must be at most 50000 characters');
      return true;
    }
    if (Array.isArray(value)) {
      if (value.length > 50) throw new Error('notes array must have at most 50 items');
      if (value.some((entry) => typeof entry !== 'string' || entry.length > 50000)) {
        throw new Error('each notes entry must be a string of at most 50000 characters');
      }
      return true;
    }
    throw new Error('notes must be a string or array of strings');
  }),
];

export const validateAICompanionMessage = [
  body('message').trim().isLength({ min: 1, max: 10000 }).withMessage('message must be 1-10000 characters'),
  body('context').optional().isObject(),
  body('rating').optional().isInt({ min: 1, max: 5 }),
];