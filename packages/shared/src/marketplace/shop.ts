/**
 * Buyer-side shop helpers for the campus marketplace.
 *
 * These are the Amazon-shop *patterns* that fit Lantern — typeahead, aisle
 * browse, product breadcrumbs/specs, and related-item ranking — without
 * copying Amazon's catalog, branding, or retail tree.
 */

import { searchTaxonomy } from './classify';
import {
  attributesForNode,
  defaultLeafForListingCategory,
  getTaxonomyChildren,
  getTaxonomyLeaves,
  getTaxonomyNode,
  getTaxonomyPath,
  isTaxonomyLeaf,
  taxonomyPathLabel,
  type MarketplaceDepartment,
  type TaxonomyNode,
} from './taxonomy';

export type ListingShopFields = {
  id?: string;
  category?: string;
  campus_id?: string | null;
  course_id?: string | null;
  courseId?: string | null;
  price?: number | null;
  quantity?: number | null;
  condition?: string | null;
  taxonomyNodeId?: string | null;
  category_specific_fields?: Record<string, unknown> | null;
  categorySpecificFields?: Record<string, unknown> | null;
};

export function listingCsf(listing: ListingShopFields): Record<string, unknown> {
  const raw = listing.category_specific_fields ?? listing.categorySpecificFields;
  return raw && typeof raw === 'object' ? raw : {};
}

export function listingTaxonomyNodeId(listing: ListingShopFields): string | undefined {
  if (typeof listing.taxonomyNodeId === 'string' && listing.taxonomyNodeId) {
    return listing.taxonomyNodeId;
  }
  const fromFields = listingCsf(listing).taxonomyNodeId;
  return typeof fromFields === 'string' && fromFields ? fromFields : undefined;
}

export function resolveListingTaxonomy(listing: ListingShopFields): {
  node: TaxonomyNode | undefined;
  path: TaxonomyNode[];
  pathLabel: string;
} {
  const storedId = listingTaxonomyNodeId(listing);
  const stored = storedId ? getTaxonomyNode(storedId) : undefined;
  const node =
    stored && isTaxonomyLeaf(stored)
      ? stored
      : listing.category
        ? defaultLeafForListingCategory(listing.category)
        : undefined;
  if (!node) return { node: undefined, path: [], pathLabel: '' };
  return {
    node,
    path: getTaxonomyPath(node.id),
    pathLabel: taxonomyPathLabel(node.id),
  };
}

export function listingTypeLabel(listing: ListingShopFields, fallback = ''): string {
  const resolved = resolveListingTaxonomy(listing);
  if (resolved.node?.label) return resolved.node.label;
  return fallback;
}

const CONDITION_LABELS: Record<string, string> = {
  new: 'New',
  'like-new': 'Like new',
  like_new: 'Like new',
  good: 'Good',
  fair: 'Fair',
  poor: 'Poor',
};

export function listingConditionValue(listing: ListingShopFields): string | null {
  const fromFields = listingCsf(listing).condition;
  const raw =
    (typeof fromFields === 'string' && fromFields) ||
    (typeof listing.condition === 'string' && listing.condition) ||
    '';
  const key = raw.trim();
  return key || null;
}

export function listingConditionLabel(listing: ListingShopFields): string | null {
  const key = listingConditionValue(listing);
  if (!key) return null;
  return CONDITION_LABELS[key] ?? key.charAt(0).toUpperCase() + key.slice(1);
}

export interface ListingSpecRow {
  key: string;
  label: string;
  value: string;
}

function formatSpecValue(raw: unknown, key: string): string | null {
  if (raw == null || raw === '') return null;
  if (key === 'condition' && typeof raw === 'string') {
    return CONDITION_LABELS[raw] ?? raw;
  }
  if (key === 'furnished') {
    if (raw === true || raw === 'yes' || raw === 'true') return 'Furnished';
    if (raw === false || raw === 'no' || raw === 'false') return 'Unfurnished';
  }
  if (typeof raw === 'number' && Number.isFinite(raw)) return String(raw);
  if (typeof raw === 'string') return raw.trim() || null;
  if (typeof raw === 'boolean') return raw ? 'Yes' : 'No';
  return null;
}

