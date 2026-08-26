/**
 * Campus listing taxonomy — the product-type tree sellers walk when creating
 * a listing. Leaves still map to the existing `marketplace_listings.category`
 * strings (and, for digital products, a publish flow). Stored on the listing
 * as `category_specific_fields.taxonomyNodeId` so we can tell a solutions
 * manual from a course textbook without a schema change.
 */

export type MarketplaceDepartment = 'academic' | 'student-life';

export type TaxonomyPublishFlow = 'listing' | 'question_bank' | 'study_pack';

export type TaxonomyAttributeKey =
  | 'condition'
  | 'isbn'
  | 'edition'
  | 'courseCode'
  | 'year'
  | 'semester'
  | 'bedrooms'
  | 'furnished'
  | 'distanceToCampus';

export type TaxonomyAttributeKind = 'select' | 'text' | 'number' | 'course';

export interface TaxonomyAttributeOption {
  value: string;
  label: string;
}

export interface TaxonomyAttribute {
  key: TaxonomyAttributeKey;
  label: string;
  help?: string;
  required: boolean;
  kind: TaxonomyAttributeKind;
  options?: readonly TaxonomyAttributeOption[];
}

export type TaxonomyIconKey =
  | 'book'
  | 'notes'
  | 'sparkles'
  | 'albums'
  | 'briefcase'
  | 'beaker'
  | 'chart'
  | 'home'
  | 'car'
  | 'shirt'
  | 'gift'
  | 'people'
  | 'ticket'
  | 'plus';

export interface TaxonomyNode {
  id: string;
  parentId: string | null;
  /** Browse group this node sits in (roots use their own id). */
  department: MarketplaceDepartment;
  label: string;
  summary: string;
  description: string;
  examples: readonly string[];
  keywords: readonly string[];
  phrases?: readonly string[];
  negativeKeywords?: readonly string[];
  icon: TaxonomyIconKey;
  /** Selectable listing type. Groups omit this. */
  listingCategory?: string;
  publishFlow?: TaxonomyPublishFlow;
  attributes?: readonly TaxonomyAttribute[];
  /** Classifier prior. Default 1. */
  weight?: number;
}

export const CUSTOM_LISTING_CATEGORY_PREFIX = 'custom:';
export const OTHER_TAXONOMY_NODE_ID = 'custom.other';

export const CONDITION_ATTRIBUTE: TaxonomyAttribute = {
  key: 'condition',
  label: 'Condition',
  help: 'Buyers filter on this.',
  required: true,
  kind: 'select',
  options: [
    { value: 'new', label: 'New' },
    { value: 'like-new', label: 'Like new' },
    { value: 'good', label: 'Good' },
    { value: 'fair', label: 'Fair' },
  ],
};

const TEXTBOOK_ATTRIBUTES: readonly TaxonomyAttribute[] = [
  CONDITION_ATTRIBUTE,
  {
    key: 'isbn',
    label: 'ISBN',
    help: 'Helps buyers match the exact book.',
    required: false,
    kind: 'text',
  },
  {
    key: 'edition',
    label: 'Edition',
    required: false,
    kind: 'text',
  },
];

const COURSE_YEAR_SEMESTER: readonly TaxonomyAttribute[] = [
  {
    key: 'courseCode',
    label: 'Course',
    help: 'File this under the course buyers search for.',
    required: false,
    kind: 'course',
  },
  { key: 'year', label: 'Year', required: false, kind: 'text' },
  {
    key: 'semester',
    label: 'Semester',
    required: false,
    kind: 'select',
    options: [
      { value: '1st', label: 'First semester' },
      { value: '2nd', label: 'Second semester' },
    ],
  },
];

const COURSE_YEAR: readonly TaxonomyAttribute[] = [
  {
    key: 'courseCode',
    label: 'Course',
    required: false,
    kind: 'course',
  },
  { key: 'year', label: 'Year', required: false, kind: 'text' },
];

const HOUSING_ATTRIBUTES: readonly TaxonomyAttribute[] = [
  { key: 'bedrooms', label: 'Bedrooms', required: false, kind: 'number' },
  {
    key: 'furnished',
    label: 'Furnished',
    required: false,
    kind: 'select',
    options: [
      { value: 'yes', label: 'Furnished' },
      { value: 'no', label: 'Unfurnished' },
    ],
  },
  {
    key: 'distanceToCampus',
    label: 'Distance to campus',
    required: false,
    kind: 'text',
  },
];

/**
 * Full catalog. Order is browse order. Keep listingCategory values in sync
 * with historical marketplace category ids.
 */
