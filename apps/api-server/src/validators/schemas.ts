import Joi from 'joi';

// UUID validation pattern
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const schemas = {
  // ============ USER SCHEMAS ============
  userRegistration: Joi.object({
    email: Joi.string()
      .email()
      .required()
      .max(255)
      .lowercase()
      .trim()
      .messages({
        'string.email': 'Please provide a valid email address',
        'string.max': 'Email must be less than 255 characters',
      }),
    password: Joi.string()
      .min(8)
      .max(128)
      .required()
      .pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
      .messages({
        'string.min': 'Password must be at least 8 characters',
        'string.pattern.base': 'Password must contain uppercase, lowercase, number, and special character',
      }),
    name: Joi.string()
      .min(2)
      .max(100)
      .required()
      .trim(),
  }),

  userLogin: Joi.object({
    email: Joi.string().email().required().lowercase().trim(),
    password: Joi.string().required(),
  }),

  userUpdate: Joi.object({
    name: Joi.string().min(2).max(100).trim().optional(),
    avatar_url: Joi.string().uri().max(500).optional().allow(null, ''),
    bio: Joi.string().max(500).optional().allow(''),
    preferences: Joi.object().optional(),
  }),

  // ============ GROUP SCHEMAS ============
  createGroup: Joi.object({
    name: Joi.string().min(1).max(100).required().trim(),
    description: Joi.string().max(500).optional().allow(''),
    parent_id: Joi.string().pattern(uuidPattern).optional().allow(null),
    is_public: Joi.boolean().default(false),
    color: Joi.string().max(20).optional(),
    icon: Joi.string().max(50).optional(),
    permissions: Joi.object().optional(),
    invite_id: Joi.string().optional(),
  }),

  updateGroup: Joi.object({
    name: Joi.string().min(1).max(100).trim().optional(),
    description: Joi.string().max(500).optional().allow(''),
    parent_id: Joi.string().pattern(uuidPattern).optional().allow(null),
    is_public: Joi.boolean().optional(),
    color: Joi.string().max(20).optional(),
    icon: Joi.string().max(50).optional(),
  }),

  addGroupMember: Joi.object({
    userId: Joi.string().pattern(uuidPattern).required(),
    role: Joi.string().valid('member', 'admin', 'moderator').default('member'),
  }),

  // ============ MESSAGE SCHEMAS ============
  createMessage: Joi.object({
    content: Joi.string().min(1).max(50000).required(),
    type: Joi.string().valid('TEXT', 'QUESTION', 'ANSWER', 'NOTE').default('TEXT'),
    userId: Joi.string().pattern(uuidPattern).required(),
    
    // Question-specific fields
    questionStem: Joi.string().max(10000).optional(),
    questionType: Joi.string().valid(
      'MULTIPLE_CHOICE_SINGLE',
      'MULTIPLE_CHOICE_MULTIPLE', 
      'TRUE_FALSE', 
      'FILL_IN_THE_BLANK', 
      'MATCHING', 
      'DIAGRAM_LABELING',
      'SHORT_ANSWER'
    ).optional(),
    options: Joi.array().items(Joi.object({
      id: Joi.string().required(),
      text: Joi.string().max(1000).required(),
    })).max(10).optional(),
    correctAnswerIds: Joi.array().items(Joi.string()).optional(),
    acceptableAnswers: Joi.array().items(Joi.string().max(500)).optional(),
    explanation: Joi.string().max(10000).optional().allow(''),
    tags: Joi.array().items(Joi.string().max(50)).max(20).optional(),
    imageUrl: Joi.string().uri().max(500).optional().allow(null, ''),
    matchingPromptItems: Joi.array().items(Joi.object()).optional(),
    matchingAnswerItems: Joi.array().items(Joi.object()).optional(),
    correctMatches: Joi.array().items(Joi.object()).optional(),
    diagramLabels: Joi.array().items(Joi.object()).optional(),
  }),

  updateMessage: Joi.object({
    content: Joi.string().min(1).max(50000).optional(),
    questionStem: Joi.string().max(10000).optional(),
    options: Joi.array().items(Joi.object()).max(10).optional(),
    correctAnswerIds: Joi.array().items(Joi.string()).optional(),
    explanation: Joi.string().max(10000).optional(),
    tags: Joi.array().items(Joi.string().max(50)).max(20).optional(),
    questionStatus: Joi.string().valid('PENDING', 'VERIFIED', 'REJECTED').optional(),
  }),

  // ============ FLASHCARD SCHEMAS ============
  createDeck: Joi.object({
    name: Joi.string().min(1).max(100).required().trim(),
    description: Joi.string().max(500).optional().allow(''),
    userId: Joi.string().pattern(uuidPattern).required(),
    groupId: Joi.string().pattern(uuidPattern).optional().allow(null),
    isPublic: Joi.boolean().default(false),
    isShared: Joi.boolean().default(false),
  }),

  updateDeck: Joi.object({
    name: Joi.string().min(1).max(100).trim().optional(),
    description: Joi.string().max(500).optional().allow(''),
    isPublic: Joi.boolean().optional(),
    isShared: Joi.boolean().optional(),
  }),

  createFlashcard: Joi.object({
    front: Joi.string().min(1).max(5000).required(),
    back: Joi.string().min(1).max(10000).required(),
    deckId: Joi.string().pattern(uuidPattern).required(),
    tags: Joi.array().items(Joi.string().max(50)).max(20).optional(),
    hint: Joi.string().max(500).optional().allow(''),
    imageUrl: Joi.string().uri().max(500).optional().allow(null, ''),
    questionId: Joi.string().pattern(uuidPattern).optional().allow(null),
  }),

  updateFlashcard: Joi.object({
    front: Joi.string().min(1).max(5000).optional(),
    back: Joi.string().min(1).max(10000).optional(),
    tags: Joi.array().items(Joi.string().max(50)).max(20).optional(),
    hint: Joi.string().max(500).optional(),
    imageUrl: Joi.string().uri().max(500).optional().allow(null, ''),
  }),

  reviewFlashcard: Joi.object({
    rating: Joi.string().valid('again', 'hard', 'good', 'easy').required(),
    responseTime: Joi.number().min(0).max(300000).optional(), // Max 5 min
  }),

  // ============ TEST SCHEMAS ============
  createTestSession: Joi.object({
    groupId: Joi.string().pattern(uuidPattern).required(),
    userId: Joi.string().pattern(uuidPattern).required(),
    questionIds: Joi.array().items(Joi.string().pattern(uuidPattern)).min(1).max(500).required(),
    mode: Joi.string().valid('TEST', 'STUDY', 'GAME', 'CRAM').required(),
    config: Joi.object({
      timeLimit: Joi.number().min(0).max(18000).optional(),
      shuffle: Joi.boolean().optional(),
      showFeedback: Joi.boolean().optional(),
      focusOnNew: Joi.boolean().optional(),
      numberOfQuestions: Joi.number().min(1).max(500).optional(),
    }).optional(),
  }),

  submitTestResult: Joi.object({
    sessionId: Joi.string().pattern(uuidPattern).required(),
    userId: Joi.string().pattern(uuidPattern).required(),
    groupId: Joi.string().pattern(uuidPattern).required(),
    answers: Joi.array().items(
      Joi.object({
        questionId: Joi.string().pattern(uuidPattern).required(),
        userAnswer: Joi.alternatives().try(
          Joi.string().max(5000),
          Joi.array().items(Joi.string().max(1000)),
          Joi.object()
        ).required(),
        isCorrect: Joi.boolean().required(),
        timeSpent: Joi.number().min(0).max(36000).optional(),
      })
    ).min(1).max(500).required(),
    score: Joi.number().min(0).max(100).required(),
    totalTime: Joi.number().min(0).max(36000).optional(),
    mode: Joi.string().valid('TEST', 'STUDY', 'GAME', 'CRAM').optional(),
  }),

  // ============ STATS SCHEMAS ============
  upsertQuestionStats: Joi.object({
    userId: Joi.string().pattern(uuidPattern).required(),
    questionId: Joi.string().pattern(uuidPattern).required(),
    isCorrect: Joi.boolean().required(),
    timeSpent: Joi.number().min(0).max(36000).optional(),
  }),

  // ============ PAGINATION SCHEMAS ============
  pagination: Joi.object({
    page: Joi.number().integer().min(1).max(10000).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20),
    sortBy: Joi.string().max(50).default('created_at'),
    sortOrder: Joi.string().valid('asc', 'desc').default('desc'),
    cursor: Joi.string().max(200).optional(),
  }),

  // ============ SEARCH SCHEMAS ============
  search: Joi.object({
    q: Joi.string().min(1).max(200).required().trim(),
    type: Joi.string().valid('all', 'messages', 'groups', 'flashcards').default('all'),
    groupId: Joi.string().pattern(uuidPattern).optional(),
    limit: Joi.number().integer().min(1).max(50).default(20),
  }),

  // ============ PREFERENCE SCHEMAS ============
  userPreferences: Joi.object({
    userId: Joi.string().pattern(uuidPattern).required(),
    theme: Joi.string().valid('light', 'dark', 'system').optional(),
    preferences: Joi.object().optional(),
  }),

  // ============ UUID PARAMS ============
  uuidParam: Joi.object({
    id: Joi.string().pattern(uuidPattern).required(),
  }),

  groupIdParam: Joi.object({
    groupId: Joi.string().pattern(uuidPattern).required(),
  }),

  userIdParam: Joi.object({
    userId: Joi.string().pattern(uuidPattern).required(),
  }),

  deckIdParam: Joi.object({
    deckId: Joi.string().pattern(uuidPattern).required(),
  }),

  flashcardIdParam: Joi.object({
    flashcardId: Joi.string().pattern(uuidPattern).required(),
  }),

  // ============ NOTIFICATION SCHEMAS ============
  createNotification: Joi.object({
    userId: Joi.string().pattern(uuidPattern).required(),
    type: Joi.string().max(50).required(),
    message: Joi.string().max(500).required(),
    link: Joi.string().max(500).optional(),
    metadata: Joi.object().optional(),
  }),

  // ============ VOTE SCHEMAS ============
  vote: Joi.object({
    userId: Joi.string().pattern(uuidPattern).required(),
    voteType: Joi.string().valid('up', 'down').required(),
  }),

  // ============ MARKETPLACE SCHEMAS ============
  createListing: Joi.object({
    title: Joi.string().min(1).max(200).required().trim(),
    description: Joi.string().max(5000).required(),
    price: Joi.number().min(0).max(1000000).required(),
    category: Joi.string().max(50).required(),
    images: Joi.array().items(Joi.string().uri().max(500)).max(10).optional(),
    condition: Joi.string().valid('new', 'like_new', 'good', 'fair', 'poor').optional(),
  }),

  updateListing: Joi.object({
    title: Joi.string().min(1).max(200).trim().optional(),
    description: Joi.string().max(5000).optional(),
    price: Joi.number().min(0).max(1000000).optional(),
    status: Joi.string().valid('active', 'sold', 'removed').optional(),
  }),
};

export default schemas;
