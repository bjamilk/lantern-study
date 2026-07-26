import React, { useMemo, useState } from 'react';
import { Card } from '../ui/Card';
import { StatChip } from '../ui/StatChip';
import {
  PRODUCT_FEATURE_AREAS,
  PRODUCT_FEATURES,
  sortProductFeatures,
  type ProductFeatureArea,
  type ProductFeatureEntry,
  type ProductFeatureStatus,
} from './productFeatures';

const STATUS_LABEL: Record<ProductFeatureStatus, string> = {
  shipped: 'Shipped',
  partial: 'Partial',
  planned: 'Planned',
};

const STATUS_VARIANT: Record<ProductFeatureStatus, 'success' | 'accent' | 'neutral'> = {
  shipped: 'success',
  partial: 'accent',
  planned: 'neutral',
};

const AREA_LABEL = Object.fromEntries(
  PRODUCT_FEATURE_AREAS.filter((a) => a.id !== 'all').map((a) => [a.id, a.label]),
) as Record<ProductFeatureArea, string>;

function FeatureCard({ feature }: { feature: ProductFeatureEntry }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <Card variant="elevated" padding="md" className="min-w-0">
      <div className="flex flex-wrap items-start justify-between gap-2 mb-2">
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-lantern-text">{feature.title}</h3>
          <p className="text-xs text-lantern-text-muted mt-0.5">
            {AREA_LABEL[feature.area]} · shipped {feature.shippedAt}
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <StatChip label={STATUS_LABEL[feature.status]} variant={STATUS_VARIANT[feature.status]} />
          {feature.surfaces.map((surface) => (
            <StatChip key={surface} label={surface} variant="neutral" />
          ))}
        </div>
      </div>

      <p className="text-sm text-lantern-text-secondary mb-3">{feature.summary}</p>

      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="text-sm font-medium text-lantern-primary hover:underline min-h-[44px]"
        aria-expanded={expanded}
      >
        {expanded ? 'Hide details' : 'Show details'}
      </button>

      {expanded ? (
        <div className="mt-3 space-y-4 border-t border-lantern-border pt-3">
          <section>
            <h4 className="text-xs font-semibold uppercase tracking-wide text-lantern-text-muted mb-1.5">
              Behavior
            </h4>
            <ul className="list-disc pl-5 space-y-1 text-sm text-lantern-text">
              {feature.details.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>

          <section>
            <h4 className="text-xs font-semibold uppercase tracking-wide text-lantern-text-muted mb-1.5">
              How to use / verify
            </h4>
            <ul className="list-disc pl-5 space-y-1 text-sm text-lantern-text">
              {feature.howToUse.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>

          <section>
            <h4 className="text-xs font-semibold uppercase tracking-wide text-lantern-text-muted mb-1.5">
              Admin / support notes
            </h4>
            <ul className="list-disc pl-5 space-y-1 text-sm text-lantern-text">
              {feature.adminNotes.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>

          {feature.commits?.length ? (
            <section>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-lantern-text-muted mb-1.5">
                Related commits
              </h4>
              <p className="text-xs font-mono text-lantern-text-secondary break-all">
                {feature.commits.join(' · ')}
              </p>
            </section>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}

export const AdminProductFeatures: React.FC = () => {
  const [area, setArea] = useState<ProductFeatureArea | 'all'>('all');
  const [query, setQuery] = useState('');

  const features = useMemo(() => {
    const q = query.trim().toLowerCase();
    return sortProductFeatures(PRODUCT_FEATURES).filter((feature) => {
      if (area !== 'all' && feature.area !== area) return false;
      if (!q) return true;
      const haystack = [
        feature.title,
        feature.summary,
        ...feature.details,
        ...feature.howToUse,
        ...feature.adminNotes,
        feature.area,
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [area, query]);

  const shippedCount = PRODUCT_FEATURES.filter((f) => f.status === 'shipped').length;
  const notesCount = PRODUCT_FEATURES.filter((f) => f.area === 'notes').length;
  const groupsCount = PRODUCT_FEATURES.filter((f) => f.area === 'groups' || f.area === 'chat').length;
  const jobsCount = PRODUCT_FEATURES.filter((f) => f.area === 'jobs').length;

  return (
    <div className="space-y-4">
      <Card padding="md">
        <h2 className="text-lg font-semibold text-lantern-text">Product features</h2>
        <p className="text-sm text-lantern-text-secondary mt-1 max-w-3xl">
          Living registry of what recently shipped on Lantern Study. Use this as the source of truth for
          support, QA, and release verification. Expand a card for behavior, verification steps, and
          admin notes.
        </p>
        <div className="flex flex-wrap gap-2 mt-3">
          <StatChip label={`${shippedCount} shipped entries`} variant="success" />
          <StatChip label={`${notesCount} notes`} variant="neutral" />
          <StatChip label={`${groupsCount} groups/chat`} variant="neutral" />
          <StatChip label={`${jobsCount} jobs`} variant="neutral" />
        </div>
      </Card>

      <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
        <div className="inline-flex flex-wrap gap-1 rounded-lg border border-lantern-border bg-lantern-surface p-1">
          {PRODUCT_FEATURE_AREAS.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => setArea(option.id)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium min-h-[40px] ${
                area === option.id
                  ? 'bg-lantern-primary text-white'
                  : 'text-lantern-text-secondary hover:bg-lantern-background-secondary'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search features…"
          aria-label="Search product features"
          className="flex-1 min-w-[200px] rounded-lg border border-lantern-border bg-lantern-surface px-3 py-2 text-sm text-lantern-text min-h-[44px]"
        />
      </div>

      <p className="text-xs text-lantern-text-muted">
        Showing {features.length} of {PRODUCT_FEATURES.length} entries
      </p>

      {features.length === 0 ? (
        <Card padding="md">
          <p className="text-sm text-lantern-text-secondary">No features match this filter.</p>
        </Card>
      ) : (
        <div className="grid gap-3 grid-cols-1 xl:grid-cols-2">
          {features.map((feature) => (
            <FeatureCard key={feature.id} feature={feature} />
          ))}
        </div>
      )}
    </div>
  );
};

export default AdminProductFeatures;