export const TAXONOMY_NODES: readonly TaxonomyNode[] = [
  {
    id: 'academic',
    parentId: null,
    department: 'academic',
    label: 'Academic materials',
    summary: 'Books, notes, past questions, projects, lab gear',
    description: 'Anything a student uses to pass a course or run a lab.',
    examples: [],
    keywords: ['academic', 'school', 'course', 'lecture', 'campus'],
    icon: 'book',
  },
  {
    id: 'academic.materials',
    parentId: 'academic',
    department: 'academic',
    label: 'Course materials',
    summary: 'What you study with',
    description: 'Textbooks, notes, past papers, and compiled study products.',
    examples: [],
    keywords: ['material', 'notes', 'book', 'pq'],
    icon: 'notes',
  },
  {
    id: 'academic.materials.textbooks',
    parentId: 'academic.materials',
    department: 'academic',
    label: 'Textbooks',
    summary: 'Printed or used course books',
    description: 'Physical textbooks, solutions manuals, and lab workbooks.',
    examples: [],
    keywords: ['textbook', 'book'],
    icon: 'book',
  },
  {
    id: 'academic.materials.textbooks.course',
    parentId: 'academic.materials.textbooks',
    department: 'academic',
    label: 'Course textbook',
    summary: 'The assigned or recommended text',
    description:
      'A course textbook you are selling or swapping. Use this for the actual book, not photocopied notes.',
    examples: [
      'Organic Chemistry 7th edition (CHM 201)',
      'Engineering Mathematics K.A. Stroud',
      'Campbell Biology, barely used',
    ],
    keywords: [
      'textbook',
      'text book',
      'hardback',
      'paperback',
      'mcgraw',
      'pearson',
      'wiley',
      'elsevier',
      'stroud',
      'campbell',
      'harper',
    ],
    phrases: ['course textbook', 'prescribed text', 'recommended text', '7th edition', '8th edition'],
    negativeKeywords: ['notes', 'photocopy', 'pq', 'past question', 'question bank', 'study pack'],
    icon: 'book',
    listingCategory: 'textbook_exchange',
    publishFlow: 'listing',
    attributes: TEXTBOOK_ATTRIBUTES,
    weight: 1.1,
  },
  {
    id: 'academic.materials.textbooks.solutions',
    parentId: 'academic.materials.textbooks',
    department: 'academic',
    label: 'Solutions manual',
    summary: 'Worked answers that go with a textbook',
    description: 'Instructor or student solutions manuals sold as a separate item from the textbook.',
    examples: ['Stroud solutions manual', 'Organic chemistry solutions, 7th ed'],
    keywords: ['solutions', 'solution manual', 'worked answers', 'answer key'],
    phrases: ['solutions manual', 'solution manual', 'instructor solutions'],
    icon: 'book',
    listingCategory: 'textbook_exchange',
    publishFlow: 'listing',
    attributes: TEXTBOOK_ATTRIBUTES,
  },
  {
    id: 'academic.materials.textbooks.lab-manual',
    parentId: 'academic.materials.textbooks',
    department: 'academic',
    label: 'Lab manual or workbook',
    summary: 'Practical books with spaces to fill in',
    description: 'Lab manuals, workbooks, and practical guides — usually required alongside a lecture text.',
    examples: ['CHM 101 practical manual', 'Physics workbook 200 level'],
    keywords: ['lab manual', 'practical manual', 'workbook', 'work book', 'practical book'],
    phrases: ['lab manual', 'practical manual', 'practical workbook'],
    icon: 'book',
    listingCategory: 'textbook_exchange',
    publishFlow: 'listing',
    attributes: TEXTBOOK_ATTRIBUTES,
  },
  {
    id: 'academic.materials.notes',
    parentId: 'academic.materials',
    department: 'academic',
    label: 'Notes & handouts',
    summary: 'Lecture notes and tutorials',
    description: 'Typed or handwritten notes from class — not a compiled Lantern study pack.',
    examples: [],
    keywords: ['notes', 'handout'],
    icon: 'notes',
  },
  {
    id: 'academic.materials.notes.lecture',
    parentId: 'academic.materials.notes',
    department: 'academic',
    label: 'Lecture notes',
    summary: 'Notes from lectures, typed or written',
    description:
      'Your lecture notes as PDF, printout, or photos. For a packaged deck + notes + questions product, use a study pack instead.',
    examples: ['GST 101 lecture notes PDF', 'MTH 201 typed notes, 12 weeks'],
    keywords: ['lecture notes', 'class notes', 'typed notes', 'handwritten notes', 'slides', 'handout'],
    phrases: ['lecture notes', 'class notes', 'typed notes'],
    negativeKeywords: ['question bank', 'study pack', 'past question', 'textbook'],
    icon: 'notes',
    listingCategory: 'lecture_notes',
    publishFlow: 'listing',
    attributes: COURSE_YEAR_SEMESTER,
    weight: 1.15,
  },
  {
    id: 'academic.materials.notes.tutorial',
    parentId: 'academic.materials.notes',
    department: 'academic',
    label: 'Tutorial handouts',
    summary: 'TA / tutorial sheets and worked examples',
    description: 'Tutorial sheets, recitation handouts, and extra worked examples that are not the full lecture note set.',
    examples: ['CSC 201 tutorial sheets with answers', 'Engineering drawing tutorial pack'],
    keywords: ['tutorial', 'handout', 'worksheet', 'recitation', 'ta notes'],
    phrases: ['tutorial sheet', 'tutorial notes', 'worked examples'],
    icon: 'notes',
    listingCategory: 'lecture_notes',
    publishFlow: 'listing',
    attributes: COURSE_YEAR_SEMESTER,
  },
  {
    id: 'academic.materials.assessments',
    parentId: 'academic.materials',
    department: 'academic',
    label: 'Past questions',
    summary: 'Exams that already happened',
    description: 'Printed or PDF past papers, or a takeable Lantern question bank.',
    examples: [],
    keywords: ['pq', 'past question', 'exam'],
    icon: 'sparkles',
  },
  {
    id: 'academic.materials.assessments.printed-pq',
    parentId: 'academic.materials.assessments',
    department: 'academic',
    label: 'Printed or PDF past questions',
    summary: 'A file or booklet of old papers',
    description:
      'Past exam papers you are selling as a document. If you built a takeable test inside Lantern, publish it as a question bank from Study products instead.',
    examples: [
      '300 level Engineering past questions 2018–2023',
      'BIO 201 CA and exam PQ PDF',
      'Law of contract past papers with answers',
    ],
    keywords: [
      'past question',
      'past questions',
      'pq',
      'pqs',
      'exam paper',
      'exam papers',
      'ca questions',
      'midterm',
      'test questions',
    ],
    phrases: ['past questions', 'past question', 'exam papers', 'pq bank', 'marking scheme'],
    negativeKeywords: ['question bank', 'takeable', 'study pack'],
    icon: 'sparkles',
    listingCategory: 'pq_bank',
    publishFlow: 'listing',
    attributes: COURSE_YEAR_SEMESTER,
    weight: 1.2,
  },
  {
    id: 'academic.materials.assessments.digital-bank',
    parentId: 'academic.materials.assessments',
    department: 'academic',
    label: 'Lantern question bank',
    summary: 'A takeable test you built in the app',
    description:
      'Sell a question bank buyers can sit as a test inside Lantern. Publish it from Study products — this listing form is for documents and physical items.',
    examples: ['200-question GST 101 bank with explanations', 'MCQ bank for MCB 203'],
    keywords: ['question bank', 'mcq bank', 'practice test', 'takeable', 'timed test'],
    phrases: ['question bank', 'practice test', 'mcq bank'],
    negativeKeywords: ['printed', 'hardcopy', 'photocopy'],
    icon: 'sparkles',
    listingCategory: 'pq_bank',
    publishFlow: 'question_bank',
    attributes: COURSE_YEAR_SEMESTER,
    weight: 1.05,
  },
  {
    id: 'academic.materials.compiled',
    parentId: 'academic.materials',
    department: 'academic',
    label: 'Study packs',
    summary: 'Decks, notes, and questions together',
    description: 'A bundled digital product published from your library.',
    examples: [],
    keywords: ['study pack', 'bundle'],
    icon: 'albums',
  },
  {
    id: 'academic.materials.compiled.study-pack',
    parentId: 'academic.materials.compiled',
    department: 'academic',
    label: 'Lantern study pack',
    summary: 'Deck + notes + questions as one product',
    description:
      'Study packs are published from a deck or note in your library so buyers get an offline copy. Do not use the generic listing form for them.',
    examples: ['GST 101 complete study pack', 'BIO 201 deck + notes pack'],
    keywords: ['study pack', 'studypack', 'revision pack', 'complete pack'],
    phrases: ['study pack', 'revision pack'],
    icon: 'albums',
    listingCategory: 'study_pack',
    publishFlow: 'study_pack',
    weight: 1.1,
  },
  {
    id: 'academic.materials.capstone',
    parentId: 'academic.materials',
    department: 'academic',
    label: 'Projects & thesis',
    summary: 'Final-year and research write-ups',
    description: 'Project reports, theses, and dissertations you have the right to share.',
    examples: [],
    keywords: ['project', 'thesis'],
    icon: 'briefcase',
  },
  {
    id: 'academic.materials.capstone.project',
    parentId: 'academic.materials.capstone',
    department: 'academic',
    label: 'Project, thesis or seminar',
    summary: 'A write-up you authored or may share',
    description:
      'Final-year projects, theses, seminars, and chapter drafts. You must have the right to sell or share the work.',
    examples: ['Computer science final year project (attendance system)', 'MBA thesis, 2024'],
    keywords: ['project', 'thesis', 'dissertation', 'seminar paper', 'chapter one', 'fyp', 'final year'],
    phrases: ['final year project', 'research project', 'seminar paper'],
    icon: 'briefcase',
    listingCategory: 'project_thesis',
    publishFlow: 'listing',
    attributes: COURSE_YEAR,
    weight: 1.1,
  },
  {
    id: 'academic.lab',
    parentId: 'academic',
    department: 'academic',
    label: 'Lab & research',
    summary: 'Equipment and data collection',
    description: 'Help gathering data, or lab gear for sale or rent.',
    examples: [],
    keywords: ['lab', 'research', 'equipment'],
    icon: 'beaker',
  },
  {
    id: 'academic.lab.data-collection',
    parentId: 'academic.lab',
    department: 'academic',
    label: 'Data collection',
    summary: 'Surveys, enumerators, field help',
    description: 'Paid help collecting survey, interview, or field data for a project.',
    examples: ['Need 80 questionnaire responses, UNN', 'Enumerator for market survey, Lagos'],
    keywords: ['data collection', 'enumerator', 'questionnaire', 'survey respondents', 'field work', 'google form'],
    phrases: ['data collection', 'fill questionnaire', 'survey respondents'],
    icon: 'chart',
    listingCategory: 'data_collection',
    publishFlow: 'listing',
  },
  {
    id: 'academic.lab.equipment-rental',
    parentId: 'academic.lab',
    department: 'academic',
    label: 'Lab equipment rental',
    summary: 'Borrow gear for a practical',
    description: 'Microscopes, kits, and instruments rented for a lab or project — not campus-owned stores.',
    examples: ['Microscope rental, 3 days', 'Soil testing kit for weekend practical'],
    keywords: ['rental', 'rent', 'hire', 'borrow', 'microscope', 'bunsen', 'pipette', 'kit'],
    phrases: ['lab equipment', 'microscope rental', 'for rent'],
    negativeKeywords: ['sale', 'selling', 'for sale'],
    icon: 'beaker',
    listingCategory: 'equipment_rental',
    publishFlow: 'listing',
    attributes: [CONDITION_ATTRIBUTE],
  },
  {
    id: 'academic.lab.equipment-sale',
    parentId: 'academic.lab',
    department: 'academic',
    label: 'Lab equipment for sale',
    summary: 'Gear you are selling outright',
    description: 'Lab instruments and kits changing hands, not a rental.',
    examples: ['Used microscope for sale', 'Dissection kit, 200 level'],
    keywords: ['equipment', 'microscope', 'kit', 'instrument', 'for sale'],
    phrases: ['lab equipment', 'for sale'],
    negativeKeywords: ['rent', 'rental', 'hire'],
    icon: 'beaker',
    listingCategory: 'equipment_rental',
    publishFlow: 'listing',
    attributes: [CONDITION_ATTRIBUTE],
  },
  {
    id: 'campus',
    parentId: null,
    department: 'student-life',
    label: 'Campus life',
    summary: 'Housing, rides, fashion, services, events',
    description: 'Student life around campus that is not course material.',
    examples: [],
    keywords: ['campus', 'hostel', 'hostel', 'life'],
    icon: 'home',
  },
  {
    id: 'campus.housing',
    parentId: 'campus',
    department: 'student-life',
    label: 'Housing',
    summary: 'Rooms and flats',
    description: 'Hostels, off-campus rooms, and short stays.',
    examples: [],
    keywords: ['hostel', 'apartment', 'rent', 'accommodation'],
    icon: 'home',
  },
  {
    id: 'campus.housing.hostel',
    parentId: 'campus.housing',
    department: 'student-life',
    label: 'Hostel or shared room',
    summary: 'A bedspace or hostel room',
    description: 'On-campus or private hostel bedspaces and shared rooms.',
    examples: ['Female hostel bedspace, Yaba', 'Self-contain near gate, one occupant'],
    keywords: ['hostel', 'bedspace', 'bed space', 'bunk', 'lodge', 'self contain', 'self-contain'],
    phrases: ['bedspace', 'hostel room', 'self contain'],
    icon: 'home',
    listingCategory: 'accommodation',
    publishFlow: 'listing',
    attributes: HOUSING_ATTRIBUTES,
    weight: 1.1,
  },
  {
    id: 'campus.housing.flat',
    parentId: 'campus.housing',
    department: 'student-life',
    label: 'Flat or apartment',
    summary: 'A whole unit off campus',
    description: 'One- or two-bedroom flats and apartments, usually off campus.',
    examples: ['2 bedroom flat 10 mins from UNILAG', 'Mini flat, Akoka'],
    keywords: ['flat', 'apartment', 'duplex', 'mini flat', '2 bedroom', '3 bedroom', 'one bedroom'],
    phrases: ['bedroom flat', 'mini flat', 'two bedroom'],
    icon: 'home',
    listingCategory: 'accommodation',
    publishFlow: 'listing',
    attributes: HOUSING_ATTRIBUTES,
    weight: 1.15,
  },
  {
    id: 'campus.housing.short-let',
    parentId: 'campus.housing',
    department: 'student-life',
    label: 'Short let',
    summary: 'Days or exam-period stays',
    description: 'Short stays for exams, SIWES, or visits — not a full-session rent.',
    examples: ['Short let during exams, 2 weeks', 'AirBnB-style room, convocation week'],
    keywords: ['short let', 'shortlet', 'airbnb', 'exam lodge', 'night stay'],
    phrases: ['short let', 'short stay', 'exam period'],
    icon: 'home',
    listingCategory: 'accommodation',
    publishFlow: 'listing',
    attributes: HOUSING_ATTRIBUTES,
  },
  {
    id: 'campus.mobility',
    parentId: 'campus',
    department: 'student-life',
    label: 'Getting around',
    summary: 'Rides and vehicles',
    description: 'Campus shuttles, intercity travel, bikes and cars.',
    examples: [],
    keywords: ['transport', 'ride', 'bus'],
    icon: 'car',
  },
  {
    id: 'campus.mobility.ride',
    parentId: 'campus.mobility',
    department: 'student-life',
    label: 'Ride or trip',
    summary: 'A seat on a trip, not the vehicle',
    description: 'Airport pickup, intercity travel, and shared rides. You are selling the journey, not the car.',
    examples: ['Airport pickup from MMIA, Saturday', 'Abuja–Lagos weekend trip, one seat'],
    keywords: ['pickup', 'dropoff', 'drop off', 'airport', 'trip', 'ride', 'shuttle', 'travel'],
    phrases: ['airport pickup', 'one seat', 'weekend trip'],
    negativeKeywords: ['tokunbo', 'for sale', 'lexus', 'corolla'],
    icon: 'car',
    listingCategory: 'travel_transport',
    publishFlow: 'listing',
    weight: 1.1,
  },
  {
    id: 'campus.mobility.vehicle',
    parentId: 'campus.mobility',
    department: 'student-life',
    label: 'Bike or car for sale',
    summary: 'The vehicle itself',
    description: 'Bicycles, motorbikes, and cars changing hands between students.',
    keywords: ['bike', 'bicycle', 'motorcycle', 'okada', 'car', 'tokunbo', 'corolla'],
    phrases: ['for sale', 'tokunbo'],
    negativeKeywords: ['pickup', 'airport', 'seat'],
    icon: 'car',
    listingCategory: 'travel_transport',
    publishFlow: 'listing',
    attributes: [CONDITION_ATTRIBUTE],
    examples: ['Used bicycle, Akoka', 'Tokunbo Corolla, student-owned'],
  },
  {
    id: 'campus.fashion',
    parentId: 'campus',
    department: 'student-life',
    label: 'Fashion',
    summary: 'Aso ebi and campus wear',
    description: 'Clothes and aso ebi for events and everyday campus.',
    examples: [],
    keywords: ['fashion', 'aso ebi', 'clothes'],
    icon: 'shirt',
  },
  {
    id: 'campus.fashion.aso-ebi',
    parentId: 'campus.fashion',
    department: 'student-life',
    label: 'Aso ebi & occasion wear',
    summary: 'Matching fabric for a specific event',
    description: 'Aso ebi, gele, and outfits tied to a wedding, convocation, or society night.',
    examples: ['Aso ebi lace for convocation', 'Ankara for department dinner, 3 yards'],
    keywords: ['aso ebi', 'asoebi', 'gele', 'lace', 'ankara', 'iro', 'buba', 'agbada', 'convocation outfit'],
    phrases: ['aso ebi', 'asoebi', 'occasion wear'],
    icon: 'shirt',
    listingCategory: 'aso_ebi',
    publishFlow: 'listing',
    attributes: [CONDITION_ATTRIBUTE],
    weight: 1.25,
  },
  {
    id: 'campus.fashion.everyday',
    parentId: 'campus.fashion',
    department: 'student-life',
    label: 'Everyday campus wear',
    summary: 'Clothes that are not aso ebi',
    description: 'Shoes, bags, and clothes for class — not a matching event fabric.',
    examples: ['White sneakers, size 42', 'Tote bag for lectures'],
    keywords: ['sneakers', 'shoes', 'dress', 'jeans', 'bag', 'clothes', 'wear'],
    phrases: ['for sale'],
    negativeKeywords: ['aso ebi', 'asoebi', 'gele'],
    icon: 'shirt',
    listingCategory: 'aso_ebi',
    publishFlow: 'listing',
    attributes: [CONDITION_ATTRIBUTE],
  },
  {
    id: 'campus.goods',
    parentId: 'campus',
    department: 'student-life',
    label: 'Personal goods',
    summary: 'Electronics, furniture, extras',
    description: 'Things you own that are not fashion or course materials.',
    examples: [],
    keywords: ['goods', 'item', 'gadget'],
    icon: 'gift',
  },
  {
    id: 'campus.goods.electronics',
    parentId: 'campus.goods',
    department: 'student-life',
    label: 'Electronics',
    summary: 'Phones, laptops, peripherals',
    description: 'Phones, laptops, earphones, and other gadgets.',
    examples: ['Used HP laptop, 8GB RAM', 'Power bank 20,000mAh'],
    keywords: [
      'laptop',
      'phone',
      'iphone',
      'samsung',
      'earpod',
      'earpiece',
      'power bank',
      'charger',
      'tablet',
      'ipad',
    ],
    phrases: ['for sale'],
    icon: 'gift',
    listingCategory: 'personal_goods',
    publishFlow: 'listing',
    attributes: [CONDITION_ATTRIBUTE],
    weight: 1.1,
  },
  {
    id: 'campus.goods.other',
    parentId: 'campus.goods',
    department: 'student-life',
    label: 'Other personal items',
    summary: 'Furniture, kitchen, miscellaneous',
    description: 'Furniture, kitchenware, and anything that is not electronics or clothes.',
    examples: ['Reading lamp', 'Mini fridge, hostel use'],
    keywords: ['fridge', 'lamp', 'kettle', 'mattress', 'furniture', 'fan', 'bucket'],
    icon: 'gift',
    listingCategory: 'personal_goods',
    publishFlow: 'listing',
    attributes: [CONDITION_ATTRIBUTE],
  },
  {
    id: 'campus.services',
    parentId: 'campus',
    department: 'student-life',
    label: 'Campus services',
    summary: 'Tutoring, printing, errands',
    description: 'Skills and errands, not physical goods.',
    examples: [],
    keywords: ['service', 'help', 'tutor'],
    icon: 'people',
  },
  {
    id: 'campus.services.tutoring',
    parentId: 'campus.services',
    department: 'student-life',
    label: 'Tutoring',
    summary: 'One-to-one or group teaching',
    description: 'Paid tutoring for a course. This is a service listing, not a set of notes.',
    examples: ['MTH 101 tutor, weekends', 'Organic chemistry crash class'],
    keywords: ['tutor', 'tutoring', 'coaching', 'lesson', 'crash course', 'home lesson'],
    phrases: ['crash class', 'home lesson', 'need a tutor'],
    negativeKeywords: ['notes', 'textbook', 'past question'],
    icon: 'people',
    listingCategory: 'campus_services',
    publishFlow: 'listing',
    weight: 1.1,
  },
  {
    id: 'campus.services.printing',
    parentId: 'campus.services',
    department: 'student-life',
    label: 'Printing & typing',
    summary: 'Print, bind, type, design',
    description: 'Photocopy, binding, typing, and simple design work on or near campus.',
    examples: ['Same-day binding, faculty of science', 'Project typing, ₦500/page'],
    keywords: ['printing', 'photocopy', 'binding', 'lamination', 'typing', 'graphic design', 'flex banner'],
    phrases: ['photocopy', 'project typing'],
    icon: 'people',
    listingCategory: 'campus_services',
    publishFlow: 'listing',
  },
  {
    id: 'campus.services.other',
    parentId: 'campus.services',
    department: 'student-life',
    label: 'Other campus services',
    summary: 'Errands and everything else',
    description: 'Errands, repairs, and services that are not tutoring or printing.',
    examples: ['Phone screen replacement, hostel', 'Weekend laundry pickup'],
    keywords: ['errand', 'repair', 'laundry', 'cleaning', 'service'],
    icon: 'people',
    listingCategory: 'campus_services',
    publishFlow: 'listing',
  },
  {
    id: 'campus.events',
    parentId: 'campus',
    department: 'student-life',
    label: 'Events & social',
    summary: 'Tickets and hangouts',
    description: 'Event tickets and social listings.',
    examples: [],
    keywords: ['event', 'ticket', 'party'],
    icon: 'ticket',
  },
  {
    id: 'campus.events.tickets',
    parentId: 'campus.events',
    department: 'student-life',
    label: 'Event tickets',
    summary: 'A ticket to something happening',
    description: 'Dinner, concert, conference, or club-night tickets.',
    examples: ['Faculty dinner ticket, table of 4', 'Unilag concert, one ticket'],
    keywords: ['ticket', 'tickets', 'dinner night', 'concert', 'conference pass', 'club night'],
    phrases: ['event ticket', 'dinner ticket'],
    icon: 'ticket',
    listingCategory: 'events_social',
    publishFlow: 'listing',
    weight: 1.1,
  },
  {
    id: 'campus.events.social',
    parentId: 'campus.events',
    department: 'student-life',
    label: 'Hangouts & groups',
    summary: 'Meetups that are not a ticketed show',
    description: 'Study groups, hangouts, and socials that are not a ticketed event.',
    examples: ['Weekend hike, two slots', 'Language exchange, Faculty of Arts'],
    keywords: ['hangout', 'meetup', 'study group', 'social', 'hike'],
    icon: 'ticket',
    listingCategory: 'events_social',
    publishFlow: 'listing',
  },
  {
    id: 'custom.other',
    parentId: null,
    department: 'academic',
    label: 'Something else',
    summary: 'Name your own type if nothing fits',
    description:
      'Use this only when no campus type matches. Buyers still see your custom name; prefer a catalog type when you can.',
    examples: ['Department souvenir', 'Rare lab consumable'],
    keywords: ['other', 'custom', 'misc', 'miscellaneous'],
    icon: 'plus',
    listingCategory: 'other',
    publishFlow: 'listing',
    weight: 0.4,
  },
];

