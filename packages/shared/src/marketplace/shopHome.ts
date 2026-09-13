/**
 * Shop home merchandising — department discs and rail titles.
 * Lantern tokens only; Amazon/Shop.app workflow, not their chrome.
 */

import type { FeatureKey } from '../design';
import { MARKETPLACE_DEPARTMENTS, type MarketplaceDepartment } from './taxonomy';

export const SHOP_HOME_COPY = {
  title: 'Shop',
  subtitle: 'Buy and sell around campus',
  allListings: 'All listings',
  continueShopping: 'Continue shopping',
  onSale: 'On sale',
  yourCampus: 'Your campus',
  forYourCourses: 'For your courses',
  shops: 'Shops',
  emptySearch: 'Search textbooks, notes, halls…',
} as const;

export type ShopHomeRailId =
  | 'continue'
  | 'onSale'
  | 'campus'
  | 'courses'
  | 'shops';

export const SHOP_HOME_RAILS: readonly {
  id: ShopHomeRailId;
  title: string;
}[] = [
  { id: 'continue', title: SHOP_HOME_COPY.continueShopping },
  { id: 'onSale', title: SHOP_HOME_COPY.onSale },
  { id: 'campus', title: SHOP_HOME_COPY.yourCampus },
  { id: 'courses', title: SHOP_HOME_COPY.forYourCourses },
  { id: 'shops', title: SHOP_HOME_COPY.shops },
];

const DEPARTMENT_LABELS: Record<MarketplaceDepartment, string> = {
  electronics: 'Electronics',
  'study-materials': 'Books & Study',
  housing: 'Housing',
  'fashion-beauty': 'Fashion',
  'food-groceries': 'Food',
  services: 'Services',
  transport: 'Transport',
  'events-tickets': 'Events',
  'campus-essentials': 'Essentials',
};

const DEPARTMENT_FEATURES: Record<MarketplaceDepartment, FeatureKey> = {
  electronics: 'tests',
  'study-materials': 'notes',
  housing: 'campus',
  'fashion-beauty': 'sets',
  'food-groceries': 'budget',
  services: 'groups',
  transport: 'recording',
  'events-tickets': 'flashcards',
  'campus-essentials': 'campus',
};

export type ShopDepartmentDisc = {
  id: MarketplaceDepartment;
  label: string;
  feature: FeatureKey;
};

export function shopDepartmentDiscs(): ShopDepartmentDisc[] {
  return MARKETPLACE_DEPARTMENTS.map((id) => ({
    id,
    label: DEPARTMENT_LABELS[id],
    feature: DEPARTMENT_FEATURES[id],
  }));
}

export function shopDepartmentLabel(id: MarketplaceDepartment): string {
  return DEPARTMENT_LABELS[id];
}
