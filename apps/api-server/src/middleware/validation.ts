import { body, param, query, validationResult } from 'express-validator';
import { Request, Response, NextFunction } from 'express';

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
  body('settings').optional().isObject().withMessage('Settings must be an object'),
  body('test_presets').optional().isArray().withMessage('Test presets must be an array'),
];

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
];

export const validateUpdateGroup = [
  body('name').optional().trim().isLength({ min: 1, max: 100 }).withMessage('Group name must be 1-100 characters'),
  body('description').optional().trim().isLength({ max: 500 }).withMessage('Description must be max 500 characters'),
  body('avatarUrl').optional().isURL().withMessage('Invalid avatar URL'),
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
];

export const validateMessageId = [
  param('messageId').isUUID().withMessage('Message ID must be a valid UUID'),
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
  query('sortBy').optional().isIn(['created_at', 'name', 'updated_at']).withMessage('Invalid sort field'),
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
];

export const validateNoteUpdate = [
  body('title').optional().trim().isLength({ max: 500 }).withMessage('Title must be at most 500 characters'),
  body('body').optional().isString().isLength({ max: 500000 }).withMessage('Body is too large'),
  body('summary').optional().isString().isLength({ max: 10000 }).withMessage('Summary is too large'),
  body('folderId').optional().isUUID().withMessage('folderId must be a valid UUID'),
];

export const validateFolderCreate = [
  body('name').trim().isLength({ min: 1, max: 200 }).withMessage('Folder name must be 1-200 characters'),
  body('color').optional().isString().isLength({ max: 32 }),
  body('groupId').optional().isUUID(),
  body('parentId').optional().isUUID(),
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
];

export const validateDeckCreate = [
  body('name').trim().isLength({ min: 1, max: 200 }).withMessage('Deck name must be 1-200 characters'),
  body('description').optional().isString().isLength({ max: 2000 }),
];

export const validateDeckUpdate = [
  body('name').optional().trim().isLength({ min: 1, max: 200 }),
  body('description').optional().isString().isLength({ max: 2000 }),
];

export const validateFlashcardCreate = [
  body('deckId').isUUID().withMessage('deckId must be a valid UUID'),
  body('front').trim().isLength({ min: 1, max: 10000 }),
  body('back').optional().isString().isLength({ max: 10000 }),
  body('type').optional().isIn(['BASIC', 'CLOZE', 'IMAGE_OCCLUSION']),
];

export const validateFlashcardReview = [
  body('rating').isIn(['again', 'hard', 'good', 'easy']).withMessage('rating must be again, hard, good, or easy'),
  body('responseTime').optional().isInt({ min: 0, max: 300000 }),
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