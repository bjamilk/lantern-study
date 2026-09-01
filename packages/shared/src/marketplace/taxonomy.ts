/**
 * Campus listing taxonomy — the product-type tree sellers walk when creating
 * a listing. Leaves still map to the existing `marketplace_listings.category`
 * strings (and, for digital products, a publish flow). Stored on the listing
 * as `category_specific_fields.taxonomyNodeId` so we can tell a solutions
 * manual from a course textbook without a schema change.
 */

/**
 * Departments, Amazon-style. Study material is now ONE department among nine
 * rather than half the tree: the old academic / student-life split forced
 * every phone, hostel and hair appointment into a "student life" bucket that
 * described the seller rather than the product.
 */
export type MarketplaceDepartment =
  | 'electronics'
  | 'study-materials'
  | 'housing'
  | 'fashion-beauty'
  | 'food-groceries'
  | 'services'
  | 'transport'
  | 'events-tickets'
  | 'campus-essentials';

/** Department order used for browse — highest-volume campus commerce first. */
export const MARKETPLACE_DEPARTMENTS: readonly MarketplaceDepartment[] = [
  'electronics',
  'study-materials',
  'housing',
  'fashion-beauty',
  'food-groceries',
  'services',
  'transport',
  'events-tickets',
  'campus-essentials',
];

export type TaxonomyPublishFlow = 'listing' | 'question_bank' | 'study_pack';

export type TaxonomyAttributeKey =
  | 'bedrooms'
  | 'brand'
  | 'capacity'
  | 'clothingSize'
  | 'colour'
  | 'condition'
  | 'courseCode'
  | 'delivery'
  | 'dietary'
  | 'distanceToCampus'
  | 'edition'
  | 'engineCapacity'
  | 'eventDate'
  | 'fileFormat'
  | 'furnished'
  | 'gender'
  | 'hairLength'
  | 'hairType'
  | 'isbn'
  | 'level'
  | 'mileage'
  | 'model'
  | 'portionSize'
  | 'priceBand'
  | 'questionCount'
  | 'ram'
  | 'rentPeriod'
  | 'rentalPeriod'
  | 'roomType'
  | 'semester'
  | 'serviceArea'
  | 'serviceMode'
  | 'storage'
  | 'ticketQuantity'
  | 'utilities'
  | 'venue'
  | 'warranty'
  | 'year';

export type TaxonomyAttributeKind = 'select' | 'text' | 'number' | 'course' | 'date';

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
  | 'phone'
  | 'food'
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

/**
 * Leaves the app links to by name. Hardcoding path strings at the call site is
 * how the last rename left four dead lookups behind, each failing silently.
 */
export const PRINTED_PAST_QUESTIONS_NODE_ID =
  'study-materials.past-questions.printed-past-questions';
/** What a fresh listing form starts on before the seller picks. */
export const DEFAULT_LISTING_NODE_ID = 'study-materials.textbooks.course-textbook';

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
/**
 * Refinements, Amazon-style: the same object drives the listing form and the
 * browse filters, so a seller can never fill in a field a buyer cannot filter on.
 */
export const TAXONOMY_ATTRIBUTE_DEFS: Readonly<Record<TaxonomyAttributeKey, TaxonomyAttribute>> = {
  condition: {
    key: 'condition',
    label: 'Condition',
    kind: 'select',
    required: false,
    options: [{ value: 'new', label: 'New' }, { value: 'like-new', label: 'Like new' }, { value: 'good', label: 'Good' }, { value: 'fair', label: 'Fair' }, { value: 'for-parts', label: 'For parts' }],
  },
  brand: {
    key: 'brand',
    label: 'Brand',
    kind: 'text',
    required: false,
  },
  model: {
    key: 'model',
    label: 'Model',
    kind: 'text',
    required: false,
  },
  storage: {
    key: 'storage',
    label: 'Storage',
    kind: 'select',
    required: false,
    options: [{ value: '16gb', label: '16GB' }, { value: '32gb', label: '32GB' }, { value: '64gb', label: '64GB' }, { value: '128gb', label: '128GB' }, { value: '256gb', label: '256GB' }, { value: '512gb', label: '512GB' }, { value: '1tb-or-more', label: '1TB or more' }],
  },
  ram: {
    key: 'ram',
    label: 'RAM',
    kind: 'select',
    required: false,
    options: [{ value: '2gb', label: '2GB' }, { value: '3gb', label: '3GB' }, { value: '4gb', label: '4GB' }, { value: '6gb', label: '6GB' }, { value: '8gb', label: '8GB' }, { value: '12gb', label: '12GB' }, { value: '16gb-or-more', label: '16GB or more' }],
  },
  warranty: {
    key: 'warranty',
    label: 'Warranty',
    kind: 'select',
    required: false,
    options: [{ value: 'no-warranty', label: 'No warranty' }, { value: 'under-3-months', label: 'Under 3 months' }, { value: '3-12-months', label: '3-12 months' }, { value: 'over-a-year', label: 'Over a year' }],
  },
  colour: {
    key: 'colour',
    label: 'Colour',
    kind: 'text',
    required: false,
  },
  delivery: {
    key: 'delivery',
    label: 'How you hand it over',
    kind: 'select',
    required: false,
    options: [{ value: 'campus-meetup', label: 'Campus meetup' }, { value: 'delivery-within-town', label: 'Delivery within town' }, { value: 'nationwide-shipping', label: 'Nationwide shipping' }, { value: 'digital-download', label: 'Digital download' }],
  },
  priceBand: {
    key: 'priceBand',
    label: 'Price',
    kind: 'select',
    required: false,
    options: [{ value: 'under-5-000', label: 'Under 5,000' }, { value: '5-000-20-000', label: '5,000 - 20,000' }, { value: '20-000-50-000', label: '20,000 - 50,000' }, { value: '50-000-150-000', label: '50,000 - 150,000' }, { value: '150-000-500-000', label: '150,000 - 500,000' }, { value: 'over-500-000', label: 'Over 500,000' }],
  },
  isbn: {
    key: 'isbn',
    label: 'ISBN',
    kind: 'text',
    required: false,
  },
  edition: {
    key: 'edition',
    label: 'Edition',
    kind: 'text',
    required: false,
  },
  courseCode: {
    key: 'courseCode',
    label: 'Course',
    kind: 'course',
    required: false,
  },
  level: {
    key: 'level',
    label: 'Level',
    kind: 'select',
    required: false,
    options: [{ value: '100', label: '100' }, { value: '200', label: '200' }, { value: '300', label: '300' }, { value: '400', label: '400' }, { value: '500', label: '500' }, { value: '600', label: '600' }, { value: '700', label: '700' }, { value: 'postgraduate', label: 'Postgraduate' }],
  },
  year: {
    key: 'year',
    label: 'Year',
    kind: 'text',
    required: false,
  },
  semester: {
    key: 'semester',
    label: 'Semester',
    kind: 'select',
    required: false,
    options: [{ value: 'first-semester', label: 'First semester' }, { value: 'second-semester', label: 'Second semester' }],
  },
  fileFormat: {
    key: 'fileFormat',
    label: 'Format',
    kind: 'select',
    required: false,
    options: [{ value: 'printed', label: 'Printed' }, { value: 'pdf', label: 'PDF' }, { value: 'word', label: 'Word' }, { value: 'slides', label: 'Slides' }, { value: 'handwritten-scan', label: 'Handwritten scan' }],
  },
  questionCount: {
    key: 'questionCount',
    label: 'Questions',
    kind: 'number',
    required: false,
  },
  roomType: {
    key: 'roomType',
    label: 'Room type',
    kind: 'select',
    required: false,
    options: [{ value: 'bedspace', label: 'Bedspace' }, { value: 'shared-room', label: 'Shared room' }, { value: 'single-room', label: 'Single room' }, { value: 'self-contain', label: 'Self-contain' }, { value: '1-bedroom', label: '1 bedroom' }, { value: '2-bedrooms', label: '2+ bedrooms' }],
  },
  bedrooms: {
    key: 'bedrooms',
    label: 'Bedrooms',
    kind: 'number',
    required: false,
  },
  furnished: {
    key: 'furnished',
    label: 'Furnishing',
    kind: 'select',
    required: false,
    options: [{ value: 'furnished', label: 'Furnished' }, { value: 'part-furnished', label: 'Part furnished' }, { value: 'unfurnished', label: 'Unfurnished' }],
  },
  utilities: {
    key: 'utilities',
    label: 'Utilities',
    kind: 'select',
    required: false,
    options: [{ value: 'included', label: 'Included' }, { value: 'not-included', label: 'Not included' }, { value: 'some-included', label: 'Some included' }],
  },
  rentPeriod: {
    key: 'rentPeriod',
    label: 'Rent period',
    kind: 'select',
    required: false,
    options: [{ value: 'per-night', label: 'Per night' }, { value: 'per-week', label: 'Per week' }, { value: 'per-month', label: 'Per month' }, { value: 'per-semester', label: 'Per semester' }, { value: 'per-session', label: 'Per session' }],
  },
  distanceToCampus: {
    key: 'distanceToCampus',
    label: 'Distance to campus',
    kind: 'select',
    required: false,
    options: [{ value: 'on-campus', label: 'On campus' }, { value: 'under-10-minutes-walk', label: 'Under 10 minutes walk' }, { value: '10-30-minutes-walk', label: '10-30 minutes walk' }, { value: 'needs-transport', label: 'Needs transport' }],
  },
  gender: {
    key: 'gender',
    label: 'Preferred gender',
    kind: 'select',
    required: false,
    options: [{ value: 'any', label: 'Any' }, { value: 'female', label: 'Female' }, { value: 'male', label: 'Male' }],
  },
  clothingSize: {
    key: 'clothingSize',
    label: 'Size',
    kind: 'select',
    required: false,
    options: [{ value: 'xs', label: 'XS' }, { value: 's', label: 'S' }, { value: 'm', label: 'M' }, { value: 'l', label: 'L' }, { value: 'xl', label: 'XL' }, { value: 'xxl', label: 'XXL' }, { value: 'custom-made-to-measure', label: 'Custom / made to measure' }],
  },
  hairType: {
    key: 'hairType',
    label: 'Hair type',
    kind: 'text',
    required: false,
  },
  hairLength: {
    key: 'hairLength',
    label: 'Length',
    kind: 'text',
    required: false,
  },
  serviceMode: {
    key: 'serviceMode',
    label: 'How it is delivered',
    kind: 'select',
    required: false,
    options: [{ value: 'in-person', label: 'In person' }, { value: 'online', label: 'Online' }, { value: 'either', label: 'Either' }],
  },
  serviceArea: {
    key: 'serviceArea',
    label: 'Where you serve',
    kind: 'text',
    required: false,
  },
  dietary: {
    key: 'dietary',
    label: 'Dietary',
    kind: 'select',
    required: false,
    options: [{ value: 'no-restriction', label: 'No restriction' }, { value: 'vegetarian', label: 'Vegetarian' }, { value: 'halal', label: 'Halal' }, { value: 'gluten-free', label: 'Gluten free' }],
  },
  portionSize: {
    key: 'portionSize',
    label: 'Portion',
    kind: 'select',
    required: false,
    options: [{ value: 'single', label: 'Single' }, { value: 'two-people', label: 'Two people' }, { value: 'family-group', label: 'Family / group' }, { value: 'bulk-order', label: 'Bulk order' }],
  },
  eventDate: {
    key: 'eventDate',
    label: 'Date',
    kind: 'date',
    required: false,
  },
  venue: {
    key: 'venue',
    label: 'Venue',
    kind: 'text',
    required: false,
  },
  ticketQuantity: {
    key: 'ticketQuantity',
    label: 'Tickets available',
    kind: 'number',
    required: false,
  },
  capacity: {
    key: 'capacity',
    label: 'Capacity',
    kind: 'number',
    required: false,
  },
  rentalPeriod: {
    key: 'rentalPeriod',
    label: 'Rental period',
    kind: 'select',
    required: false,
    options: [{ value: 'per-hour', label: 'Per hour' }, { value: 'per-day', label: 'Per day' }, { value: 'per-week', label: 'Per week' }, { value: 'per-month', label: 'Per month' }, { value: 'per-semester', label: 'Per semester' }],
  },
  mileage: {
    key: 'mileage',
    label: 'Mileage',
    kind: 'text',
    required: false,
  },
  engineCapacity: {
    key: 'engineCapacity',
    label: 'Engine size',
    kind: 'text',
    required: false,
  },
};

/** Build a leaf's attribute list, marking the ones the form requires. */
function attrs(
  spec: ReadonlyArray<{ key: TaxonomyAttributeKey; required?: boolean }>,
): readonly TaxonomyAttribute[] {
  return spec.map(({ key, required }) => ({
    ...TAXONOMY_ATTRIBUTE_DEFS[key],
    required: required === true,
  }));
}