/** Product-detail spec rows (condition, ISBN, course, housing, …). */
export function listingSpecRows(listing: ListingShopFields): ListingSpecRow[] {
  const fields = listingCsf(listing);
  const { node } = resolveListingTaxonomy(listing);
  const attrs = attributesForNode(node);
  const rows: ListingSpecRow[] = [];
  const seen = new Set<string>();

  for (const attr of attrs) {
    const value = formatSpecValue(fields[attr.key], attr.key);
    if (!value) continue;
    seen.add(attr.key);
    rows.push({ key: attr.key, label: attr.label, value });
  }

  if (!seen.has('condition')) {
    const condition = listingConditionLabel(listing);
    if (condition) rows.unshift({ key: 'condition', label: 'Condition', value: condition });
  }

  return rows;
}

export function descendantLeaves(nodeId: string): TaxonomyNode[] {
  const node = getTaxonomyNode(nodeId);
  if (!node) return [];
  if (isTaxonomyLeaf(node)) return [node];
  const out: TaxonomyNode[] = [];
  const walk = (id: string) => {
    for (const child of getTaxonomyChildren(id)) {
      if (isTaxonomyLeaf(child)) out.push(child);
      else walk(child.id);
    }
  };
  walk(nodeId);
  return out;
}

export function listingCategoriesUnderNode(nodeId: string): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const leaf of descendantLeaves(nodeId)) {
    const category = leaf.listingCategory;
    if (!category || category === 'other' || seen.has(category)) continue;
    seen.add(category);
    ids.push(category);
  }
  return ids;
}

export interface ShopBrowseFilter {
  category?: string;
  categories?: string[];
  taxonomyNodeId?: string;
  /** Group browse: match any of these leaves. */
  taxonomyNodeIds?: string[];
  includeUnclassified?: boolean;
  department?: MarketplaceDepartment;
}

/** Every leaf that files under a coarse listing category. */
function leavesForListingCategory(category: string): TaxonomyNode[] {
  return getTaxonomyLeaves().filter((leaf) => leaf.listingCategory === category);
}

/**
 * Whether a node covers every leaf of each listing category it touches.
 *
 * This is what makes it safe to show listings that carry no node id yet. Such a
 * listing is only known to its coarse category, so it can be placed under a node
 * that owns that whole category — and nowhere narrower. Showing them under a
 * partial node is how "Smartphones" ends up full of unfiled laptops.
 */
function coversWholeCategories(nodeId: string): boolean {
  const leaves = descendantLeaves(nodeId);
  const covered = new Set(leaves.map((leaf) => leaf.id));
  const categories = new Set(
    leaves
      .map((leaf) => leaf.listingCategory)
      .filter((category): category is string => Boolean(category) && category !== 'other'),
  );
  if (categories.size === 0) return false;
  for (const category of categories) {
    for (const sibling of leavesForListingCategory(category)) {
      if (!covered.has(sibling.id)) return false;
    }
  }
  return true;
}

/**
 * Map a taxonomy node (group or leaf) onto listings API filters.
 *
 * A group filters on its descendant leaves rather than on the coarse category
 * alone, because the tree is finer than `marketplace_listings.category`:
 * "Phones & Tablets" and "Computers & Laptops" are both stored as `electronics`,
 * and filtering by category would make the two indistinguishable.
 */
export function browseFilterForNode(nodeId: string): ShopBrowseFilter | null {
  const node = getTaxonomyNode(nodeId);
  if (!node) return null;
  if (isTaxonomyLeaf(node) && node.listingCategory && node.listingCategory !== 'other') {
    return {
      category: node.listingCategory,
      taxonomyNodeId: node.id,
      includeUnclassified: coversWholeCategories(node.id),
      department: node.department,
    };
  }
  const categories = listingCategoriesUnderNode(nodeId);
  if (categories.length === 0) return null;
  const leafIds = descendantLeaves(nodeId)
    .filter((leaf) => leaf.listingCategory && leaf.listingCategory !== 'other')
    .map((leaf) => leaf.id);
  const wholeCategories = coversWholeCategories(nodeId);
  return {
    categories,
    // A node that owns its categories outright needs no leaf filter: the
    // category list already says exactly the same thing, in one indexed column.
    ...(wholeCategories ? {} : { taxonomyNodeIds: leafIds }),
    includeUnclassified: wholeCategories,
    department: node.department,
  };
}

export function isKnownTaxonomyNodeId(id: string | null | undefined): boolean {
  return Boolean(id && getTaxonomyNode(id));
}

export interface RelatedListingCandidate extends ListingShopFields {
  id: string;
}

