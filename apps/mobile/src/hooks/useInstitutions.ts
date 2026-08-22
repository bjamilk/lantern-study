/**
 * Institutions = GET /marketplace/campuses minus the "Other" sentinels.
 * One hook so SignUp, the profile-setup modal and Academic settings all
 * offer the same list (and never a sentinel the API would 400 on).
 */
import { useEffect, useState } from 'react';
import { fetchMarketplaceCampuses } from '../services/api';
import { filterInstitutions, type InstitutionOption } from '../utils/courseSelection';

let cache: InstitutionOption[] | null = null;
let inflight: Promise<InstitutionOption[]> | null = null;

async function loadInstitutions(): Promise<InstitutionOption[]> {
  if (cache) return cache;
  if (!inflight) {
    inflight = fetchMarketplaceCampuses('NG')
      .then(rows => {
        cache = filterInstitutions(Array.isArray(rows) ? rows : []);
        return cache;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

export function useInstitutions(): {
  institutions: InstitutionOption[];
  loading: boolean;
  error: string | null;
  reload: () => void;
} {
  const [institutions, setInstitutions] = useState<InstitutionOption[]>(cache ?? []);
  const [loading, setLoading] = useState(!cache);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    if (!cache) setLoading(true);
    loadInstitutions()
      .then(rows => {
        if (cancelled) return;
        setInstitutions(rows);
        setError(null);
      })
      .catch(e => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : 'Could not load institutions');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  return {
    institutions,
    loading,
    error,
    reload: () => {
      cache = null;
      setAttempt(a => a + 1);
    },
  };
}