export const TAXONOMY_NODES: readonly TaxonomyNode[] = [
  {
    id: 'electronics',
    parentId: null,
    department: 'electronics',
    label: 'Phones, Computers & Electronics',
    summary: 'Phones, Computers & Electronics',
    description: 'Browse phones, computers & electronics on your campus.',
    examples: [],
    keywords: ['phones', 'computers', 'electronics'],
    icon: 'phone',
  },
  {
    id: 'electronics.phones-tablets',
    parentId: 'electronics',
    department: 'electronics',
    label: 'Phones & Tablets',
    summary: 'Phones & Tablets',
    description: 'Phones & Tablets in Phones, Computers & Electronics.',
    examples: [],
    keywords: ['phones', 'tablets', 'computers', 'electronics'],
    icon: 'phone',
  },
  {
    id: 'electronics.phones-tablets.smartphones',
    parentId: 'electronics.phones-tablets',
    department: 'electronics',
    label: 'Smartphones',
    summary: 'Smartphones',
    description: 'Smartphones — listed under Phones & Tablets.',
    examples: [],
    keywords: ['smartphones', 'phones', 'tablets', 'laptop', 'phone', 'iphone', 'samsung', 'earpod', 'earpiece', 'power'],
    phrases: ['for sale'],
    icon: 'phone',
    listingCategory: 'electronics',
    publishFlow: 'listing',
    attributes: attrs([{ key: 'condition', required: true }, { key: 'brand', required: true }, { key: 'model' }, { key: 'storage' }, { key: 'ram' }, { key: 'warranty' }, { key: 'delivery', required: true }, { key: 'priceBand' }]),
    weight: 1.1,
  },
  {
    id: 'electronics.phones-tablets.feature-phones',
    parentId: 'electronics.phones-tablets',
    department: 'electronics',
    label: 'Feature phones',
    summary: 'Feature phones',
    description: 'Feature phones — listed under Phones & Tablets.',
    examples: [],
    keywords: ['feature', 'phones', 'tablets'],
    icon: 'phone',
    listingCategory: 'electronics',
    publishFlow: 'listing',
    attributes: attrs([{ key: 'condition', required: true }, { key: 'brand', required: true }, { key: 'model' }, { key: 'storage' }, { key: 'ram' }, { key: 'warranty' }, { key: 'delivery', required: true }, { key: 'priceBand' }]),
  },
  {
    id: 'electronics.phones-tablets.tablets-ereaders',
    parentId: 'electronics.phones-tablets',
    department: 'electronics',
    label: 'Tablets & e-readers',
    summary: 'Tablets & e-readers',
    description: 'Tablets & e-readers — listed under Phones & Tablets.',
    examples: [],
    keywords: ['tablets', 'readers', 'phones'],
    icon: 'phone',
    listingCategory: 'electronics',
    publishFlow: 'listing',
    attributes: attrs([{ key: 'condition', required: true }, { key: 'brand', required: true }, { key: 'model' }, { key: 'storage' }, { key: 'ram' }, { key: 'warranty' }, { key: 'delivery', required: true }, { key: 'priceBand' }]),
  },
  {
    id: 'electronics.phones-tablets.phone-accessories',
    parentId: 'electronics.phones-tablets',
    department: 'electronics',
    label: 'Phone cases, chargers & accessories',
    summary: 'Phone cases, chargers & accessories',
    description: 'Phone cases, chargers & accessories — listed under Phones & Tablets.',
    examples: [],
    keywords: ['phone', 'cases', 'chargers', 'accessories', 'phones', 'tablets'],
    icon: 'phone',
    listingCategory: 'electronics',
    publishFlow: 'listing',
    attributes: attrs([{ key: 'condition', required: true }, { key: 'brand' }, { key: 'colour' }, { key: 'delivery', required: true }, { key: 'priceBand' }]),
  },
  {
    id: 'electronics.computers',
    parentId: 'electronics',
    department: 'electronics',
    label: 'Computers & Laptops',
    summary: 'Computers & Laptops',
    description: 'Computers & Laptops in Phones, Computers & Electronics.',
    examples: [],
    keywords: ['computers', 'laptops', 'phones', 'electronics'],
    icon: 'phone',
  },
  {
    id: 'electronics.computers.laptops',
    parentId: 'electronics.computers',
    department: 'electronics',
    label: 'Laptops',
    summary: 'Laptops',
    description: 'Laptops — listed under Computers & Laptops.',
    examples: [],
    keywords: ['laptops', 'computers'],
    icon: 'phone',
    listingCategory: 'electronics',
    publishFlow: 'listing',
    attributes: attrs([{ key: 'condition', required: true }, { key: 'brand', required: true }, { key: 'model' }, { key: 'storage' }, { key: 'ram' }, { key: 'warranty' }, { key: 'delivery', required: true }, { key: 'priceBand' }]),
  },
  {
    id: 'electronics.computers.desktops-monitors',
    parentId: 'electronics.computers',
    department: 'electronics',
    label: 'Desktops & monitors',
    summary: 'Desktops & monitors',
    description: 'Desktops & monitors — listed under Computers & Laptops.',
    examples: [],
    keywords: ['desktops', 'monitors', 'computers', 'laptops'],
    icon: 'phone',
    listingCategory: 'electronics',
    publishFlow: 'listing',
    attributes: attrs([{ key: 'condition', required: true }, { key: 'brand', required: true }, { key: 'model' }, { key: 'storage' }, { key: 'ram' }, { key: 'warranty' }, { key: 'delivery', required: true }, { key: 'priceBand' }]),
  },
  {
    id: 'electronics.computers.computer-accessories',
    parentId: 'electronics.computers',
    department: 'electronics',
    label: 'Keyboards, mice & hubs',
    summary: 'Keyboards, mice & hubs',
    description: 'Keyboards, mice & hubs — listed under Computers & Laptops.',
    examples: [],
    keywords: ['keyboards', 'mice', 'hubs', 'computers', 'laptops'],
    icon: 'phone',
    listingCategory: 'electronics',
    publishFlow: 'listing',
    attributes: attrs([{ key: 'condition', required: true }, { key: 'brand' }, { key: 'colour' }, { key: 'delivery', required: true }, { key: 'priceBand' }]),
  },
  {
    id: 'electronics.computers.storage-drives',
    parentId: 'electronics.computers',
    department: 'electronics',
    label: 'Flash drives & external storage',
    summary: 'Flash drives & external storage',
    description: 'Flash drives & external storage — listed under Computers & Laptops.',
    examples: [],
    keywords: ['flash', 'drives', 'external', 'storage', 'computers', 'laptops'],
    icon: 'phone',
    listingCategory: 'electronics',
    publishFlow: 'listing',
    attributes: attrs([{ key: 'condition', required: true }, { key: 'brand' }, { key: 'colour' }, { key: 'delivery', required: true }, { key: 'priceBand' }]),
  },
  {
    id: 'electronics.audio-power-gadgets',
    parentId: 'electronics',
    department: 'electronics',
    label: 'Audio, Power & Gadgets',
    summary: 'Audio, Power & Gadgets',
    description: 'Audio, Power & Gadgets in Phones, Computers & Electronics.',
    examples: [],
    keywords: ['audio', 'power', 'gadgets', 'phones', 'computers', 'electronics'],
    icon: 'phone',
  },
  {
    id: 'electronics.audio-power-gadgets.headphones-speakers',
    parentId: 'electronics.audio-power-gadgets',
    department: 'electronics',
    label: 'Headphones & speakers',
    summary: 'Headphones & speakers',
    description: 'Headphones & speakers — listed under Audio, Power & Gadgets.',
    examples: [],
    keywords: ['headphones', 'speakers', 'audio', 'power', 'gadgets'],
    icon: 'phone',
    listingCategory: 'electronics',
    publishFlow: 'listing',
    attributes: attrs([{ key: 'condition', required: true }, { key: 'brand', required: true }, { key: 'model' }, { key: 'storage' }, { key: 'ram' }, { key: 'warranty' }, { key: 'delivery', required: true }, { key: 'priceBand' }]),
  },
  {
    id: 'electronics.audio-power-gadgets.power-banks-inverters',
    parentId: 'electronics.audio-power-gadgets',
    department: 'electronics',
    label: 'Power banks, inverters & rechargeable lamps',
    summary: 'Power banks, inverters & rechargeable lamps',
    description: 'Power banks, inverters & rechargeable lamps — listed under Audio, Power & Gadgets.',
    examples: [],
    keywords: ['power', 'banks', 'inverters', 'rechargeable', 'lamps', 'audio', 'gadgets'],
    icon: 'phone',
    listingCategory: 'electronics',
    publishFlow: 'listing',
    attributes: attrs([{ key: 'condition', required: true }, { key: 'brand', required: true }, { key: 'model' }, { key: 'storage' }, { key: 'ram' }, { key: 'warranty' }, { key: 'delivery', required: true }, { key: 'priceBand' }]),
  },
  {
    id: 'electronics.audio-power-gadgets.smartwatches-wearables',
    parentId: 'electronics.audio-power-gadgets',
    department: 'electronics',
    label: 'Smartwatches & wearables',
    summary: 'Smartwatches & wearables',
    description: 'Smartwatches & wearables — listed under Audio, Power & Gadgets.',
    examples: [],
    keywords: ['smartwatches', 'wearables', 'audio', 'power', 'gadgets'],
    icon: 'phone',
    listingCategory: 'electronics',
    publishFlow: 'listing',
    attributes: attrs([{ key: 'condition', required: true }, { key: 'brand', required: true }, { key: 'model' }, { key: 'storage' }, { key: 'ram' }, { key: 'warranty' }, { key: 'delivery', required: true }, { key: 'priceBand' }]),
  },
  {
    id: 'electronics.audio-power-gadgets.cameras-gadgets',
    parentId: 'electronics.audio-power-gadgets',
    department: 'electronics',
    label: 'Cameras & other gadgets',
    summary: 'Cameras & other gadgets',
    description: 'Cameras & other gadgets — listed under Audio, Power & Gadgets.',
    examples: [],
    keywords: ['cameras', 'gadgets', 'audio', 'power'],
    icon: 'phone',
    listingCategory: 'electronics',
    publishFlow: 'listing',
    attributes: attrs([{ key: 'condition', required: true }, { key: 'brand', required: true }, { key: 'model' }, { key: 'storage' }, { key: 'ram' }, { key: 'warranty' }, { key: 'delivery', required: true }, { key: 'priceBand' }]),
  },
  {
    id: 'study-materials',
    parentId: null,
    department: 'study-materials',
    label: 'Books & Study Materials',
    summary: 'Books & Study Materials',
    description: 'Browse books & study materials on your campus.',
    examples: [],
    keywords: ['books', 'study', 'materials'],
    icon: 'book',
  },
  {
    id: 'study-materials.textbooks',
    parentId: 'study-materials',
    department: 'study-materials',
    label: 'Textbooks & Course Books',
    summary: 'Textbooks & Course Books',
    description: 'Textbooks & Course Books in Books & Study Materials.',
    examples: [],
    keywords: ['textbooks', 'course', 'books', 'study', 'materials'],
    icon: 'book',
  },
  {
    id: 'study-materials.textbooks.course-textbook',
    parentId: 'study-materials.textbooks',
    department: 'study-materials',
    label: 'Course textbook',
    summary: 'Course textbook',
    description: 'Course textbook — listed under Textbooks & Course Books.',
    examples: [],
    keywords: ['course', 'textbook', 'textbooks', 'books', 'text', 'book', 'hardback', 'paperback', 'mcgraw', 'pearson'],
    phrases: ['course textbook', 'prescribed text', 'recommended text', '7th edition', '8th edition'],
    negativeKeywords: ['notes', 'photocopy', 'pq', 'past question', 'question bank', 'study pack'],
    icon: 'book',
    listingCategory: 'textbook_exchange',
    publishFlow: 'listing',
    attributes: attrs([{ key: 'condition', required: true }, { key: 'isbn' }, { key: 'edition' }, { key: 'courseCode' }, { key: 'level' }, { key: 'delivery', required: true }, { key: 'priceBand' }]),
    weight: 1.1,
  },
  {
    id: 'study-materials.textbooks.solutions-manual',
    parentId: 'study-materials.textbooks',
    department: 'study-materials',
    label: 'Solutions manual',
    summary: 'Solutions manual',
    description: 'Solutions manual — listed under Textbooks & Course Books.',
    examples: [],
    keywords: ['solutions', 'manual', 'textbooks', 'course', 'books', 'solution', 'worked', 'answers', 'answer', 'key'],
    phrases: ['solutions manual', 'solution manual', 'instructor solutions'],
    icon: 'book',
    listingCategory: 'textbook_exchange',
    publishFlow: 'listing',
    attributes: attrs([{ key: 'condition', required: true }, { key: 'isbn' }, { key: 'edition' }, { key: 'courseCode' }, { key: 'level' }, { key: 'delivery', required: true }, { key: 'priceBand' }]),
  },
  {
    id: 'study-materials.textbooks.lab-manual-workbook',
    parentId: 'study-materials.textbooks',
    department: 'study-materials',
    label: 'Lab manual or workbook',
    summary: 'Lab manual or workbook',
    description: 'Lab manual or workbook — listed under Textbooks & Course Books.',
    examples: [],
    keywords: ['lab', 'manual', 'workbook', 'textbooks', 'course', 'books', 'practical', 'work', 'book'],
    phrases: ['lab manual', 'practical manual', 'practical workbook'],
    icon: 'book',
    listingCategory: 'textbook_exchange',
    publishFlow: 'listing',
    attributes: attrs([{ key: 'condition', required: true }, { key: 'isbn' }, { key: 'edition' }, { key: 'courseCode' }, { key: 'level' }, { key: 'delivery', required: true }, { key: 'priceBand' }]),
  },
  {
    id: 'study-materials.textbooks.general-reading-books',
    parentId: 'study-materials.textbooks',
    department: 'study-materials',
    label: 'General & leisure reading',
    summary: 'General & leisure reading',
    description: 'General & leisure reading — listed under Textbooks & Course Books.',
    examples: [],
    keywords: ['general', 'leisure', 'reading', 'textbooks', 'course', 'books'],
    icon: 'book',
    listingCategory: 'textbook_exchange',
    publishFlow: 'listing',
    attributes: attrs([{ key: 'condition', required: true }, { key: 'isbn' }, { key: 'edition' }, { key: 'delivery', required: true }, { key: 'priceBand' }]),
  },
  {
    id: 'study-materials.notes-handouts',
    parentId: 'study-materials',
    department: 'study-materials',
    label: 'Notes & Handouts',
    summary: 'Notes & Handouts',
    description: 'Notes & Handouts in Books & Study Materials.',
    examples: [],
    keywords: ['notes', 'handouts', 'books', 'study', 'materials'],
    icon: 'book',
  },
  {
    id: 'study-materials.notes-handouts.lecture-notes',
    parentId: 'study-materials.notes-handouts',
    department: 'study-materials',
    label: 'Lecture notes',
    summary: 'Lecture notes',
    description: 'Lecture notes — listed under Notes & Handouts.',
    examples: [],
    keywords: ['lecture', 'notes', 'handouts', 'class', 'typed', 'handwritten', 'slides', 'handout'],
    phrases: ['lecture notes', 'class notes', 'typed notes'],
    negativeKeywords: ['question bank', 'study pack', 'past question', 'textbook'],
    icon: 'book',
    listingCategory: 'lecture_notes',
    publishFlow: 'listing',
    attributes: attrs([{ key: 'courseCode', required: true }, { key: 'level' }, { key: 'year' }, { key: 'semester' }, { key: 'fileFormat', required: true }, { key: 'delivery' }, { key: 'priceBand' }]),
    weight: 1.15,
  },
  {
    id: 'study-materials.notes-handouts.tutorial-handouts',
    parentId: 'study-materials.notes-handouts',
    department: 'study-materials',
    label: 'Tutorial handouts',
    summary: 'Tutorial handouts',
    description: 'Tutorial handouts — listed under Notes & Handouts.',
    examples: [],
    keywords: ['tutorial', 'handouts', 'notes', 'handout', 'worksheet', 'recitation'],
    phrases: ['tutorial sheet', 'tutorial notes', 'worked examples'],
    icon: 'book',
    listingCategory: 'lecture_notes',
    publishFlow: 'listing',
    attributes: attrs([{ key: 'courseCode', required: true }, { key: 'level' }, { key: 'year' }, { key: 'semester' }, { key: 'fileFormat', required: true }, { key: 'delivery' }, { key: 'priceBand' }]),
  },
  {
    id: 'study-materials.notes-handouts.summary-guides',
    parentId: 'study-materials.notes-handouts',
    department: 'study-materials',
    label: 'Summaries & revision guides',
    summary: 'Summaries & revision guides',
    description: 'Summaries & revision guides — listed under Notes & Handouts.',
    examples: [],
    keywords: ['summaries', 'revision', 'guides', 'notes', 'handouts'],
    icon: 'book',
    listingCategory: 'lecture_notes',
    publishFlow: 'listing',
    attributes: attrs([{ key: 'courseCode', required: true }, { key: 'level' }, { key: 'year' }, { key: 'semester' }, { key: 'fileFormat', required: true }, { key: 'delivery' }, { key: 'priceBand' }]),
  },
  {
    id: 'study-materials.past-questions',
    parentId: 'study-materials',
    department: 'study-materials',
    label: 'Past Questions',
    summary: 'Past Questions',
    description: 'Past Questions in Books & Study Materials.',
    examples: [],
    keywords: ['past', 'questions', 'books', 'study', 'materials'],
    icon: 'book',
  },
  {
    id: 'study-materials.past-questions.printed-past-questions',
    parentId: 'study-materials.past-questions',
    department: 'study-materials',
    label: 'Printed or PDF past questions',
    summary: 'Printed or PDF past questions',
    description: 'Printed or PDF past questions — listed under Past Questions.',
    examples: [],
    keywords: ['printed', 'pdf', 'past', 'questions', 'question', 'pqs', 'exam', 'paper', 'papers', 'midterm'],
    phrases: ['past questions', 'past question', 'exam papers', 'pq bank', 'marking scheme'],
    negativeKeywords: ['question bank', 'takeable', 'study pack'],
    icon: 'book',
    listingCategory: 'pq_bank',
    publishFlow: 'listing',
    attributes: attrs([{ key: 'courseCode', required: true }, { key: 'level' }, { key: 'year', required: true }, { key: 'semester' }, { key: 'fileFormat', required: true }, { key: 'delivery' }, { key: 'priceBand' }]),
    weight: 1.2,
  },
  {
    id: 'study-materials.past-questions.marking-schemes',
    parentId: 'study-materials.past-questions',
    department: 'study-materials',
    label: 'Marking schemes & worked answers',
    summary: 'Marking schemes & worked answers',
    description: 'Marking schemes & worked answers — listed under Past Questions.',
    examples: [],
    keywords: ['marking', 'schemes', 'worked', 'answers', 'past', 'questions'],
    icon: 'book',
    listingCategory: 'pq_bank',
    publishFlow: 'listing',
    attributes: attrs([{ key: 'courseCode', required: true }, { key: 'level' }, { key: 'year', required: true }, { key: 'semester' }, { key: 'fileFormat', required: true }, { key: 'delivery' }, { key: 'priceBand' }]),
  },
  {
    id: 'study-materials.past-questions.entrance-exam-prep',
    parentId: 'study-materials.past-questions',
    department: 'study-materials',
    label: 'JAMB, Post-UTME & entrance prep',
    summary: 'JAMB, Post-UTME & entrance prep',
    description: 'JAMB, Post-UTME & entrance prep — listed under Past Questions.',
    examples: [],
    keywords: ['jamb', 'post', 'utme', 'entrance', 'prep', 'past', 'questions'],
    icon: 'book',
    listingCategory: 'pq_bank',
    publishFlow: 'listing',
    attributes: attrs([{ key: 'courseCode', required: true }, { key: 'level' }, { key: 'year', required: true }, { key: 'semester' }, { key: 'fileFormat', required: true }, { key: 'delivery' }, { key: 'priceBand' }]),
  },
  {
    id: 'study-materials.lantern-digital',
    parentId: 'study-materials',
    department: 'study-materials',
    label: 'Lantern Digital Study Products',
    summary: 'Lantern Digital Study Products',
    description: 'Lantern Digital Study Products in Books & Study Materials.',
    examples: [],
    keywords: ['lantern', 'digital', 'study', 'products', 'books', 'materials'],
    icon: 'book',
  },
  {
    id: 'study-materials.lantern-digital.lantern-question-bank',
    parentId: 'study-materials.lantern-digital',
    department: 'study-materials',
    label: 'Lantern question bank',
    summary: 'Lantern question bank',
    description: 'Lantern question bank — listed under Lantern Digital Study Products.',
    examples: [],
    keywords: ['lantern', 'question', 'bank', 'digital', 'study', 'products', 'mcq', 'practice', 'test', 'takeable'],
    phrases: ['question bank', 'practice test', 'mcq bank'],
    negativeKeywords: ['printed', 'hardcopy', 'photocopy'],
    icon: 'book',
    listingCategory: 'pq_bank',
    publishFlow: 'question_bank',
    attributes: attrs([{ key: 'courseCode', required: true }, { key: 'level' }, { key: 'questionCount' }, { key: 'year' }, { key: 'semester' }, { key: 'priceBand' }]),
    weight: 1.05,
  },
  {
    id: 'study-materials.lantern-digital.lantern-study-pack',
    parentId: 'study-materials.lantern-digital',
    department: 'study-materials',
    label: 'Lantern study pack',
    summary: 'Lantern study pack',
    description: 'Lantern study pack — listed under Lantern Digital Study Products.',
    examples: [],
    keywords: ['lantern', 'study', 'pack', 'digital', 'products', 'studypack', 'revision', 'complete'],
    phrases: ['study pack', 'revision pack'],
    icon: 'book',
    listingCategory: 'study_pack',
    publishFlow: 'study_pack',
    attributes: attrs([{ key: 'courseCode', required: true }, { key: 'level' }, { key: 'semester' }, { key: 'priceBand' }]),
    weight: 1.1,
  },
  {
    id: 'study-materials.projects-research',
    parentId: 'study-materials',
    department: 'study-materials',
    label: 'Projects, Thesis & Research',
    summary: 'Projects, Thesis & Research',
    description: 'Projects, Thesis & Research in Books & Study Materials.',
    examples: [],
    keywords: ['projects', 'thesis', 'research', 'books', 'study', 'materials'],
    icon: 'book',
  },
  {
    id: 'study-materials.projects-research.project-thesis-seminar',
    parentId: 'study-materials.projects-research',
    department: 'study-materials',
    label: 'Project, thesis or seminar',
    summary: 'Project, thesis or seminar',
    description: 'Project, thesis or seminar — listed under Projects, Thesis & Research.',
    examples: [],
    keywords: ['project', 'thesis', 'seminar', 'projects', 'research', 'dissertation', 'paper', 'chapter', 'one', 'fyp'],
    phrases: ['final year project', 'research project', 'seminar paper'],
    icon: 'book',
    listingCategory: 'project_thesis',
    publishFlow: 'listing',
    attributes: attrs([{ key: 'courseCode' }, { key: 'level' }, { key: 'year' }, { key: 'fileFormat', required: true }, { key: 'priceBand' }]),
    weight: 1.1,
  },
  {
    id: 'study-materials.projects-research.research-data-collection',
    parentId: 'study-materials.projects-research',
    department: 'study-materials',
    label: 'Data collection & fieldwork help',
    summary: 'Data collection & fieldwork help',
    description: 'Data collection & fieldwork help — listed under Projects, Thesis & Research.',
    examples: [],
    keywords: ['data', 'collection', 'fieldwork', 'help', 'projects', 'thesis', 'research', 'enumerator', 'questionnaire', 'survey'],
    phrases: ['data collection', 'fill questionnaire', 'survey respondents'],
    icon: 'book',
    listingCategory: 'data_collection',
    publishFlow: 'listing',
    attributes: attrs([{ key: 'serviceMode', required: true }, { key: 'serviceArea', required: true }, { key: 'distanceToCampus' }, { key: 'priceBand' }]),
  },
  {
    id: 'housing',
    parentId: null,
    department: 'housing',
    label: 'Housing & Hostel',
    summary: 'Housing & Hostel',
    description: 'Browse housing & hostel on your campus.',
    examples: [],
    keywords: ['housing', 'hostel'],
    icon: 'home',
  },
  {
    id: 'housing.rooms-rentals',
    parentId: 'housing',
    department: 'housing',
    label: 'Rooms & Rentals',
    summary: 'Rooms & Rentals',
    description: 'Rooms & Rentals in Housing & Hostel.',
    examples: [],
    keywords: ['rooms', 'rentals', 'housing', 'hostel'],
    icon: 'home',
  },
  {
    id: 'housing.rooms-rentals.hostel-bedspace',
    parentId: 'housing.rooms-rentals',
    department: 'housing',
    label: 'Hostel bedspace or shared room',
    summary: 'Hostel bedspace or shared room',
    description: 'Hostel bedspace or shared room — listed under Rooms & Rentals.',
    examples: [],
    keywords: ['hostel', 'bedspace', 'shared', 'room', 'rooms', 'rentals', 'bed', 'space', 'bunk', 'lodge'],
    phrases: ['bedspace', 'hostel room', 'self contain'],
    icon: 'home',
    listingCategory: 'accommodation',
    publishFlow: 'listing',
    attributes: attrs([{ key: 'roomType', required: true }, { key: 'bedrooms' }, { key: 'furnished', required: true }, { key: 'distanceToCampus', required: true }, { key: 'rentPeriod', required: true }, { key: 'utilities' }, { key: 'priceBand' }]),
    weight: 1.1,
  },
  {
    id: 'housing.rooms-rentals.self-contain-room',
    parentId: 'housing.rooms-rentals',
    department: 'housing',
    label: 'Self-contain or single room',
    summary: 'Self-contain or single room',
    description: 'Self-contain or single room — listed under Rooms & Rentals.',
    examples: [],
    keywords: ['self', 'contain', 'single', 'room', 'rooms', 'rentals'],
    icon: 'home',
    listingCategory: 'accommodation',
    publishFlow: 'listing',
    attributes: attrs([{ key: 'roomType', required: true }, { key: 'bedrooms' }, { key: 'furnished', required: true }, { key: 'distanceToCampus', required: true }, { key: 'rentPeriod', required: true }, { key: 'utilities' }, { key: 'priceBand' }]),
  },
  {
    id: 'housing.rooms-rentals.flat-apartment',
    parentId: 'housing.rooms-rentals',
    department: 'housing',
    label: 'Flat or apartment',
    summary: 'Flat or apartment',
    description: 'Flat or apartment — listed under Rooms & Rentals.',
    examples: [],
    keywords: ['flat', 'apartment', 'rooms', 'rentals', 'duplex', 'mini', 'bedroom', 'one'],
    phrases: ['bedroom flat', 'mini flat', 'two bedroom'],
    icon: 'home',
    listingCategory: 'accommodation',
    publishFlow: 'listing',
    attributes: attrs([{ key: 'roomType', required: true }, { key: 'bedrooms' }, { key: 'furnished', required: true }, { key: 'distanceToCampus', required: true }, { key: 'rentPeriod', required: true }, { key: 'utilities' }, { key: 'priceBand' }]),
    weight: 1.15,
  },
  {
    id: 'housing.rooms-rentals.short-let',
    parentId: 'housing.rooms-rentals',
    department: 'housing',
    label: 'Short let',
    summary: 'Short let',
    description: 'Short let — listed under Rooms & Rentals.',
    examples: [],
    keywords: ['short', 'let', 'rooms', 'rentals', 'shortlet', 'airbnb', 'exam', 'lodge', 'night', 'stay'],
    phrases: ['short let', 'short stay', 'exam period'],
    icon: 'home',
    listingCategory: 'accommodation',
    publishFlow: 'listing',
    attributes: attrs([{ key: 'roomType', required: true }, { key: 'bedrooms' }, { key: 'furnished', required: true }, { key: 'distanceToCampus', required: true }, { key: 'rentPeriod', required: true }, { key: 'utilities' }, { key: 'priceBand' }]),
  },
  {
    id: 'housing.roommates-sublets',
    parentId: 'housing',
    department: 'housing',
    label: 'Roommates & Sublets',
    summary: 'Roommates & Sublets',
    description: 'Roommates & Sublets in Housing & Hostel.',
    examples: [],
    keywords: ['roommates', 'sublets', 'housing', 'hostel'],
    icon: 'home',
  },
  {
    id: 'housing.roommates-sublets.roommate-wanted',
    parentId: 'housing.roommates-sublets',
    department: 'housing',
    label: 'Roommate wanted',
    summary: 'Roommate wanted',
    description: 'Roommate wanted — listed under Roommates & Sublets.',
    examples: [],
    keywords: ['roommate', 'wanted', 'roommates', 'sublets'],
    icon: 'home',
    listingCategory: 'accommodation',
    publishFlow: 'listing',
    attributes: attrs([{ key: 'roomType', required: true }, { key: 'gender', required: true }, { key: 'distanceToCampus', required: true }, { key: 'rentPeriod', required: true }, { key: 'priceBand' }]),
  },
  {
    id: 'housing.roommates-sublets.sublet-takeover',
    parentId: 'housing.roommates-sublets',
    department: 'housing',
    label: 'Sublet or rent takeover',
    summary: 'Sublet or rent takeover',
    description: 'Sublet or rent takeover — listed under Roommates & Sublets.',
    examples: [],
    keywords: ['sublet', 'rent', 'takeover', 'roommates', 'sublets'],
    icon: 'home',
    listingCategory: 'accommodation',
    publishFlow: 'listing',
    attributes: attrs([{ key: 'roomType', required: true }, { key: 'gender', required: true }, { key: 'distanceToCampus', required: true }, { key: 'rentPeriod', required: true }, { key: 'priceBand' }]),
  },
  {
    id: 'housing.hostel-furnishing',
    parentId: 'housing',
    department: 'housing',
    label: 'Hostel Furnishing & Home Items',
    summary: 'Hostel Furnishing & Home Items',
    description: 'Hostel Furnishing & Home Items in Housing & Hostel.',
    examples: [],
    keywords: ['hostel', 'furnishing', 'home', 'items', 'housing'],
    icon: 'home',
  },
  {
    id: 'housing.hostel-furnishing.mattresses-beds',
    parentId: 'housing.hostel-furnishing',
    department: 'housing',
    label: 'Mattresses & beds',
    summary: 'Mattresses & beds',
    description: 'Mattresses & beds — listed under Hostel Furnishing & Home Items.',
    examples: [],
    keywords: ['mattresses', 'beds', 'hostel', 'furnishing', 'home', 'items'],
    icon: 'home',
    listingCategory: 'personal_goods',
    publishFlow: 'listing',
    attributes: attrs([{ key: 'condition', required: true }, { key: 'brand' }, { key: 'colour' }, { key: 'delivery', required: true }, { key: 'priceBand' }]),
  },
  {
    id: 'housing.hostel-furnishing.furniture-shelving',
    parentId: 'housing.hostel-furnishing',
    department: 'housing',
    label: 'Furniture, wardrobes & shelving',
    summary: 'Furniture, wardrobes & shelving',
    description: 'Furniture, wardrobes & shelving — listed under Hostel Furnishing & Home Items.',
    examples: [],
    keywords: ['furniture', 'wardrobes', 'shelving', 'hostel', 'furnishing', 'home', 'items'],
    icon: 'home',
    listingCategory: 'personal_goods',
    publishFlow: 'listing',
    attributes: attrs([{ key: 'condition', required: true }, { key: 'brand' }, { key: 'colour' }, { key: 'delivery', required: true }, { key: 'priceBand' }]),
  },
  {
    id: 'housing.hostel-furnishing.kitchen-appliances',
    parentId: 'housing.hostel-furnishing',
    department: 'housing',
    label: 'Cookers, kettles & kitchen appliances',
    summary: 'Cookers, kettles & kitchen appliances',
    description: 'Cookers, kettles & kitchen appliances — listed under Hostel Furnishing & Home Items.',
    examples: [],
    keywords: ['cookers', 'kettles', 'kitchen', 'appliances', 'hostel', 'furnishing', 'home', 'items'],
    icon: 'home',
    listingCategory: 'personal_goods',
    publishFlow: 'listing',
    attributes: attrs([{ key: 'condition', required: true }, { key: 'brand' }, { key: 'colour' }, { key: 'delivery', required: true }, { key: 'priceBand' }]),
  },
  {
    id: 'housing.hostel-furnishing.beddings-curtains',
    parentId: 'housing.hostel-furnishing',
    department: 'housing',
    label: 'Beddings, rugs & curtains',
    summary: 'Beddings, rugs & curtains',
    description: 'Beddings, rugs & curtains — listed under Hostel Furnishing & Home Items.',
    examples: [],
    keywords: ['beddings', 'rugs', 'curtains', 'hostel', 'furnishing', 'home', 'items'],
    icon: 'home',
    listingCategory: 'personal_goods',
    publishFlow: 'listing',
    attributes: attrs([{ key: 'condition', required: true }, { key: 'brand' }, { key: 'colour' }, { key: 'delivery', required: true }, { key: 'priceBand' }]),
  },
  {
    id: 'housing.hostel-furnishing.fans-cooling',
    parentId: 'housing.hostel-furnishing',
    department: 'housing',
    label: 'Fans, coolers & lighting',
    summary: 'Fans, coolers & lighting',
    description: 'Fans, coolers & lighting — listed under Hostel Furnishing & Home Items.',
    examples: [],
    keywords: ['fans', 'coolers', 'lighting', 'hostel', 'furnishing', 'home', 'items'],
    icon: 'home',
    listingCategory: 'personal_goods',
    publishFlow: 'listing',
    attributes: attrs([{ key: 'condition', required: true }, { key: 'brand' }, { key: 'colour' }, { key: 'delivery', required: true }, { key: 'priceBand' }]),
  },
  {
    id: 'fashion-beauty',
    parentId: null,
    department: 'fashion-beauty',
    label: 'Fashion, Hair & Beauty',
    summary: 'Fashion, Hair & Beauty',
    description: 'Browse fashion, hair & beauty on your campus.',
    examples: [],
    keywords: ['fashion', 'hair', 'beauty'],
    icon: 'shirt',
  },
  {
    id: 'fashion-beauty.occasion-wear',
    parentId: 'fashion-beauty',
    department: 'fashion-beauty',
    label: 'Aso Ebi & Occasion Wear',
    summary: 'Aso Ebi & Occasion Wear',
    description: 'Aso Ebi & Occasion Wear in Fashion, Hair & Beauty.',
    examples: [],
    keywords: ['aso', 'ebi', 'occasion', 'wear', 'fashion', 'hair', 'beauty'],
    icon: 'shirt',
  },
  {
    id: 'fashion-beauty.occasion-wear.aso-ebi',
    parentId: 'fashion-beauty.occasion-wear',
    department: 'fashion-beauty',
    label: 'Aso ebi',
    summary: 'Aso ebi',
    description: 'Aso ebi — listed under Aso Ebi & Occasion Wear.',
    examples: [],
    keywords: ['aso', 'ebi', 'occasion', 'wear', 'asoebi', 'gele', 'lace', 'ankara', 'iro', 'buba'],
    phrases: ['aso ebi', 'asoebi', 'occasion wear'],
    icon: 'shirt',
    listingCategory: 'aso_ebi',
    publishFlow: 'listing',
    attributes: attrs([{ key: 'condition', required: true }, { key: 'clothingSize', required: true }, { key: 'gender', required: true }, { key: 'colour', required: true }, { key: 'eventDate' }, { key: 'delivery', required: true }, { key: 'priceBand' }]),
    weight: 1.25,
  },
  {
    id: 'fashion-beauty.occasion-wear.native-owambe-wear',
    parentId: 'fashion-beauty.occasion-wear',
    department: 'fashion-beauty',
    label: 'Native & owambe wear',
    summary: 'Native & owambe wear',
    description: 'Native & owambe wear — listed under Aso Ebi & Occasion Wear.',
    examples: [],
    keywords: ['native', 'owambe', 'wear', 'aso', 'ebi', 'occasion'],
    icon: 'shirt',
    listingCategory: 'aso_ebi',
    publishFlow: 'listing',
    attributes: attrs([{ key: 'condition', required: true }, { key: 'clothingSize', required: true }, { key: 'gender', required: true }, { key: 'colour', required: true }, { key: 'eventDate' }, { key: 'delivery', required: true }, { key: 'priceBand' }]),
  },
  {
    id: 'fashion-beauty.occasion-wear.graduation-wear',
    parentId: 'fashion-beauty.occasion-wear',
    department: 'fashion-beauty',
    label: 'Graduation & convocation wear',
    summary: 'Graduation & convocation wear',
    description: 'Graduation & convocation wear — listed under Aso Ebi & Occasion Wear.',
    examples: [],
    keywords: ['graduation', 'convocation', 'wear', 'aso', 'ebi', 'occasion'],
    icon: 'shirt',
    listingCategory: 'aso_ebi',
    publishFlow: 'listing',
    attributes: attrs([{ key: 'condition', required: true }, { key: 'clothingSize', required: true }, { key: 'gender', required: true }, { key: 'colour', required: true }, { key: 'eventDate' }, { key: 'delivery', required: true }, { key: 'priceBand' }]),
  },
  {
    id: 'fashion-beauty.occasion-wear.outfit-hire',
    parentId: 'fashion-beauty.occasion-wear',
    department: 'fashion-beauty',
    label: 'Outfit & gown hire',
    summary: 'Outfit & gown hire',
    description: 'Outfit & gown hire — listed under Aso Ebi & Occasion Wear.',
    examples: [],
    keywords: ['outfit', 'gown', 'hire', 'aso', 'ebi', 'occasion', 'wear'],
    icon: 'shirt',
    listingCategory: 'aso_ebi',
    publishFlow: 'listing',
    attributes: attrs([{ key: 'condition', required: true }, { key: 'clothingSize', required: true }, { key: 'gender', required: true }, { key: 'rentalPeriod', required: true }, { key: 'delivery', required: true }, { key: 'priceBand' }]),
  },
  {
    id: 'fashion-beauty.everyday-fashion',
    parentId: 'fashion-beauty',
    department: 'fashion-beauty',
    label: 'Everyday Wear',
    summary: 'Everyday Wear',
    description: 'Everyday Wear in Fashion, Hair & Beauty.',
    examples: [],
    keywords: ['everyday', 'wear', 'fashion', 'hair', 'beauty'],
    icon: 'shirt',
  },
  {
    id: 'fashion-beauty.everyday-fashion.womens-clothing',
    parentId: 'fashion-beauty.everyday-fashion',
    department: 'fashion-beauty',
    label: 'Women\'s clothing',
    summary: 'Women\'s clothing',
    description: 'Women\'s clothing — listed under Everyday Wear.',
    examples: [],
    keywords: ['women', 'clothing', 'everyday', 'wear', 'sneakers', 'shoes', 'dress', 'jeans', 'bag', 'clothes'],
    phrases: ['for sale'],
    negativeKeywords: ['aso ebi', 'asoebi', 'gele'],
    icon: 'shirt',
    listingCategory: 'aso_ebi',
    publishFlow: 'listing',
    attributes: attrs([{ key: 'condition', required: true }, { key: 'clothingSize', required: true }, { key: 'gender', required: true }, { key: 'colour' }, { key: 'brand' }, { key: 'delivery', required: true }, { key: 'priceBand' }]),
  },
  {
    id: 'fashion-beauty.everyday-fashion.mens-clothing',
    parentId: 'fashion-beauty.everyday-fashion',
    department: 'fashion-beauty',
    label: 'Men\'s clothing',
    summary: 'Men\'s clothing',
    description: 'Men\'s clothing — listed under Everyday Wear.',
    examples: [],
    keywords: ['men', 'clothing', 'everyday', 'wear'],
    icon: 'shirt',
    listingCategory: 'aso_ebi',
    publishFlow: 'listing',
    attributes: attrs([{ key: 'condition', required: true }, { key: 'clothingSize', required: true }, { key: 'gender', required: true }, { key: 'colour' }, { key: 'brand' }, { key: 'delivery', required: true }, { key: 'priceBand' }]),
  },
  {
    id: 'fashion-beauty.everyday-fashion.shoes-slippers',
    parentId: 'fashion-beauty.everyday-fashion',
    department: 'fashion-beauty',
    label: 'Shoes, sneakers & slippers',
    summary: 'Shoes, sneakers & slippers',
    description: 'Shoes, sneakers & slippers — listed under Everyday Wear.',
    examples: [],
    keywords: ['shoes', 'sneakers', 'slippers', 'everyday', 'wear'],
    icon: 'shirt',
    listingCategory: 'aso_ebi',
    publishFlow: 'listing',
    attributes: attrs([{ key: 'condition', required: true }, { key: 'clothingSize', required: true }, { key: 'gender', required: true }, { key: 'colour' }, { key: 'brand' }, { key: 'delivery', required: true }, { key: 'priceBand' }]),
  },
  {
    id: 'fashion-beauty.everyday-fashion.bags-jewellery',
    parentId: 'fashion-beauty.everyday-fashion',
    department: 'fashion-beauty',
    label: 'Bags, watches & jewellery',
    summary: 'Bags, watches & jewellery',
    description: 'Bags, watches & jewellery — listed under Everyday Wear.',
    examples: [],
    keywords: ['bags', 'watches', 'jewellery', 'everyday', 'wear'],
    icon: 'shirt',
    listingCategory: 'aso_ebi',
    publishFlow: 'listing',
    attributes: attrs([{ key: 'condition', required: true }, { key: 'clothingSize', required: true }, { key: 'gender', required: true }, { key: 'colour' }, { key: 'brand' }, { key: 'delivery', required: true }, { key: 'priceBand' }]),
  },
  {
    id: 'fashion-beauty.hair-beauty-products',
    parentId: 'fashion-beauty',
    department: 'fashion-beauty',
    label: 'Hair & Beauty Products',
    summary: 'Hair & Beauty Products',
    description: 'Hair & Beauty Products in Fashion, Hair & Beauty.',
    examples: [],
    keywords: ['hair', 'beauty', 'products', 'fashion'],
    icon: 'shirt',
  },
  {
    id: 'fashion-beauty.hair-beauty-products.wigs-hair-extensions',
    parentId: 'fashion-beauty.hair-beauty-products',
    department: 'fashion-beauty',
    label: 'Wigs & hair extensions',
    summary: 'Wigs & hair extensions',
    description: 'Wigs & hair extensions — listed under Hair & Beauty Products.',
    examples: [],
    keywords: ['wigs', 'hair', 'extensions', 'beauty', 'products'],
    icon: 'shirt',
    listingCategory: 'beauty_hair',
    publishFlow: 'listing',
    attributes: attrs([{ key: 'condition', required: true }, { key: 'brand' }, { key: 'hairType', required: true }, { key: 'hairLength', required: true }, { key: 'colour' }, { key: 'delivery', required: true }, { key: 'priceBand' }]),
  },
  {
    id: 'fashion-beauty.hair-beauty-products.skincare-cosmetics',
    parentId: 'fashion-beauty.hair-beauty-products',
    department: 'fashion-beauty',
    label: 'Skincare & cosmetics',
    summary: 'Skincare & cosmetics',
    description: 'Skincare & cosmetics — listed under Hair & Beauty Products.',
    examples: [],
    keywords: ['skincare', 'cosmetics', 'hair', 'beauty', 'products'],
    icon: 'shirt',
    listingCategory: 'beauty_hair',
    publishFlow: 'listing',
    attributes: attrs([{ key: 'condition', required: true }, { key: 'brand' }, { key: 'colour' }, { key: 'delivery', required: true }, { key: 'priceBand' }]),
  },
  {
    id: 'fashion-beauty.hair-beauty-products.perfumes-body-sprays',
    parentId: 'fashion-beauty.hair-beauty-products',
    department: 'fashion-beauty',
    label: 'Perfumes & body sprays',
    summary: 'Perfumes & body sprays',
    description: 'Perfumes & body sprays — listed under Hair & Beauty Products.',
    examples: [],
    keywords: ['perfumes', 'body', 'sprays', 'hair', 'beauty', 'products'],
    icon: 'shirt',
    listingCategory: 'beauty_hair',
    publishFlow: 'listing',
    attributes: attrs([{ key: 'condition', required: true }, { key: 'brand' }, { key: 'colour' }, { key: 'delivery', required: true }, { key: 'priceBand' }]),
  },
  {
    id: 'fashion-beauty.beauty-services',
    parentId: 'fashion-beauty',
    department: 'fashion-beauty',
    label: 'Hair & Beauty Services',
    summary: 'Hair & Beauty Services',
    description: 'Hair & Beauty Services in Fashion, Hair & Beauty.',
    examples: [],
    keywords: ['hair', 'beauty', 'services', 'fashion'],
    icon: 'shirt',
  },
  {
    id: 'fashion-beauty.beauty-services.hair-styling-braiding',
    parentId: 'fashion-beauty.beauty-services',
    department: 'fashion-beauty',
    label: 'Hair styling & braiding',
    summary: 'Hair styling & braiding',
    description: 'Hair styling & braiding — listed under Hair & Beauty Services.',
    examples: [],
    keywords: ['hair', 'styling', 'braiding', 'beauty', 'services'],
    icon: 'shirt',
    listingCategory: 'beauty_hair',
    publishFlow: 'listing',
    attributes: attrs([{ key: 'serviceMode', required: true }, { key: 'serviceArea' }, { key: 'distanceToCampus', required: true }, { key: 'hairType' }, { key: 'priceBand' }]),
  },
  {
    id: 'fashion-beauty.beauty-services.makeup-artist',
    parentId: 'fashion-beauty.beauty-services',
    department: 'fashion-beauty',
    label: 'Makeup artist',
    summary: 'Makeup artist',
    description: 'Makeup artist — listed under Hair & Beauty Services.',
    examples: [],
    keywords: ['makeup', 'artist', 'hair', 'beauty', 'services'],
    icon: 'shirt',
    listingCategory: 'beauty_hair',
    publishFlow: 'listing',
    attributes: attrs([{ key: 'serviceMode', required: true }, { key: 'serviceArea' }, { key: 'distanceToCampus', required: true }, { key: 'hairType' }, { key: 'priceBand' }]),
  },
  {
    id: 'fashion-beauty.beauty-services.nails-lashes',
    parentId: 'fashion-beauty.beauty-services',
    department: 'fashion-beauty',
    label: 'Nails & lashes',
    summary: 'Nails & lashes',
    description: 'Nails & lashes — listed under Hair & Beauty Services.',
    examples: [],
    keywords: ['nails', 'lashes', 'hair', 'beauty', 'services'],
    icon: 'shirt',
    listingCategory: 'beauty_hair',
    publishFlow: 'listing',
    attributes: attrs([{ key: 'serviceMode', required: true }, { key: 'serviceArea' }, { key: 'distanceToCampus', required: true }, { key: 'hairType' }, { key: 'priceBand' }]),
  },
  {
    id: 'fashion-beauty.beauty-services.barbing',
    parentId: 'fashion-beauty.beauty-services',
    department: 'fashion-beauty',
    label: 'Barbing & grooming',
    summary: 'Barbing & grooming',
    description: 'Barbing & grooming — listed under Hair & Beauty Services.',
    examples: [],
    keywords: ['barbing', 'grooming', 'hair', 'beauty', 'services'],
    icon: 'shirt',
    listingCategory: 'beauty_hair',
    publishFlow: 'listing',
    attributes: attrs([{ key: 'serviceMode', required: true }, { key: 'serviceArea' }, { key: 'distanceToCampus', required: true }, { key: 'hairType' }, { key: 'priceBand' }]),
  },
  {
    id: 'food-groceries',
    parentId: null,
    department: 'food-groceries',
    label: 'Food & Groceries',
    summary: 'Food & Groceries',
    description: 'Browse food & groceries on your campus.',
    examples: [],
    keywords: ['food', 'groceries'],
    icon: 'food',
  },
  {
    id: 'food-groceries.cooked-food',
    parentId: 'food-groceries',
    department: 'food-groceries',
    label: 'Cooked Food & Snacks',
    summary: 'Cooked Food & Snacks',
    description: 'Cooked Food & Snacks in Food & Groceries.',
    examples: [],
    keywords: ['cooked', 'food', 'snacks', 'groceries'],
    icon: 'food',
  },
  {
    id: 'food-groceries.cooked-food.home-cooked-meals',
    parentId: 'food-groceries.cooked-food',
    department: 'food-groceries',
    label: 'Home-cooked meals',
    summary: 'Home-cooked meals',
    description: 'Home-cooked meals — listed under Cooked Food & Snacks.',
    examples: [],
    keywords: ['home', 'cooked', 'meals', 'food', 'snacks'],
    icon: 'food',
    listingCategory: 'food_drink',
    publishFlow: 'listing',
    attributes: attrs([{ key: 'portionSize', required: true }, { key: 'dietary' }, { key: 'delivery', required: true }, { key: 'serviceArea' }, { key: 'priceBand' }]),
  },
  {
    id: 'food-groceries.cooked-food.snacks-small-chops',
    parentId: 'food-groceries.cooked-food',
    department: 'food-groceries',
    label: 'Snacks & small chops',
    summary: 'Snacks & small chops',
    description: 'Snacks & small chops — listed under Cooked Food & Snacks.',
    examples: [],
    keywords: ['snacks', 'small', 'chops', 'cooked', 'food'],
    icon: 'food',
    listingCategory: 'food_drink',
    publishFlow: 'listing',
    attributes: attrs([{ key: 'portionSize', required: true }, { key: 'dietary' }, { key: 'delivery', required: true }, { key: 'serviceArea' }, { key: 'priceBand' }]),
  },
  {
    id: 'food-groceries.cooked-food.drinks-smoothies',
    parentId: 'food-groceries.cooked-food',
    department: 'food-groceries',
    label: 'Drinks & smoothies',
    summary: 'Drinks & smoothies',
    description: 'Drinks & smoothies — listed under Cooked Food & Snacks.',
    examples: [],
    keywords: ['drinks', 'smoothies', 'cooked', 'food', 'snacks'],
    icon: 'food',
    listingCategory: 'food_drink',
    publishFlow: 'listing',
    attributes: attrs([{ key: 'portionSize', required: true }, { key: 'dietary' }, { key: 'delivery', required: true }, { key: 'serviceArea' }, { key: 'priceBand' }]),
  },
  {
    id: 'food-groceries.cooked-food.cakes-pastries',
    parentId: 'food-groceries.cooked-food',
    department: 'food-groceries',
    label: 'Cakes & pastries',
    summary: 'Cakes & pastries',
    description: 'Cakes & pastries — listed under Cooked Food & Snacks.',
    examples: [],
    keywords: ['cakes', 'pastries', 'cooked', 'food', 'snacks'],
    icon: 'food',
    listingCategory: 'food_drink',
    publishFlow: 'listing',
    attributes: attrs([{ key: 'portionSize', required: true }, { key: 'dietary' }, { key: 'delivery', required: true }, { key: 'serviceArea' }, { key: 'priceBand' }]),
  },
  {
    id: 'food-groceries.provisions',
    parentId: 'food-groceries',
    department: 'food-groceries',
    label: 'Provisions & Foodstuff',
    summary: 'Provisions & Foodstuff',
    description: 'Provisions & Foodstuff in Food & Groceries.',
    examples: [],
    keywords: ['provisions', 'foodstuff', 'food', 'groceries'],
    icon: 'food',
  },
  {
    id: 'food-groceries.provisions.raw-foodstuff',
    parentId: 'food-groceries.provisions',
    department: 'food-groceries',
    label: 'Raw foodstuff',
    summary: 'Raw foodstuff',
    description: 'Raw foodstuff — listed under Provisions & Foodstuff.',
    examples: [],
    keywords: ['raw', 'foodstuff', 'provisions'],
    icon: 'food',
    listingCategory: 'food_drink',
    publishFlow: 'listing',
    attributes: attrs([{ key: 'condition', required: true }, { key: 'brand' }, { key: 'portionSize', required: true }, { key: 'delivery', required: true }, { key: 'priceBand' }]),
  },
  {
    id: 'food-groceries.provisions.bulk-provisions',
    parentId: 'food-groceries.provisions',
    department: 'food-groceries',
    label: 'Bulk provisions & toiletries',
    summary: 'Bulk provisions & toiletries',
    description: 'Bulk provisions & toiletries — listed under Provisions & Foodstuff.',
    examples: [],
    keywords: ['bulk', 'provisions', 'toiletries', 'foodstuff'],
    icon: 'food',
    listingCategory: 'food_drink',
    publishFlow: 'listing',
    attributes: attrs([{ key: 'condition', required: true }, { key: 'brand' }, { key: 'portionSize', required: true }, { key: 'delivery', required: true }, { key: 'priceBand' }]),
  },
  {
    id: 'food-groceries.food-services',
    parentId: 'food-groceries',
    department: 'food-groceries',
    label: 'Meal Plans & Catering',
    summary: 'Meal Plans & Catering',
    description: 'Meal Plans & Catering in Food & Groceries.',
    examples: [],
    keywords: ['meal', 'plans', 'catering', 'food', 'groceries'],
    icon: 'food',
  },
  {
    id: 'food-groceries.food-services.meal-plan-subscription',
    parentId: 'food-groceries.food-services',
    department: 'food-groceries',
    label: 'Meal plan subscription',
    summary: 'Meal plan subscription',
    description: 'Meal plan subscription — listed under Meal Plans & Catering.',
    examples: [],
    keywords: ['meal', 'plan', 'subscription', 'plans', 'catering'],
    icon: 'food',
    listingCategory: 'food_drink',
    publishFlow: 'listing',
    attributes: attrs([{ key: 'rentPeriod', required: true }, { key: 'dietary' }, { key: 'delivery', required: true }, { key: 'serviceArea' }, { key: 'priceBand' }]),
  },
  {
    id: 'food-groceries.food-services.event-catering',
    parentId: 'food-groceries.food-services',
    department: 'food-groceries',
    label: 'Event catering',
    summary: 'Event catering',
    description: 'Event catering — listed under Meal Plans & Catering.',
    examples: [],
    keywords: ['event', 'catering', 'meal', 'plans'],
    icon: 'food',
    listingCategory: 'food_drink',
    publishFlow: 'listing',
    attributes: attrs([{ key: 'serviceMode', required: true }, { key: 'serviceArea' }, { key: 'capacity', required: true }, { key: 'priceBand' }]),
  },
  {
    id: 'services',
    parentId: null,
    department: 'services',
    label: 'Campus Services',
    summary: 'Campus Services',
    description: 'Browse campus services on your campus.',
    examples: [],
    keywords: ['campus', 'services'],
    icon: 'people',
  },
  {
    id: 'services.academic-services',
    parentId: 'services',
    department: 'services',
    label: 'Tutoring & Academic Help',
    summary: 'Tutoring & Academic Help',
    description: 'Tutoring & Academic Help in Campus Services.',
    examples: [],
    keywords: ['tutoring', 'academic', 'help', 'campus', 'services'],
    icon: 'people',
  },
  {
    id: 'services.academic-services.tutoring-lessons',
    parentId: 'services.academic-services',
    department: 'services',
    label: 'Tutoring & lessons',
    summary: 'Tutoring & lessons',
    description: 'Tutoring & lessons — listed under Tutoring & Academic Help.',
    examples: [],
    keywords: ['tutoring', 'lessons', 'academic', 'help', 'tutor', 'coaching', 'lesson', 'crash', 'course', 'home'],
    phrases: ['crash class', 'home lesson', 'need a tutor'],
    negativeKeywords: ['notes', 'textbook', 'past question'],
    icon: 'people',
    listingCategory: 'campus_services',
    publishFlow: 'listing',
    attributes: attrs([{ key: 'serviceMode', required: true }, { key: 'courseCode', required: true }, { key: 'level' }, { key: 'serviceArea' }, { key: 'priceBand' }]),
    weight: 1.1,
  },
  {
    id: 'services.academic-services.exam-prep-coaching',
    parentId: 'services.academic-services',
    department: 'services',
    label: 'Exam prep & coaching',
    summary: 'Exam prep & coaching',
    description: 'Exam prep & coaching — listed under Tutoring & Academic Help.',
    examples: [],
    keywords: ['exam', 'prep', 'coaching', 'tutoring', 'academic', 'help'],
    icon: 'people',
    listingCategory: 'campus_services',
    publishFlow: 'listing',
    attributes: attrs([{ key: 'serviceMode', required: true }, { key: 'courseCode', required: true }, { key: 'level' }, { key: 'serviceArea' }, { key: 'priceBand' }]),
  },
  {
    id: 'services.academic-services.language-lessons',
    parentId: 'services.academic-services',
    department: 'services',
    label: 'Language & skill lessons',
    summary: 'Language & skill lessons',
    description: 'Language & skill lessons — listed under Tutoring & Academic Help.',
    examples: [],
    keywords: ['language', 'skill', 'lessons', 'tutoring', 'academic', 'help'],
    icon: 'people',
    listingCategory: 'campus_services',
    publishFlow: 'listing',
    attributes: attrs([{ key: 'serviceMode', required: true }, { key: 'courseCode', required: true }, { key: 'level' }, { key: 'serviceArea' }, { key: 'priceBand' }]),
  },
  {
    id: 'services.print-design',
    parentId: 'services',
    department: 'services',
    label: 'Printing, Typing & Design',
    summary: 'Printing, Typing & Design',
    description: 'Printing, Typing & Design in Campus Services.',
    examples: [],
    keywords: ['printing', 'typing', 'design', 'campus', 'services'],
    icon: 'people',
  },
  {
    id: 'services.print-design.printing-photocopy',
    parentId: 'services.print-design',
    department: 'services',
    label: 'Printing & photocopy',
    summary: 'Printing & photocopy',
    description: 'Printing & photocopy — listed under Printing, Typing & Design.',
    examples: [],
    keywords: ['printing', 'photocopy', 'typing', 'design', 'binding', 'lamination', 'graphic', 'flex', 'banner'],
    phrases: ['photocopy', 'project typing'],
    icon: 'people',
    listingCategory: 'campus_services',
    publishFlow: 'listing',
    attributes: attrs([{ key: 'serviceMode', required: true }, { key: 'serviceArea' }, { key: 'distanceToCampus' }, { key: 'priceBand' }]),
  },
  {
    id: 'services.print-design.binding-lamination',
    parentId: 'services.print-design',
    department: 'services',
    label: 'Binding & lamination',
    summary: 'Binding & lamination',
    description: 'Binding & lamination — listed under Printing, Typing & Design.',
    examples: [],
    keywords: ['binding', 'lamination', 'printing', 'typing', 'design'],
    icon: 'people',
    listingCategory: 'campus_services',
    publishFlow: 'listing',
    attributes: attrs([{ key: 'serviceMode', required: true }, { key: 'serviceArea' }, { key: 'distanceToCampus' }, { key: 'priceBand' }]),
  },
  {
    id: 'services.print-design.typing-transcription',
    parentId: 'services.print-design',
    department: 'services',
    label: 'Typing & transcription',
    summary: 'Typing & transcription',
    description: 'Typing & transcription — listed under Printing, Typing & Design.',
    examples: [],
    keywords: ['typing', 'transcription', 'printing', 'design'],
    icon: 'people',
    listingCategory: 'campus_services',
    publishFlow: 'listing',
    attributes: attrs([{ key: 'serviceMode', required: true }, { key: 'serviceArea' }, { key: 'distanceToCampus' }, { key: 'priceBand' }]),
  },
  {
    id: 'services.print-design.graphics-design',
    parentId: 'services.print-design',
    department: 'services',
    label: 'Graphics & design',
    summary: 'Graphics & design',
    description: 'Graphics & design — listed under Printing, Typing & Design.',
    examples: [],
    keywords: ['graphics', 'design', 'printing', 'typing'],
    icon: 'people',
    listingCategory: 'campus_services',
    publishFlow: 'listing',
    attributes: attrs([{ key: 'serviceMode', required: true }, { key: 'serviceArea' }, { key: 'distanceToCampus' }, { key: 'priceBand' }]),
  },
  {
    id: 'services.tech-repairs',
    parentId: 'services',
    department: 'services',
    label: 'Tech & Repairs',
    summary: 'Tech & Repairs',
    description: 'Tech & Repairs in Campus Services.',
    examples: [],
    keywords: ['tech', 'repairs', 'campus', 'services'],
    icon: 'people',
  },
  {
    id: 'services.tech-repairs.phone-laptop-repair',
    parentId: 'services.tech-repairs',
    department: 'services',
    label: 'Phone & laptop repair',
    summary: 'Phone & laptop repair',
    description: 'Phone & laptop repair — listed under Tech & Repairs.',
    examples: [],
    keywords: ['phone', 'laptop', 'repair', 'tech', 'repairs'],
    icon: 'people',
    listingCategory: 'campus_services',
    publishFlow: 'listing',
    attributes: attrs([{ key: 'serviceMode', required: true }, { key: 'serviceArea' }, { key: 'distanceToCampus' }, { key: 'priceBand' }]),
  },
  {
    id: 'services.tech-repairs.software-web-help',
    parentId: 'services.tech-repairs',
    department: 'services',
    label: 'Software & web help',
    summary: 'Software & web help',
    description: 'Software & web help — listed under Tech & Repairs.',
    examples: [],
    keywords: ['software', 'web', 'help', 'tech', 'repairs'],
    icon: 'people',
    listingCategory: 'campus_services',
    publishFlow: 'listing',
    attributes: attrs([{ key: 'serviceMode', required: true }, { key: 'serviceArea' }, { key: 'distanceToCampus' }, { key: 'priceBand' }]),
  },
  {
    id: 'services.tech-repairs.device-setup-data',
    parentId: 'services.tech-repairs',
    department: 'services',
    label: 'Device setup & data services',
    summary: 'Device setup & data services',
    description: 'Device setup & data services — listed under Tech & Repairs.',
    examples: [],
    keywords: ['device', 'setup', 'data', 'services', 'tech', 'repairs'],
    icon: 'people',
    listingCategory: 'campus_services',
    publishFlow: 'listing',
    attributes: attrs([{ key: 'serviceMode', required: true }, { key: 'serviceArea' }, { key: 'distanceToCampus' }, { key: 'priceBand' }]),
  },
  {
    id: 'services.personal-services',
    parentId: 'services',
    department: 'services',
    label: 'Personal & Errand Services',
    summary: 'Personal & Errand Services',
    description: 'Personal & Errand Services in Campus Services.',
    examples: [],
    keywords: ['personal', 'errand', 'services', 'campus'],
    icon: 'people',
  },
  {
    id: 'services.personal-services.laundry-cleaning',
    parentId: 'services.personal-services',
    department: 'services',
    label: 'Laundry & cleaning',
    summary: 'Laundry & cleaning',
    description: 'Laundry & cleaning — listed under Personal & Errand Services.',
    examples: [],
    keywords: ['laundry', 'cleaning', 'personal', 'errand', 'services'],
    icon: 'people',
    listingCategory: 'campus_services',
    publishFlow: 'listing',
    attributes: attrs([{ key: 'serviceMode', required: true }, { key: 'serviceArea' }, { key: 'distanceToCampus' }, { key: 'priceBand' }]),
  },
  {
    id: 'services.personal-services.photography-videography',
    parentId: 'services.personal-services',
    department: 'services',
    label: 'Photography & videography',
    summary: 'Photography & videography',
    description: 'Photography & videography — listed under Personal & Errand Services.',
    examples: [],
    keywords: ['photography', 'videography', 'personal', 'errand', 'services'],
    icon: 'people',
    listingCategory: 'campus_services',
    publishFlow: 'listing',
    attributes: attrs([{ key: 'serviceMode', required: true }, { key: 'serviceArea' }, { key: 'distanceToCampus' }, { key: 'priceBand' }]),
  },
  {
    id: 'services.personal-services.errands-delivery',
    parentId: 'services.personal-services',
    department: 'services',
    label: 'Errands & delivery',
    summary: 'Errands & delivery',
    description: 'Errands & delivery — listed under Personal & Errand Services.',
    examples: [],
    keywords: ['errands', 'delivery', 'personal', 'errand', 'services'],
    icon: 'people',
    listingCategory: 'campus_services',
    publishFlow: 'listing',
    attributes: attrs([{ key: 'serviceMode', required: true }, { key: 'serviceArea' }, { key: 'distanceToCampus' }, { key: 'priceBand' }]),
  },
  {
    id: 'services.personal-services.other-services',
    parentId: 'services.personal-services',
    department: 'services',
    label: 'Other campus services',
    summary: 'Other campus services',
    description: 'Other campus services — listed under Personal & Errand Services.',
    examples: [],
    keywords: ['campus', 'services', 'personal', 'errand', 'repair', 'laundry', 'cleaning', 'service'],
    icon: 'people',
    listingCategory: 'campus_services',
    publishFlow: 'listing',
    attributes: attrs([{ key: 'serviceMode', required: true }, { key: 'serviceArea' }, { key: 'distanceToCampus' }, { key: 'priceBand' }]),
  },
  {
    id: 'transport',
    parentId: null,
    department: 'transport',
    label: 'Transport & Vehicles',
    summary: 'Transport & Vehicles',
    description: 'Browse transport & vehicles on your campus.',
    examples: [],
    keywords: ['transport', 'vehicles'],
    icon: 'car',
  },
  {
    id: 'transport.rides-trips',
    parentId: 'transport',
    department: 'transport',
    label: 'Rides & Trips',
    summary: 'Rides & Trips',
    description: 'Rides & Trips in Transport & Vehicles.',
    examples: [],
    keywords: ['rides', 'trips', 'transport', 'vehicles'],
    icon: 'car',
  },
  {
    id: 'transport.rides-trips.intercity-trip-seat',
    parentId: 'transport.rides-trips',
    department: 'transport',
    label: 'Intercity trip or seat',
    summary: 'Intercity trip or seat',
    description: 'Intercity trip or seat — listed under Rides & Trips.',
    examples: [],
    keywords: ['intercity', 'trip', 'seat', 'rides', 'trips', 'pickup', 'dropoff', 'drop', 'off', 'airport'],
    phrases: ['airport pickup', 'one seat', 'weekend trip'],
    negativeKeywords: ['tokunbo', 'for sale', 'lexus', 'corolla'],
    icon: 'car',
    listingCategory: 'travel_transport',
    publishFlow: 'listing',
    attributes: attrs([{ key: 'eventDate', required: true }, { key: 'venue', required: true }, { key: 'ticketQuantity', required: true }, { key: 'serviceArea' }, { key: 'priceBand' }]),
    weight: 1.1,
  },
  {
    id: 'transport.rides-trips.campus-shuttle-okada',
    parentId: 'transport.rides-trips',
    department: 'transport',
    label: 'Campus shuttle & okada runs',
    summary: 'Campus shuttle & okada runs',
    description: 'Campus shuttle & okada runs — listed under Rides & Trips.',
    examples: [],
    keywords: ['campus', 'shuttle', 'okada', 'runs', 'rides', 'trips'],
    icon: 'car',
    listingCategory: 'travel_transport',
    publishFlow: 'listing',
    attributes: attrs([{ key: 'eventDate', required: true }, { key: 'venue', required: true }, { key: 'ticketQuantity', required: true }, { key: 'serviceArea' }, { key: 'priceBand' }]),
  },
  {
    id: 'transport.vehicles-for-sale',
    parentId: 'transport',
    department: 'transport',
    label: 'Bikes, Keke & Cars',
    summary: 'Bikes, Keke & Cars',
    description: 'Bikes, Keke & Cars in Transport & Vehicles.',
    examples: [],
    keywords: ['bikes', 'keke', 'cars', 'transport', 'vehicles'],
    icon: 'car',
  },
  {
    id: 'transport.vehicles-for-sale.bicycles',
    parentId: 'transport.vehicles-for-sale',
    department: 'transport',
    label: 'Bicycles',
    summary: 'Bicycles',
    description: 'Bicycles — listed under Bikes, Keke & Cars.',
    examples: [],
    keywords: ['bicycles', 'bikes', 'keke', 'cars'],
    icon: 'car',
    listingCategory: 'travel_transport',
    publishFlow: 'listing',
    attributes: attrs([{ key: 'condition', required: true }, { key: 'brand' }, { key: 'colour' }, { key: 'delivery' }, { key: 'priceBand' }]),
  },
  {
    id: 'transport.vehicles-for-sale.motorcycles-keke',
    parentId: 'transport.vehicles-for-sale',
    department: 'transport',
    label: 'Motorcycles & keke',
    summary: 'Motorcycles & keke',
    description: 'Motorcycles & keke — listed under Bikes, Keke & Cars.',
    examples: [],
    keywords: ['motorcycles', 'keke', 'bikes', 'cars'],
    icon: 'car',
    listingCategory: 'travel_transport',
    publishFlow: 'listing',
    attributes: attrs([{ key: 'condition', required: true }, { key: 'brand' }, { key: 'year' }, { key: 'mileage' }, { key: 'engineCapacity' }, { key: 'delivery' }, { key: 'priceBand' }]),
  },
  {
    id: 'transport.vehicles-for-sale.cars',
    parentId: 'transport.vehicles-for-sale',
    department: 'transport',
    label: 'Cars',
    summary: 'Cars',
    description: 'Cars — listed under Bikes, Keke & Cars.',
    examples: [],
    keywords: ['cars', 'bikes', 'keke', 'bike', 'bicycle', 'motorcycle', 'okada', 'car', 'tokunbo', 'corolla'],
    phrases: ['for sale', 'tokunbo'],
    negativeKeywords: ['pickup', 'airport', 'seat'],
    icon: 'car',
    listingCategory: 'travel_transport',
    publishFlow: 'listing',
    attributes: attrs([{ key: 'condition', required: true }, { key: 'brand' }, { key: 'year' }, { key: 'mileage' }, { key: 'engineCapacity' }, { key: 'delivery' }, { key: 'priceBand' }]),
  },
  {
    id: 'transport.vehicle-parts-hire',
    parentId: 'transport',
    department: 'transport',
    label: 'Parts, Gear & Hire',
    summary: 'Parts, Gear & Hire',
    description: 'Parts, Gear & Hire in Transport & Vehicles.',
    examples: [],
    keywords: ['parts', 'gear', 'hire', 'transport', 'vehicles'],
    icon: 'car',
  },
  {
    id: 'transport.vehicle-parts-hire.helmets-riding-gear',
    parentId: 'transport.vehicle-parts-hire',
    department: 'transport',
    label: 'Helmets & riding gear',
    summary: 'Helmets & riding gear',
    description: 'Helmets & riding gear — listed under Parts, Gear & Hire.',
    examples: [],
    keywords: ['helmets', 'riding', 'gear', 'parts', 'hire'],
    icon: 'car',
    listingCategory: 'travel_transport',
    publishFlow: 'listing',
    attributes: attrs([{ key: 'condition', required: true }, { key: 'brand' }, { key: 'colour' }, { key: 'delivery' }, { key: 'priceBand' }]),
  },
  {
    id: 'transport.vehicle-parts-hire.spare-parts-accessories',
    parentId: 'transport.vehicle-parts-hire',
    department: 'transport',
    label: 'Spare parts & accessories',
    summary: 'Spare parts & accessories',
    description: 'Spare parts & accessories — listed under Parts, Gear & Hire.',
    examples: [],
    keywords: ['spare', 'parts', 'accessories', 'gear', 'hire'],
    icon: 'car',
    listingCategory: 'travel_transport',
    publishFlow: 'listing',
    attributes: attrs([{ key: 'condition', required: true }, { key: 'brand' }, { key: 'colour' }, { key: 'delivery' }, { key: 'priceBand' }]),
  },
  {
    id: 'transport.vehicle-parts-hire.vehicle-hire',
    parentId: 'transport.vehicle-parts-hire',
    department: 'transport',
    label: 'Vehicle hire',
    summary: 'Vehicle hire',
    description: 'Vehicle hire — listed under Parts, Gear & Hire.',
    examples: [],
    keywords: ['vehicle', 'hire', 'parts', 'gear'],
    icon: 'car',
    listingCategory: 'travel_transport',
    publishFlow: 'listing',
    attributes: attrs([{ key: 'condition', required: true }, { key: 'rentalPeriod', required: true }, { key: 'distanceToCampus' }, { key: 'brand' }, { key: 'priceBand' }]),
  },
  {
    id: 'events-tickets',
    parentId: null,
    department: 'events-tickets',
    label: 'Events & Tickets',
    summary: 'Events & Tickets',
    description: 'Browse events & tickets on your campus.',
    examples: [],
    keywords: ['events', 'tickets'],
    icon: 'ticket',
  },
  {
    id: 'events-tickets.tickets',
    parentId: 'events-tickets',
    department: 'events-tickets',
    label: 'Tickets',
    summary: 'Tickets',
    description: 'Tickets in Events & Tickets.',
    examples: [],
    keywords: ['tickets', 'events'],
    icon: 'ticket',
  },
  {
    id: 'events-tickets.tickets.party-concert-tickets',
    parentId: 'events-tickets.tickets',
    department: 'events-tickets',
    label: 'Party & concert tickets',
    summary: 'Party & concert tickets',
    description: 'Party & concert tickets — listed under Tickets.',
    examples: [],
    keywords: ['party', 'concert', 'tickets', 'ticket', 'dinner', 'night', 'conference', 'pass', 'club'],
    phrases: ['event ticket', 'dinner ticket'],
    icon: 'ticket',
    listingCategory: 'events_social',
    publishFlow: 'listing',
    attributes: attrs([{ key: 'eventDate', required: true }, { key: 'venue', required: true }, { key: 'ticketQuantity', required: true }, { key: 'delivery', required: true }, { key: 'priceBand' }]),
    weight: 1.1,
  },
  {
    id: 'events-tickets.tickets.dinner-award-tickets',
    parentId: 'events-tickets.tickets',
    department: 'events-tickets',
    label: 'Dinner & award night tickets',
    summary: 'Dinner & award night tickets',
    description: 'Dinner & award night tickets — listed under Tickets.',
    examples: [],
    keywords: ['dinner', 'award', 'night', 'tickets'],
    icon: 'ticket',
    listingCategory: 'events_social',
    publishFlow: 'listing',
    attributes: attrs([{ key: 'eventDate', required: true }, { key: 'venue', required: true }, { key: 'ticketQuantity', required: true }, { key: 'delivery', required: true }, { key: 'priceBand' }]),
  },
  {
    id: 'events-tickets.tickets.sports-game-tickets',
    parentId: 'events-tickets.tickets',
    department: 'events-tickets',
    label: 'Sports & game tickets',
    summary: 'Sports & game tickets',
    description: 'Sports & game tickets — listed under Tickets.',
    examples: [],
    keywords: ['sports', 'game', 'tickets'],
    icon: 'ticket',
    listingCategory: 'events_social',
    publishFlow: 'listing',
    attributes: attrs([{ key: 'eventDate', required: true }, { key: 'venue', required: true }, { key: 'ticketQuantity', required: true }, { key: 'delivery', required: true }, { key: 'priceBand' }]),
  },
  {
    id: 'events-tickets.event-services-rentals',
    parentId: 'events-tickets',
    department: 'events-tickets',
    label: 'Event Services & Rentals',
    summary: 'Event Services & Rentals',
    description: 'Event Services & Rentals in Events & Tickets.',
    examples: [],
    keywords: ['event', 'services', 'rentals', 'events', 'tickets'],
    icon: 'ticket',
  },
  {
    id: 'events-tickets.event-services-rentals.mc-dj-hype',
    parentId: 'events-tickets.event-services-rentals',
    department: 'events-tickets',
    label: 'MC, DJ & hype',
    summary: 'MC, DJ & hype',
    description: 'MC, DJ & hype — listed under Event Services & Rentals.',
    examples: [],
    keywords: ['hype', 'event', 'services', 'rentals'],
    icon: 'ticket',
    listingCategory: 'events_social',
    publishFlow: 'listing',
    attributes: attrs([{ key: 'serviceMode', required: true }, { key: 'serviceArea' }, { key: 'eventDate' }, { key: 'capacity' }, { key: 'priceBand' }]),
  },
  {
    id: 'events-tickets.event-services-rentals.decor-canopy-rentals',
    parentId: 'events-tickets.event-services-rentals',
    department: 'events-tickets',
    label: 'Decor, canopy & chair rentals',
    summary: 'Decor, canopy & chair rentals',
    description: 'Decor, canopy & chair rentals — listed under Event Services & Rentals.',
    examples: [],
    keywords: ['decor', 'canopy', 'chair', 'rentals', 'event', 'services'],
    icon: 'ticket',
    listingCategory: 'events_social',
    publishFlow: 'listing',
    attributes: attrs([{ key: 'condition', required: true }, { key: 'rentalPeriod', required: true }, { key: 'distanceToCampus' }, { key: 'brand' }, { key: 'priceBand' }]),
  },
  {
    id: 'events-tickets.event-services-rentals.event-equipment-rental',
    parentId: 'events-tickets.event-services-rentals',
    department: 'events-tickets',
    label: 'Sound & lighting rental',
    summary: 'Sound & lighting rental',
    description: 'Sound & lighting rental — listed under Event Services & Rentals.',
    examples: [],
    keywords: ['sound', 'lighting', 'rental', 'event', 'services', 'rentals'],
    icon: 'ticket',
    listingCategory: 'events_social',
    publishFlow: 'listing',
    attributes: attrs([{ key: 'condition', required: true }, { key: 'rentalPeriod', required: true }, { key: 'distanceToCampus' }, { key: 'brand' }, { key: 'priceBand' }]),
  },
  {
    id: 'events-tickets.meetups-groups',
    parentId: 'events-tickets',
    department: 'events-tickets',
    label: 'Meetups & Groups',
    summary: 'Meetups & Groups',
    description: 'Meetups & Groups in Events & Tickets.',
    examples: [],
    keywords: ['meetups', 'groups', 'events', 'tickets'],
    icon: 'ticket',
  },
  {
    id: 'events-tickets.meetups-groups.hangouts-meetups',
    parentId: 'events-tickets.meetups-groups',
    department: 'events-tickets',
    label: 'Hangouts & meetups',
    summary: 'Hangouts & meetups',
    description: 'Hangouts & meetups — listed under Meetups & Groups.',
    examples: [],
    keywords: ['hangouts', 'meetups', 'groups', 'hangout', 'meetup', 'study', 'group', 'social', 'hike'],
    icon: 'ticket',
    listingCategory: 'events_social',
    publishFlow: 'listing',
    attributes: attrs([{ key: 'eventDate', required: true }, { key: 'venue', required: true }, { key: 'capacity' }, { key: 'priceBand' }]),
  },
  {
    id: 'events-tickets.meetups-groups.club-society-signups',
    parentId: 'events-tickets.meetups-groups',
    department: 'events-tickets',
    label: 'Club & society signups',
    summary: 'Club & society signups',
    description: 'Club & society signups — listed under Meetups & Groups.',
    examples: [],
    keywords: ['club', 'society', 'signups', 'meetups', 'groups'],
    icon: 'ticket',
    listingCategory: 'events_social',
    publishFlow: 'listing',
    attributes: attrs([{ key: 'eventDate', required: true }, { key: 'venue', required: true }, { key: 'capacity' }, { key: 'priceBand' }]),
  },
  {
    id: 'campus-essentials',
    parentId: null,
    department: 'campus-essentials',
    label: 'Campus Essentials & Equipment',
    summary: 'Campus Essentials & Equipment',
    description: 'Browse campus essentials & equipment on your campus.',
    examples: [],
    keywords: ['campus', 'essentials', 'equipment'],
    icon: 'gift',
  },
  {
    id: 'campus-essentials.stationery',
    parentId: 'campus-essentials',
    department: 'campus-essentials',
    label: 'Stationery & Supplies',
    summary: 'Stationery & Supplies',
    description: 'Stationery & Supplies in Campus Essentials & Equipment.',
    examples: [],
    keywords: ['stationery', 'supplies', 'campus', 'essentials', 'equipment'],
    icon: 'gift',
  },
  {
    id: 'campus-essentials.stationery.notebooks-pens',
    parentId: 'campus-essentials.stationery',
    department: 'campus-essentials',
    label: 'Notebooks, pens & files',
    summary: 'Notebooks, pens & files',
    description: 'Notebooks, pens & files — listed under Stationery & Supplies.',
    examples: [],
    keywords: ['notebooks', 'pens', 'files', 'stationery', 'supplies'],
    icon: 'gift',
    listingCategory: 'personal_goods',
    publishFlow: 'listing',
    attributes: attrs([{ key: 'condition', required: true }, { key: 'brand' }, { key: 'delivery', required: true }, { key: 'priceBand' }]),
  },
  {
    id: 'campus-essentials.stationery.calculators-instruments',
    parentId: 'campus-essentials.stationery',
    department: 'campus-essentials',
    label: 'Calculators & drawing instruments',
    summary: 'Calculators & drawing instruments',
    description: 'Calculators & drawing instruments — listed under Stationery & Supplies.',
    examples: [],
    keywords: ['calculators', 'drawing', 'instruments', 'stationery', 'supplies'],
    icon: 'gift',
    listingCategory: 'personal_goods',
    publishFlow: 'listing',
    attributes: attrs([{ key: 'condition', required: true }, { key: 'brand' }, { key: 'delivery', required: true }, { key: 'priceBand' }]),
  },
  {
    id: 'campus-essentials.stationery.art-craft-supplies',
    parentId: 'campus-essentials.stationery',
    department: 'campus-essentials',
    label: 'Art & craft supplies',
    summary: 'Art & craft supplies',
    description: 'Art & craft supplies — listed under Stationery & Supplies.',
    examples: [],
    keywords: ['art', 'craft', 'supplies', 'stationery'],
    icon: 'gift',
    listingCategory: 'personal_goods',
    publishFlow: 'listing',
    attributes: attrs([{ key: 'condition', required: true }, { key: 'brand' }, { key: 'delivery', required: true }, { key: 'priceBand' }]),
  },
  {
    id: 'campus-essentials.bags-storage',
    parentId: 'campus-essentials',
    department: 'campus-essentials',
    label: 'Bags & Storage',
    summary: 'Bags & Storage',
    description: 'Bags & Storage in Campus Essentials & Equipment.',
    examples: [],
    keywords: ['bags', 'storage', 'campus', 'essentials', 'equipment'],
    icon: 'gift',
  },
  {
    id: 'campus-essentials.bags-storage.backpacks-laptop-bags',
    parentId: 'campus-essentials.bags-storage',
    department: 'campus-essentials',
    label: 'Backpacks & laptop bags',
    summary: 'Backpacks & laptop bags',
    description: 'Backpacks & laptop bags — listed under Bags & Storage.',
    examples: [],
    keywords: ['backpacks', 'laptop', 'bags', 'storage'],
    icon: 'gift',
    listingCategory: 'personal_goods',
    publishFlow: 'listing',
    attributes: attrs([{ key: 'condition', required: true }, { key: 'brand' }, { key: 'delivery', required: true }, { key: 'priceBand' }]),
  },
  {
    id: 'campus-essentials.bags-storage.boxes-trunks-storage',
    parentId: 'campus-essentials.bags-storage',
    department: 'campus-essentials',
    label: 'Boxes, trunks & storage',
    summary: 'Boxes, trunks & storage',
    description: 'Boxes, trunks & storage — listed under Bags & Storage.',
    examples: [],
    keywords: ['boxes', 'trunks', 'storage', 'bags'],
    icon: 'gift',
    listingCategory: 'personal_goods',
    publishFlow: 'listing',
    attributes: attrs([{ key: 'condition', required: true }, { key: 'brand' }, { key: 'delivery', required: true }, { key: 'priceBand' }]),
  },
  {
    id: 'campus-essentials.sports-fitness',
    parentId: 'campus-essentials',
    department: 'campus-essentials',
    label: 'Sports & Fitness',
    summary: 'Sports & Fitness',
    description: 'Sports & Fitness in Campus Essentials & Equipment.',
    examples: [],
    keywords: ['sports', 'fitness', 'campus', 'essentials', 'equipment'],
    icon: 'gift',
  },
  {
    id: 'campus-essentials.sports-fitness.sports-gear',
    parentId: 'campus-essentials.sports-fitness',
    department: 'campus-essentials',
    label: 'Sports gear & jerseys',
    summary: 'Sports gear & jerseys',
    description: 'Sports gear & jerseys — listed under Sports & Fitness.',
    examples: [],
    keywords: ['sports', 'gear', 'jerseys', 'fitness'],
    icon: 'gift',
    listingCategory: 'personal_goods',
    publishFlow: 'listing',
    attributes: attrs([{ key: 'condition', required: true }, { key: 'brand' }, { key: 'clothingSize' }, { key: 'delivery', required: true }, { key: 'priceBand' }]),
  },
  {
    id: 'campus-essentials.sports-fitness.gym-equipment',
    parentId: 'campus-essentials.sports-fitness',
    department: 'campus-essentials',
    label: 'Gym & fitness equipment',
    summary: 'Gym & fitness equipment',
    description: 'Gym & fitness equipment — listed under Sports & Fitness.',
    examples: [],
    keywords: ['gym', 'fitness', 'equipment', 'sports'],
    icon: 'gift',
    listingCategory: 'personal_goods',
    publishFlow: 'listing',
    attributes: attrs([{ key: 'condition', required: true }, { key: 'brand' }, { key: 'delivery', required: true }, { key: 'priceBand' }]),
  },
  {
    id: 'campus-essentials.lab-tools-equipment',
    parentId: 'campus-essentials',
    department: 'campus-essentials',
    label: 'Lab, Tools & Equipment',
    summary: 'Lab, Tools & Equipment',
    description: 'Lab, Tools & Equipment in Campus Essentials & Equipment.',
    examples: [],
    keywords: ['lab', 'tools', 'equipment', 'campus', 'essentials'],
    icon: 'gift',
  },
  {
    id: 'campus-essentials.lab-tools-equipment.lab-instruments-sale',
    parentId: 'campus-essentials.lab-tools-equipment',
    department: 'campus-essentials',
    label: 'Lab instruments for sale',
    summary: 'Lab instruments for sale',
    description: 'Lab instruments for sale — listed under Lab, Tools & Equipment.',
    examples: [],
    keywords: ['lab', 'instruments', 'sale', 'tools', 'equipment', 'microscope', 'kit', 'instrument'],
    phrases: ['lab equipment', 'for sale'],
    negativeKeywords: ['rent', 'rental', 'hire'],
    icon: 'gift',
    listingCategory: 'equipment_rental',
    publishFlow: 'listing',
    attributes: attrs([{ key: 'condition', required: true }, { key: 'brand' }, { key: 'model' }, { key: 'delivery', required: true }, { key: 'priceBand' }]),
  },
  {
    id: 'campus-essentials.lab-tools-equipment.lab-consumables-kits',
    parentId: 'campus-essentials.lab-tools-equipment',
    department: 'campus-essentials',
    label: 'Lab consumables & kits',
    summary: 'Lab consumables & kits',
    description: 'Lab consumables & kits — listed under Lab, Tools & Equipment.',
    examples: [],
    keywords: ['lab', 'consumables', 'kits', 'tools', 'equipment'],
    icon: 'gift',
    listingCategory: 'equipment_rental',
    publishFlow: 'listing',
    attributes: attrs([{ key: 'condition', required: true }, { key: 'brand' }, { key: 'model' }, { key: 'delivery', required: true }, { key: 'priceBand' }]),
  },
  {
    id: 'campus-essentials.lab-tools-equipment.lab-equipment-rental',
    parentId: 'campus-essentials.lab-tools-equipment',
    department: 'campus-essentials',
    label: 'Lab equipment rental',
    summary: 'Lab equipment rental',
    description: 'Lab equipment rental — listed under Lab, Tools & Equipment.',
    examples: [],
    keywords: ['lab', 'equipment', 'rental', 'tools', 'rent', 'hire', 'borrow', 'microscope', 'bunsen', 'pipette'],
    phrases: ['lab equipment', 'microscope rental', 'for rent'],
    negativeKeywords: ['sale', 'selling', 'for sale'],
    icon: 'gift',
    listingCategory: 'equipment_rental',
    publishFlow: 'listing',
    attributes: attrs([{ key: 'condition', required: true }, { key: 'rentalPeriod', required: true }, { key: 'distanceToCampus' }, { key: 'brand' }, { key: 'priceBand' }]),
  },
  {
    id: 'campus-essentials.lab-tools-equipment.lab-coats-safety-gear',
    parentId: 'campus-essentials.lab-tools-equipment',
    department: 'campus-essentials',
    label: 'Lab coats & safety gear',
    summary: 'Lab coats & safety gear',
    description: 'Lab coats & safety gear — listed under Lab, Tools & Equipment.',
    examples: [],
    keywords: ['lab', 'coats', 'safety', 'gear', 'tools', 'equipment'],
    icon: 'gift',
    listingCategory: 'personal_goods',
    publishFlow: 'listing',
    attributes: attrs([{ key: 'condition', required: true }, { key: 'brand' }, { key: 'clothingSize' }, { key: 'delivery', required: true }, { key: 'priceBand' }]),
  },
  {
    id: 'campus-essentials.everything-else',
    parentId: 'campus-essentials',
    department: 'campus-essentials',
    label: 'Everything Else',
    summary: 'Everything Else',
    description: 'Everything Else in Campus Essentials & Equipment.',
    examples: [],
    keywords: ['everything', 'else', 'campus', 'essentials', 'equipment'],
    icon: 'gift',
  },
  {
    id: 'campus-essentials.everything-else.other-items',
    parentId: 'campus-essentials.everything-else',
    department: 'campus-essentials',
    label: 'Something else',
    summary: 'Something else',
    description: 'Something else — listed under Everything Else.',
    examples: [],
    keywords: ['something', 'else', 'everything', 'fridge', 'lamp', 'kettle', 'mattress', 'furniture', 'fan', 'bucket'],
    icon: 'gift',
    listingCategory: 'other',
    publishFlow: 'listing',
    attributes: attrs([{ key: 'condition', required: true }, { key: 'delivery', required: true }, { key: 'priceBand' }]),
    weight: 0.4,
  },
  {
    id: 'campus-essentials.everything-else.gifts-souvenirs',
    parentId: 'campus-essentials.everything-else',
    department: 'campus-essentials',
    label: 'Gifts & souvenirs',
    summary: 'Gifts & souvenirs',
    description: 'Gifts & souvenirs — listed under Everything Else.',
    examples: [],
    keywords: ['gifts', 'souvenirs', 'everything', 'else'],
    icon: 'gift',
    listingCategory: 'personal_goods',
    publishFlow: 'listing',
    attributes: attrs([{ key: 'condition', required: true }, { key: 'brand' }, { key: 'delivery', required: true }, { key: 'priceBand' }]),
  },
  {
    id: 'custom.other',
    parentId: null,
    department: 'campus-essentials',
    label: 'Something else',
    summary: 'Not covered by the categories above',
    description: 'Anything that genuinely does not fit; you name the category.',
    examples: [],
    keywords: ['other', 'misc', 'general'],
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

/**
 * Legacy taxonomy node id -> its home in the new tree.
 *
 * Listings store their leaf in category_specific_fields.taxonomyNodeId, so this
 * map IS the migration: rewriting that one field moves a listing across without
 * touching marketplace_listings.category, which five SQL functions, four indexes
 * and the search vector still read.
 */
export const LEGACY_TAXONOMY_NODE_MAP: Readonly<Record<string, string>> = {
  'academic': 'study-materials',
  'academic.materials': 'study-materials',
  'academic.materials.textbooks': 'study-materials.textbooks',
  'academic.materials.textbooks.course': 'study-materials.textbooks.course-textbook',
  'academic.materials.textbooks.solutions': 'study-materials.textbooks.solutions-manual',
  'academic.materials.textbooks.lab-manual': 'study-materials.textbooks.lab-manual-workbook',
  'academic.materials.notes': 'study-materials.notes-handouts',
  'academic.materials.notes.lecture': 'study-materials.notes-handouts.lecture-notes',
  'academic.materials.notes.tutorial': 'study-materials.notes-handouts.tutorial-handouts',
  'academic.materials.assessments': 'study-materials.past-questions',
  'academic.materials.assessments.printed-pq': 'study-materials.past-questions.printed-past-questions',
  'academic.materials.assessments.digital-bank': 'study-materials.lantern-digital.lantern-question-bank',
  'academic.materials.compiled': 'study-materials.lantern-digital',
  'academic.materials.compiled.study-pack': 'study-materials.lantern-digital.lantern-study-pack',
  'academic.materials.capstone': 'study-materials.projects-research',
  'academic.materials.capstone.project': 'study-materials.projects-research.project-thesis-seminar',
  'academic.lab': 'campus-essentials.lab-tools-equipment',
  'academic.lab.data-collection': 'study-materials.projects-research.research-data-collection',
  'academic.lab.equipment-rental': 'campus-essentials.lab-tools-equipment.lab-equipment-rental',
  'academic.lab.equipment-sale': 'campus-essentials.lab-tools-equipment.lab-instruments-sale',
  'campus': 'campus-essentials',
  'campus.housing': 'housing.rooms-rentals',
  'campus.housing.hostel': 'housing.rooms-rentals.hostel-bedspace',
  'campus.housing.flat': 'housing.rooms-rentals.flat-apartment',
  'campus.housing.short-let': 'housing.rooms-rentals.short-let',
  'campus.mobility': 'transport.rides-trips',
  'campus.mobility.ride': 'transport.rides-trips.intercity-trip-seat',
  'campus.mobility.vehicle': 'transport.vehicles-for-sale.cars',
  'campus.fashion': 'fashion-beauty.everyday-fashion',
  'campus.fashion.aso-ebi': 'fashion-beauty.occasion-wear.aso-ebi',
  'campus.fashion.everyday': 'fashion-beauty.everyday-fashion.womens-clothing',
  'campus.goods': 'campus-essentials',
  // Deliberately the DEPARTMENT, not a leaf: the old generic 'Electronics'
  // leaf held phones, laptops, power banks and cameras alike, so pinning it to
  // Smartphones would relabel every laptop in the inventory. Group nodes are
  // valid browse filters, and the backfill re-classifies these by title.
  'campus.goods.electronics': 'electronics',
  'campus.goods.other': 'campus-essentials.everything-else.other-items',
  'campus.services': 'services.personal-services',
  'campus.services.tutoring': 'services.academic-services.tutoring-lessons',
  'campus.services.printing': 'services.print-design.printing-photocopy',
  'campus.services.other': 'services.personal-services.other-services',
  'campus.events': 'events-tickets.tickets',
  'campus.events.tickets': 'events-tickets.tickets.party-concert-tickets',
  'campus.events.social': 'events-tickets.meetups-groups.hangouts-meetups',
  'custom.other': 'campus-essentials.everything-else.other-items',
  'category:textbook_exchange': 'study-materials.textbooks.course-textbook',
  'category:lecture_notes': 'study-materials.notes-handouts.lecture-notes',
  'category:pq_bank': 'study-materials.past-questions.printed-past-questions',
  'category:study_pack': 'study-materials.lantern-digital.lantern-study-pack',
  'category:project_thesis': 'study-materials.projects-research.project-thesis-seminar',
  'category:data_collection': 'study-materials.projects-research.research-data-collection',
  'category:equipment_rental': 'campus-essentials.lab-tools-equipment.lab-equipment-rental',
  'category:accommodation': 'housing.rooms-rentals.hostel-bedspace',
  'category:travel_transport': 'transport.rides-trips.intercity-trip-seat',
  'category:aso_ebi': 'fashion-beauty.everyday-fashion.womens-clothing',
  'category:personal_goods': 'campus-essentials.everything-else.other-items',
  'category:campus_services': 'services.personal-services.other-services',
  'category:events_social': 'events-tickets.tickets.party-concert-tickets',
  'category:other': 'campus-essentials.everything-else.other-items',
  'category:custom:*': 'campus-essentials.everything-else.other-items',
};

/** Resolve a possibly-legacy node id to a live one. */
export function resolveTaxonomyNodeId(id: string | null | undefined): string | undefined {
  if (!id) return undefined;
  if (NODE_BY_ID.has(id)) return id;
  const mapped = LEGACY_TAXONOMY_NODE_MAP[id];
  return mapped && NODE_BY_ID.has(mapped) ? mapped : undefined;
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
    browse: MARKETPLACE_DEPARTMENTS.reduce(
      (acc, department) => {
        acc[department] = browseListingCategories(department);
        return acc;
      },
      {} as Record<MarketplaceDepartment, ReturnType<typeof browseListingCategories>>,
    ),
  };
}