const NODE_BY_ID: ReadonlyMap<string, TaxonomyNode> = new Map(
  TAXONOMY_NODES.map((node) => [node.id, node]),
);

export function getTaxonomyNode(id: string | null | undefined): TaxonomyNode | undefined {
  if (!id) return undefined;
  return NODE_BY_ID.get(id);
}

export function isTaxonomyLeaf(node: TaxonomyNode): boolean {
  return typeof node.listingCategory === 'string' && node.listingCategory.length > 0;
}

export function getTaxonomyLeaves(): TaxonomyNode[] {
  return TAXONOMY_NODES.filter(isTaxonomyLeaf);
}

export function getTaxonomyChildren(parentId: string | null): TaxonomyNode[] {
  return TAXONOMY_NODES.filter((node) => node.parentId === parentId);
}

export function getTaxonomyPath(id: string): TaxonomyNode[] {
  const path: TaxonomyNode[] = [];
  let current = getTaxonomyNode(id);
  const guard = new Set<string>();
  while (current && !guard.has(current.id)) {
    guard.add(current.id);
    path.unshift(current);
    current = current.parentId ? getTaxonomyNode(current.parentId) : undefined;
  }
  return path;
}

export function taxonomyPathLabel(id: string, separator = ' › '): string {
  return getTaxonomyPath(id)
    .filter((node) => node.parentId !== null || isTaxonomyLeaf(node))
    .map((node) => node.label)
    .join(separator);
}