export function scoreRelatedListing(
  source: ListingShopFields,
  candidate: ListingShopFields,
): number {
  let score = 0;
  if (source.campus_id && candidate.campus_id && source.campus_id === candidate.campus_id) {
    score += 8;
  }

  const sourceCourse = source.course_id || source.courseId;
  const candidateCourse = candidate.course_id || candidate.courseId;
  if (sourceCourse && candidateCourse && sourceCourse === candidateCourse) {
    score += 10;
  }

  const sourceNode = listingTaxonomyNodeId(source);
  const candidateNode = listingTaxonomyNodeId(candidate);
  if (sourceNode && candidateNode && sourceNode === candidateNode) {
    score += 7;
  }

  const sourceCode = listingCsf(source).courseCode;
  const candidateCode = listingCsf(candidate).courseCode;
  if (
    typeof sourceCode === 'string' &&
    typeof candidateCode === 'string' &&
    sourceCode.trim() &&
    sourceCode.trim().toLowerCase() === candidateCode.trim().toLowerCase()
  ) {
    score += 6;
  }

  if (source.category && candidate.category && source.category === candidate.category) {
    score += 2;
  }

  const sourcePrice = Number(source.price);
  const candidatePrice = Number(candidate.price);
  if (Number.isFinite(sourcePrice) && sourcePrice > 0 && Number.isFinite(candidatePrice) && candidatePrice > 0) {
    const ratio = candidatePrice / sourcePrice;
    if (ratio >= 0.7 && ratio <= 1.3) score += 3;
  }

  return score;
}

export function rankRelatedListings<T extends RelatedListingCandidate>(
  source: RelatedListingCandidate,
  candidates: T[],
  limit = 6,
): T[] {
  const cap = Math.max(1, Math.min(limit, 12));
  return [...candidates]
    .filter((row) => row.id && row.id !== source.id)
    .map((row) => ({ row, score: scoreRelatedListing(source, row) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, cap)
    .map((entry) => entry.row);
}

export type MarketplaceSearchSuggestion =
  | {
      kind: 'query';
      id: string;
      label: string;
      query: string;
    }
  | {
      kind: 'recent';
      id: string;
      label: string;
      query: string;
    }
  | {
      kind: 'type';
      id: string;
      label: string;
      pathLabel: string;
      nodeId: string;
      listingCategory: string;
      department: MarketplaceDepartment;
      summary: string;
    };

export function suggestMarketplaceSearch(
  query: string,
  options?: {
    department?: MarketplaceDepartment;
    recents?: readonly string[];
    limit?: number;
  },
): MarketplaceSearchSuggestion[] {
  const trimmed = query.trim();
  const limit = Math.max(3, Math.min(options?.limit ?? 8, 12));
  const out: MarketplaceSearchSuggestion[] = [];

  if (trimmed.length >= 1) {
    out.push({
      kind: 'query',
      id: `query:${trimmed.toLowerCase()}`,
      label: `Search for “${trimmed}”`,
      query: trimmed,
    });
  }

  const recents = options?.recents ?? [];
  const qLower = trimmed.toLowerCase();
  for (const recent of recents) {
    if (out.length >= limit) break;
    const value = recent.trim();
    if (value.length < 2) continue;
    if (qLower && !value.toLowerCase().includes(qLower) && !qLower.includes(value.toLowerCase())) {
      continue;
    }
    if (qLower && value.toLowerCase() === qLower) continue;
    out.push({
      kind: 'recent',
      id: `recent:${value.toLowerCase()}`,
      label: value,
      query: value,
    });
  }

  if (trimmed.length >= 2) {
    for (const hit of searchTaxonomy(trimmed, { department: options?.department, limit: 6 })) {
      if (out.length >= limit) break;
      const category = hit.node.listingCategory;
      if (!category || category === 'other') continue;
      out.push({
        kind: 'type',
        id: `type:${hit.node.id}`,
        label: hit.node.label,
        pathLabel: hit.pathLabel,
        nodeId: hit.node.id,
        listingCategory: category,
        department: hit.node.department,
        summary: hit.node.summary,
      });
    }
  }

  return out.slice(0, limit);
}

/** Breadcrumb crumbs for a listing, skipping the invisible forest root when useful. */
export function listingBreadcrumb(listing: ListingShopFields): TaxonomyNode[] {
  const { path } = resolveListingTaxonomy(listing);
  return path.filter((node) => node.parentId !== null || isTaxonomyLeaf(node));
}

export function lowStockLabel(quantity: number | null | undefined): string | null {
  if (quantity == null || quantity <= 0) return null;
  if (quantity <= 3) return `Only ${quantity} left`;
  return null;
}
