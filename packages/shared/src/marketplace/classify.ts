import {
  getTaxonomyLeaves,
  getTaxonomyNode,
  isTaxonomyLeaf,
  type MarketplaceDepartment,
  type TaxonomyNode,
} from './taxonomy';

const COURSE_CODE_RE = /\b[a-z]{2,4}\s*\d{3}[a-z]?\b/i;
const ISBN_RE = /\b(?:97[89][-\s]?)?\d{9}[\dXx]\b/;
const BEDROOM_RE = /\b(\d+|one|two|three|mini)\s*(bed|bedroom|br)\b/i;

export interface ClassifyListingInput {
  title: string;
  description?: string;
  department?: MarketplaceDepartment;
  limit?: number;
}

export interface ClassifyMatchReason {
  kind: 'phrase' | 'keyword' | 'label' | 'signal';
  text: string;
}

export interface ClassifySuggestion {
  node: TaxonomyNode;
  score: number;
  confidence: number;
  reasons: ClassifyMatchReason[];
}

export interface SearchTaxonomyHit {
  node: TaxonomyNode;
  score: number;
  pathLabel: string;
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[_/]+/g, ' ')
    .replace(/[^\p{L}\p{N}\s-]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokens(text: string): string[] {
  const n = normalize(text);
  return n ? n.split(' ') : [];
}

function includesPhrase(haystack: string, phrase: string): boolean {
  return haystack.includes(normalize(phrase));
}

function scoreLeaf(
  leaf: TaxonomyNode,
  titleNorm: string,
  descNorm: string,
  department?: MarketplaceDepartment,
): { score: number; reasons: ClassifyMatchReason[] } {
  const reasons: ClassifyMatchReason[] = [];
  let score = 0;
  const weight = leaf.weight ?? 1;
  const blob = `${titleNorm} ${descNorm}`.trim();

  const add = (amount: number, reason: ClassifyMatchReason | null, fromTitle: boolean) => {
    const scaled = amount * (fromTitle ? 1 : 0.45);
    if (scaled <= 0) return;
    score += scaled;
    if (reason) reasons.push(reason);
  };

  for (const phrase of leaf.phrases ?? []) {
    const p = normalize(phrase);
    if (!p) continue;
    if (includesPhrase(titleNorm, p)) {
      add(8, { kind: 'phrase', text: phrase }, true);
    } else if (includesPhrase(descNorm, p)) {
      add(8, { kind: 'phrase', text: phrase }, false);
    }
  }

  for (const keyword of leaf.keywords) {
    const k = normalize(keyword);
    if (!k) continue;
    const inTitle = k.includes(' ') ? includesPhrase(titleNorm, k) : titleNorm.split(' ').includes(k) || includesPhrase(titleNorm, k);
    const inDesc = k.includes(' ') ? includesPhrase(descNorm, k) : descNorm.split(' ').includes(k) || includesPhrase(descNorm, k);
    if (inTitle) add(k.includes(' ') ? 5 : 2.4, { kind: 'keyword', text: keyword }, true);
    else if (inDesc) add(k.includes(' ') ? 5 : 2.4, { kind: 'keyword', text: keyword }, false);
  }

  for (const word of tokens(leaf.label)) {
    if (word.length < 4) continue;
    if (titleNorm.split(' ').includes(word) || includesPhrase(titleNorm, word)) {
      add(1.6, { kind: 'label', text: leaf.label }, true);
    }
  }

  for (const negative of leaf.negativeKeywords ?? []) {
    const n = normalize(negative);
    if (n && includesPhrase(blob, n)) {
      score -= 7;
      reasons.push({ kind: 'keyword', text: `not “${negative}”` });
    }
  }

  if (COURSE_CODE_RE.test(titleNorm) || COURSE_CODE_RE.test(descNorm)) {
    if (leaf.department === 'study-materials' && leaf.publishFlow === 'listing') {
      add(1.8, { kind: 'signal', text: 'course code' }, true);
    }
  }
  if (ISBN_RE.test(blob) && leaf.listingCategory === 'textbook_exchange') {
    add(4, { kind: 'signal', text: 'ISBN' }, true);
  }
  if (BEDROOM_RE.test(blob) && leaf.listingCategory === 'accommodation') {
    add(3.5, { kind: 'signal', text: 'bedrooms' }, true);
  }

  if (department && leaf.department !== department && leaf.id !== 'custom.other') {
    score *= 0.72;
  }

  score *= weight;
  if (score < 0) score = 0;
  return { score, reasons: dedupeReasons(reasons).slice(0, 4) };
}

function dedupeReasons(reasons: ClassifyMatchReason[]): ClassifyMatchReason[] {
  const seen = new Set<string>();
  const out: ClassifyMatchReason[] = [];
  for (const reason of reasons) {
    const key = `${reason.kind}:${reason.text.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(reason);
  }
  return out;
}

/**
 * Rank listing types from a title (and optional description). Rule-based on
 * purpose: campus language is small and stable, and this must work offline
 * in the create form as the seller types.
 */
export function classifyListing(input: ClassifyListingInput): ClassifySuggestion[] {
  const titleNorm = normalize(input.title || '');
  const descNorm = normalize(input.description || '');
  if (titleNorm.length < 2 && descNorm.length < 4) return [];

  const limit = Math.max(1, Math.min(input.limit ?? 5, 8));
  const ranked: ClassifySuggestion[] = [];

  for (const leaf of getTaxonomyLeaves()) {
    if (leaf.id === 'custom.other') continue;
    const { score, reasons } = scoreLeaf(leaf, titleNorm, descNorm, input.department);
    if (score <= 0) continue;
    ranked.push({ node: leaf, score, confidence: 0, reasons });
  }

  ranked.sort((a, b) => b.score - a.score);
  const top = ranked.slice(0, limit);
  const peak = top[0]?.score || 1;
  for (const row of top) {
    row.confidence = Math.max(0.08, Math.min(0.99, row.score / peak));
  }
  return top;
}

export function searchTaxonomy(
  query: string,
  options?: { department?: MarketplaceDepartment; limit?: number },
): SearchTaxonomyHit[] {
  const q = normalize(query);
  if (q.length < 1) return [];
  const limit = Math.max(1, Math.min(options?.limit ?? 8, 12));
  const hits: SearchTaxonomyHit[] = [];

  for (const node of getTaxonomyLeaves()) {
    if (options?.department && node.department !== options.department && node.id !== 'custom.other') {
      continue;
    }
    const hay = normalize(
      [node.label, node.summary, node.description, ...(node.keywords || []), ...(node.phrases || []), ...(node.examples || [])].join(' '),
    );
    let score = 0;
    if (hay.startsWith(q) || normalize(node.label).startsWith(q)) score += 10;
    if (includesPhrase(normalize(node.label), q)) score += 8;
    if (includesPhrase(hay, q)) score += 4;
    for (const tok of q.split(' ')) {
      if (tok.length < 2) continue;
      if (hay.includes(tok)) score += 1.2;
    }
    if (options?.department && node.department !== options.department) score *= 0.7;
    if (score <= 0) continue;
    const path = [];
    let current: TaxonomyNode | undefined = node;
    const guard = new Set<string>();
    while (current && !guard.has(current.id)) {
      guard.add(current.id);
      if (current.parentId !== null || isTaxonomyLeaf(current)) path.unshift(current.label);
      current = current.parentId ? getTaxonomyNode(current.parentId) : undefined;
    }
    hits.push({ node, score, pathLabel: path.join(' › ') });
  }

  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, limit);
}

export function serializeClassifySuggestion(row: ClassifySuggestion) {
  return {
    nodeId: row.node.id,
    listingCategory: row.node.listingCategory,
    publishFlow: row.node.publishFlow ?? 'listing',
    label: row.node.label,
    summary: row.node.summary,
    description: row.node.description,
    examples: row.node.examples,
    department: row.node.department,
    score: Math.round(row.score * 100) / 100,
    confidence: Math.round(row.confidence * 100) / 100,
    reasons: row.reasons,
  };
}