export function isCustomListingCategory(category: string | null | undefined): boolean {
  return typeof category === 'string' && category.startsWith(CUSTOM_LISTING_CATEGORY_PREFIX);
}

export function customCategoryName(category: string): string {
  return isCustomListingCategory(category)
    ? category.slice(CUSTOM_LISTING_CATEGORY_PREFIX.length)
    : category;
}

export function toCustomListingCategory(name: string): string {
  return `${CUSTOM_LISTING_CATEGORY_PREFIX}${name.trim()}`;
}

const KNOWN_LISTING_CATEGORIES: ReadonlySet<string> = new Set(
  getTaxonomyLeaves()
    .map((node) => node.listingCategory)
    .filter((id): id is string => Boolean(id) && id !== 'other'),
);

/** Built-in marketplace.category values (not custom:*). */
export function knownListingCategories(): readonly string[] {
  return Array.from(KNOWN_LISTING_CATEGORIES);
}

export function isKnownListingCategory(category: string | null | undefined): boolean {
  if (!category) return false;
  if (isCustomListingCategory(category)) return true;
  return KNOWN_LISTING_CATEGORIES.has(category);
}

export function isAllowedListingCategory(category: string | null | undefined): boolean {
  if (!category || typeof category !== 'string') return false;
  const trimmed = category.trim();
  if (!trimmed) return false;
  if (isCustomListingCategory(trimmed)) {
    return trimmed.length > CUSTOM_LISTING_CATEGORY_PREFIX.length && trimmed.length <= 100;
  }
  return KNOWN_LISTING_CATEGORIES.has(trimmed);
}

