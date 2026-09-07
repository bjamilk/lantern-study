import React, { useCallback, useEffect, useState } from 'react';
import { fetchCampusSummary, type CampusSummary } from '../services/supabase';
import { AppIcon } from './ui/AppIcon';

/**
 * Public campus page (Phase 4 · R).
 *
 * Rendered for LOGGED-OUT visitors — it is the landing page a crawler indexes
 * and an ambassador shares. Everything on it is an aggregate count or a course
 * code; there are no names, avatars or user content, because none of that is
 * safe on a page anyone can load.
 *
 * A bot gets the prerendered version from functions/campus/[slug].ts; this is
 * what a human sees.
 */
export interface CampusScreenProps {
  slug: string;
  programme?: string | null;
  onSignUp?: () => void;
  onBack?: () => void;
}

const StatTile: React.FC<{ label: string; value: number }> = ({ label, value }) => (
  <div className="rounded-xl border border-lantern-border bg-lantern-background p-3 text-center">
    <p className="text-xl font-semibold tabular-nums text-lantern-text">{value.toLocaleString()}</p>
    <p className="text-[11px] text-lantern-text-secondary">{label}</p>
  </div>
);

export const CampusScreen: React.FC<CampusScreenProps> = ({
  slug,
  programme,
  onSignUp,
  onBack,
}) => {
  const [campus, setCampus] = useState<CampusSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setNotFound(false);
    try {
      setCampus(await fetchCampusSummary(slug, programme ?? undefined));
    } catch {
      setNotFound(true);
    } finally {
      setLoading(false);
    }
  }, [slug, programme]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10 text-sm text-lantern-text-secondary" role="status">
        Loading…
      </div>
    );
  }

  if (notFound || !campus) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10">
        <h1 className="text-xl font-semibold text-lantern-text">Campus not found</h1>
        <p className="mt-1 text-sm text-lantern-text-secondary">
          We don&apos;t have a page for that campus yet.
        </p>
        {onBack && (
          <button type="button" onClick={onBack} className="mt-3 text-sm text-lantern-primary underline">
            Go to Lantern Study
          </button>
        )}
      </div>
    );
  }

  const { counts } = campus;

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 space-y-6">
      <header className="space-y-2">
        <p className="inline-flex items-center gap-1.5 text-xs text-lantern-text-secondary">
          <AppIcon name="location" size={14} aria-hidden="true" />
          {campus.city}
          {campus.state ? `, ${campus.state}` : ''}
        </p>
        <h1 className="text-3xl font-semibold leading-tight text-lantern-text" style={{ textWrap: 'balance' }}>
          {campus.name}
          {programme ? ` — ${programme}` : ''}
        </h1>
        <p className="max-w-[60ch] text-sm text-lantern-text-secondary">
          Flashcards, past questions, study groups and a student marketplace — built for{' '}
          {campus.name} students, and designed for slow connections.
        </p>
        {onSignUp && (
          <button
            type="button"
            onClick={onSignUp}
            className="mt-2 h-10 min-h-[44px] rounded-lg bg-lantern-primary px-4 text-sm font-medium text-white"
          >
            Join your campus
          </button>
        )}
      </header>

      <section aria-label="Campus activity" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Students" value={counts.students} />
        <StatTile label="Courses" value={counts.courses} />
        <StatTile label="Communities" value={counts.communities} />
        <StatTile label="Listings" value={counts.listings} />
      </section>

      {campus.courses.length > 0 && (
        <section aria-label="Courses">
          <h2 className="mb-2 text-sm font-semibold text-lantern-text">Courses on Lantern</h2>
          <ul className="flex flex-wrap gap-1.5">
            {campus.courses.map((course) => (
              <li
                key={course.code}
                className="rounded-full border border-lantern-border bg-lantern-background px-2.5 py-1 text-xs text-lantern-text-secondary"
                title={course.title}
              >
                {course.code}
              </li>
            ))}
          </ul>
        </section>
      )}

      {campus.programmes.length > 0 && (
        <section aria-label="Programmes">
          <h2 className="mb-2 text-sm font-semibold text-lantern-text">Programmes</h2>
          <ul className="flex flex-wrap gap-1.5">
            {campus.programmes.map((p) => (
              <li
                key={p}
                className="inline-flex items-center gap-1 rounded-full bg-lantern-background-secondary px-2.5 py-1 text-xs text-lantern-text-secondary"
              >
                <AppIcon name="school" size={12} aria-hidden="true" />
                {p}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
};

export default CampusScreen;
