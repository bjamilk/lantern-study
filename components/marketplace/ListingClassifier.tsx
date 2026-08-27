import React, { useEffect, useMemo, useState } from 'react';
import {
  MagnifyingGlassIcon,
  ChevronRightIcon,
  ChevronDownIcon,
  CheckCircleIcon,
  SparklesIcon,
  ArrowTopRightOnSquareIcon,
} from '@heroicons/react/24/outline';
import {
  classifyListing,
  searchTaxonomy,
  taxonomyForest,
  taxonomyPathLabel,
  getTaxonomyNode,
  OTHER_TAXONOMY_NODE_ID,
  type MarketplaceDepartment,
  type TaxonomyNode,
  type TaxonomyTreeNode,
} from '@lantern/shared/marketplace';

export interface CustomCategoryOption {
  id: string;
  name: string;
  usage_count: number;
}

interface ListingClassifierProps {
  department: MarketplaceDepartment;
  title: string;
  description?: string;
  selectedNodeId: string;
  customCategory: string;
  existingCustomCategories?: CustomCategoryOption[];
  onSelectNode: (nodeId: string) => void;
  onCustomCategoryChange: (name: string) => void;
  onOpenStudyProducts?: () => void;
}

function confidenceLabel(confidence: number): string {
  if (confidence >= 0.86) return 'Strong match';
  if (confidence >= 0.6) return 'Good match';
  return 'Possible match';
}