export interface BrowseListingCategory {
  id: string;
  name: string;
  department: MarketplaceDepartment;
  icon: TaxonomyIconKey;
}

/**
 * One chip per listing category, using the most general leaf label
 * (course textbook → Textbooks via parent, else the leaf label).
 */
export function browseListingCategories(
  department?: MarketplaceDepartment,
): BrowseListingCategory[] {
  const seen = new Map<string, BrowseListingCategory>();
  for (const leaf of getTaxonomyLeaves()) {
    if (leaf.listingCategory === 'other') continue;
    if (department && leaf.department !== department) continue;
    const categoryId = leaf.listingCategory as string;
    if (seen.has(categoryId)) continue;
    const parent = leaf.parentId ? getTaxonomyNode(leaf.parentId) : undefined;
    const name =
      parent && parent.parentId && !isTaxonomyLeaf(parent) ? parent.label : leaf.label;
    seen.set(categoryId, {
      id: categoryId,
      name,
      department: leaf.department,
      icon: parent?.icon || leaf.icon,
    });
  }
  return Array.from(seen.values());
}

export function defaultLeafForListingCategory(
  category: string,
  department?: MarketplaceDepartment,
): TaxonomyNode | undefined {
  if (isCustomListingCategory(category) || category === 'other') {
    return getTaxonomyNode(OTHER_TAXONOMY_NODE_ID);
  }
  const matches = getTaxonomyLeaves().filter(
    (node) => node.listingCategory === category && node.publishFlow === 'listing',
  );
  if (department) {
    const scoped = matches.filter((node) => node.department === department);
    if (scoped[0]) return scoped[0];
  }
  return matches[0] || getTaxonomyLeaves().find((node) => node.listingCategory === category);
}

