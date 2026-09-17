import React, { useMemo, useState } from 'react';
import { Card } from '../ui/Card';
import { Input } from '../ui/Input';
import { Body, Caption, Heading, Label } from '../ui/Text';
import {
  AdminEmpty,
  AdminKpi,
  AdminPageHeader,
  AdminSegmented,
  AdminStatusBadge,
} from './AdminChrome';
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

const STATUS_TONE: Record<ProductFeatureStatus, 'success' | 'warning' | 'neutral'> = {
  shipped: 'success',
  partial: 'warning',
  planned: 'neutral',
};

const AREA_LABEL = Object.fromEntries(
  PRODUCT_FEATURE_AREAS.filter((a) => a.id !== 'all').map((a) => [a.id, a.label]),
) as Record<ProductFeatureArea, string>;

function FeatureCard({ feature }: { feature: ProductFeatureEntry }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <Card padding="md" className="min-w-0">
      <div className="flex flex-wrap items-start justify-between gap-2 mb-2">
        <div className="min-w-0">
          <Heading as="p" className="text-lantern-text">{feature.title}</Heading>
          <Caption className="text-lantern-text-muted mt-0.5">
            {AREA_LABEL[feature.area]} · shipped {feature.shippedAt}
          </Caption>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <AdminStatusBadge tone={STATUS_TONE[feature.status]}>{STATUS_LABEL[feature.status]}</AdminStatusBadge>
          {feature.surfaces.map((surface) => (
            <AdminStatusBadge key={surface} tone="neutral">
              {surface}
            </AdminStatusBadge>
          ))}
        </div>
      </div>

      <Body className="text-lantern-text-secondary mb-3">{feature.summary}</Body>

      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="text-caption font-semibold text-lantern-text-secondary hover:text-lantern-text min-h-[44px]"
        aria-expanded={expanded}
      >
        {expanded ? 'Hide details' : 'Show details'}
      </button>

      {expanded ? (
        <div className="mt-3 space-y-4 border-t border-lantern-border pt-3">
          <FeatureSection title="Behavior" items={feature.details} />
          <FeatureSection title="How to use / verify" items={feature.howToUse} />
          <FeatureSection title="Admin / support notes" items={feature.adminNotes} />
          {feature.commits?.length ? (
            <section>
              <Label className="uppercase text-lantern-text-muted">Related commits</Label>
              <Caption className="font-mono text-lantern-text-secondary break-all mt-1.5">
                {feature.commits.join(' · ')}
              </Caption>
            </section>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}

function FeatureSection({ title, items }: { title: string; items: string[] }) {
  return (
    <section>
      <Label className="uppercase text-lantern-text-muted">{title}</Label>
      <ul className="list-disc pl-5 space-y-1 mt-1.5">
        {items.map((item) => (
          <li key={item}>
            <Body className="text-lantern-text">{item}</Body>
          </li>
        ))}
      </ul>
    </section>
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
      <AdminPageHeader
        eyebrow="Registry"
        title="Product features"
        description="What recently shipped. Expand a card for behavior, verification steps, and admin notes."
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <AdminKpi compact label="Shipped entries" value={shippedCount} />
        <AdminKpi compact label="Notes" value={notesCount} />
        <AdminKpi compact label="Groups / chat" value={groupsCount} />
        <AdminKpi compact label="Jobs" value={jobsCount} />
      </div>

      <div className="flex flex-col gap-3">
        <AdminSegmented
          ariaLabel="Feature areas"
          value={area}
          onChange={setArea}
          options={PRODUCT_FEATURE_AREAS.map((option) => ({ id: option.id, label: option.label }))}
        />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search features…"
          aria-label="Search product features"
        />
      </div>

      <Caption className="text-lantern-text-muted">
        Showing {features.length} of {PRODUCT_FEATURES.length} entries
      </Caption>

      {features.length === 0 ? (
        <AdminEmpty>No features match this filter.</AdminEmpty>
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