const ListingClassifier: React.FC<ListingClassifierProps> = ({
  department,
  title,
  description,
  selectedNodeId,
  customCategory,
  existingCustomCategories = [],
  onSelectNode,
  onCustomCategoryChange,
  onOpenStudyProducts,
}) => {
  const [query, setQuery] = useState('');
  const [browsing, setBrowsing] = useState(!selectedNodeId);
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() => ({
    academic: department === 'academic',
    campus: department === 'student-life',
    'academic.materials': department === 'academic',
  }));

  useEffect(() => {
    if (!selectedNodeId) setBrowsing(true);
  }, [selectedNodeId]);

  const selected = getTaxonomyNode(selectedNodeId);
  const suggestions = useMemo(
    () => classifyListing({ title, description, department, limit: 4 }),
    [title, description, department],
  );
  const searchHits = useMemo(
    () => (query.trim().length >= 2 ? searchTaxonomy(query, { limit: 8 }) : []),
    [query],
  );
  const forest = useMemo(() => taxonomyForest(department), [department]);
  const allForest = useMemo(() => taxonomyForest(), []);
  const showOtherDepartment = department === 'academic' ? allForest.find((b) => b.node.id === 'campus') : allForest.find((b) => b.node.id === 'academic');

  const pick = (node: TaxonomyNode) => {
    onSelectNode(node.id);
    setBrowsing(false);
    setQuery('');
  };

  const isDigital = selected?.publishFlow === 'question_bank' || selected?.publishFlow === 'study_pack';

  return (
    <div className="space-y-3">
      <div>
        <p id="listing-type-label" className="text-sm font-semibold text-lantern-text">
          Listing type *
        </p>
        <p className="mt-0.5 text-xs text-lantern-text-secondary">
          Find the type buyers already browse — search, use the title hint, or walk the campus catalog.
        </p>
      </div>

      {selected && !browsing ? (
        <div className="rounded-xl border border-lantern-primary/40 bg-lantern-primary-background/40 p-4 space-y-2">
          <p className="text-[11px] font-medium uppercase tracking-wide text-lantern-text-secondary">
            {taxonomyPathLabel(selected.id)}
          </p>
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-lantern-text flex items-center gap-1.5">
                <CheckCircleIcon className="w-4 h-4 text-lantern-primary shrink-0" aria-hidden />
                {selected.label}
              </p>
              <p className="mt-1 text-xs text-lantern-text-secondary">{selected.description}</p>
            </div>
            <button
              type="button"
              onClick={() => setBrowsing(true)}
              className="shrink-0 text-xs font-semibold text-lantern-primary hover:underline min-h-[44px] px-2"
            >
              Change
            </button>
          </div>
          {selected.examples.length > 0 && (
            <p className="text-[11px] text-lantern-text-tertiary">
              e.g. {selected.examples[0]}
            </p>
          )}
          {isDigital && (
            <div className="mt-2 rounded-lg border border-lantern-border bg-lantern-surface p-3 space-y-2">
              <p className="text-xs text-lantern-text">
                {selected.publishFlow === 'question_bank'
                  ? 'A Lantern question bank is a takeable test. Publish it from Study products so buyers can sit it in the app. This form is for a PDF or printed pack of past papers.'
                  : 'A study pack is published from a deck or note in your library. This form cannot attach that content.'}
              </p>
              <div className="flex flex-wrap gap-2">
                {onOpenStudyProducts && (
                  <button
                    type="button"
                    onClick={onOpenStudyProducts}
                    className="inline-flex items-center gap-1 rounded-md bg-lantern-primary px-3 py-1.5 text-xs font-semibold text-white min-h-[40px]"
                  >
                    Open Study products
                    <ArrowTopRightOnSquareIcon className="w-3.5 h-3.5" aria-hidden />
                  </button>
                )}
                {selected.publishFlow === 'question_bank' && (
                  <button
                    type="button"
                    onClick={() => pick(getTaxonomyNode('academic.materials.assessments.printed-pq') as TaxonomyNode)}
                    className="rounded-md border border-lantern-border px-3 py-1.5 text-xs font-medium text-lantern-text min-h-[40px]"
                  >
                    List a PDF or printed pack instead
                  </button>
                )}
              </div>
            </div>
          )}
          {selected.id === OTHER_TAXONOMY_NODE_ID && (
            <div className="space-y-2 pt-1">
              <label htmlFor="listing-custom-category" className="text-xs font-medium text-lantern-text-secondary">
                Name this type
              </label>
              <input
                id="listing-custom-category"
                type="text"
                value={customCategory}
                onChange={(e) => onCustomCategoryChange(e.target.value)}
                placeholder="e.g. Department souvenir"
                className="w-full px-3 py-2 border border-lantern-border rounded-lg bg-lantern-surface text-lantern-text text-sm focus:ring-2 focus:ring-lantern-primary"
              />
              {existingCustomCategories.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {existingCustomCategories
                    .filter((cat) => !customCategory || cat.name.toLowerCase().includes(customCategory.toLowerCase()))
                    .slice(0, 10)
                    .map((cat) => (
                      <button
                        key={cat.id}
                        type="button"
                        onClick={() => onCustomCategoryChange(cat.name)}
                        className={`px-3 py-1.5 text-xs rounded-full border ${
                          customCategory === cat.name
                            ? 'border-lantern-primary bg-lantern-primary-background text-lantern-primary'
                            : 'border-lantern-border text-lantern-text-secondary'
                        }`}
                      >
                        {cat.name}
                      </button>
                    ))}
                </div>
              )}
            </div>
          )}
        </div>
      ) : null}

      {(browsing || !selected) && (
        <div className="rounded-xl border border-lantern-border bg-lantern-surface p-3 sm:p-4 space-y-4">
          <label className="block">
            <span className="sr-only">Search listing types</span>
            <span className="relative block">
              <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-lantern-text-tertiary" aria-hidden />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search types — past questions, hostel, aso ebi…"
                className="w-full pl-9 pr-3 py-2.5 border border-lantern-border rounded-lg bg-lantern-background text-lantern-text text-sm placeholder:text-lantern-text-tertiary focus:ring-2 focus:ring-lantern-primary"
              />
            </span>
          </label>

          {searchHits.length > 0 && (
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-lantern-text-secondary mb-1.5">
                Search results
              </p>
              <ul className="divide-y divide-lantern-border rounded-lg border border-lantern-border overflow-hidden">
                {searchHits.map((hit) => (
                  <li key={hit.node.id}>
                    <button
                      type="button"
                      onClick={() => pick(hit.node)}
                      className="w-full text-left px-3 py-2.5 hover:bg-lantern-background-secondary min-h-[44px]"
                    >
                      <span className="block text-sm font-medium text-lantern-text">{hit.node.label}</span>
                      <span className="block text-[11px] text-lantern-text-secondary">{hit.pathLabel}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {title.trim().length >= 4 && suggestions.length > 0 && query.trim().length < 2 && (
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-lantern-text-secondary mb-1.5 flex items-center gap-1">
                <SparklesIcon className="w-3.5 h-3.5" aria-hidden />
                Suggested from your title
              </p>
              <ul className="space-y-1.5">
                {suggestions.map((row) => (
                  <li key={row.node.id}>
                    <button
                      type="button"
                      onClick={() => pick(row.node)}
                      className="w-full text-left rounded-lg border border-lantern-border px-3 py-2 hover:border-lantern-primary min-h-[44px]"
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium text-lantern-text">{row.node.label}</span>
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-lantern-primary">
                          {confidenceLabel(row.confidence)}
                        </span>
                      </span>
                      <span className="block text-[11px] text-lantern-text-secondary mt-0.5">
                        {taxonomyPathLabel(row.node.id)}
                        {row.reasons[0] ? ` · ${row.reasons[0].text}` : ''}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {query.trim().length < 2 && (
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-lantern-text-secondary mb-1.5">
                Browse the campus catalog
              </p>
              <div className="space-y-1">
                {forest.map((branch) => (
                  <BrowseBranch
                    key={branch.node.id}
                    branch={branch}
                    expanded={expanded}
                    setExpanded={setExpanded}
                    onPick={pick}
                    selectedId={selectedNodeId}
                  />
                ))}
                {showOtherDepartment && (
                  <BrowseBranch
                    branch={showOtherDepartment}
                    expanded={expanded}
                    setExpanded={setExpanded}
                    onPick={pick}
                    selectedId={selectedNodeId}
                  />
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

function BrowseBranch({
  branch,
  expanded,
  setExpanded,
  onPick,
  selectedId,
  depth = 0,
}: {
  branch: TaxonomyTreeNode;
  expanded: Record<string, boolean>;
  setExpanded: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  onPick: (node: TaxonomyNode) => void;
  selectedId: string;
  depth?: number;
}) {
  const { node, children } = branch;
  const isLeaf = children.length === 0 && Boolean(node.listingCategory);
  const open = expanded[node.id] ?? depth < 1;

  if (isLeaf) {
    const selected = selectedId === node.id;
    return (
      <button
        type="button"
        onClick={() => onPick(node)}
        className={`w-full text-left rounded-lg px-3 py-2 min-h-[44px] ${
          selected
            ? 'bg-lantern-primary-background text-lantern-primary'
            : 'hover:bg-lantern-background-secondary text-lantern-text'
        }`}
        style={{ paddingLeft: 12 + depth * 12 }}
      >
        <span className="block text-sm font-medium">{node.label}</span>
        <span className="block text-[11px] text-lantern-text-secondary">{node.summary}</span>
      </button>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => setExpanded((prev) => ({ ...prev, [node.id]: !open }))}
        className="w-full flex items-center gap-2 px-2 py-2 text-sm font-semibold text-lantern-text min-h-[40px]"
        style={{ paddingLeft: 8 + depth * 12 }}
        aria-expanded={open}
      >
        {open ? (
          <ChevronDownIcon className="w-4 h-4 shrink-0 text-lantern-text-secondary" aria-hidden />
        ) : (
          <ChevronRightIcon className="w-4 h-4 shrink-0 text-lantern-text-secondary" aria-hidden />
        )}
        {node.label}
      </button>
      {open && (
        <div className="pb-1">
          {children.map((child) => (
            <BrowseBranch
              key={child.node.id}
              branch={child}
              expanded={expanded}
              setExpanded={setExpanded}
              onPick={onPick}
              selectedId={selectedId}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default ListingClassifier;