export function attributesForNode(node: TaxonomyNode | undefined): readonly TaxonomyAttribute[] {
  return node?.attributes ?? [];
}

export function listingNeedsCoursePicker(listingCategory: string | null | undefined): boolean {
  if (!listingCategory) return false;
  const leaf = defaultLeafForListingCategory(listingCategory);
  return Boolean(leaf?.attributes?.some((attr) => attr.key === 'courseCode'));
}

export type TaxonomyTreeNode = {
  node: TaxonomyNode;
  children: TaxonomyTreeNode[];
};

export function taxonomyForest(department?: MarketplaceDepartment): TaxonomyTreeNode[] {
  const build = (parentId: string | null): TaxonomyTreeNode[] =>
    getTaxonomyChildren(parentId)
      .filter((node) => !department || node.department === department || node.id === OTHER_TAXONOMY_NODE_ID)
      .map((node) => ({ node, children: build(node.id) }));
  return build(null).filter((branch) => {
    if (!department) return true;
    if (branch.node.id === OTHER_TAXONOMY_NODE_ID) return true;
    return branch.node.department === department;
  });
}

export function publicTaxonomyPayload() {
  return {
    leaves: getTaxonomyLeaves().map((node) => ({
      id: node.id,
      parentId: node.parentId,
      department: node.department,
      label: node.label,
      summary: node.summary,
      description: node.description,
      examples: node.examples,
      listingCategory: node.listingCategory,
      publishFlow: node.publishFlow ?? 'listing',
      attributes: node.attributes ?? [],
      pathLabel: taxonomyPathLabel(node.id),
    })),
    browse: {
      academic: browseListingCategories('academic'),
      'student-life': browseListingCategories('student-life'),
    },
  };
}
