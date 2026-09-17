/**
 * Public campus summaries (Phase 4 · R).
 *
 * This feeds GUEST-VISIBLE, search-indexed pages, so it is the one place in the
 * API where "what is safe to expose" has to be decided explicitly rather than
 * inherited.
 *
 * THE RULE THAT MATTERS: the API client is built with the SERVICE ROLE, so it
 * bypasses RLS entirely. Every policy that protects this data from an anonymous
 * PostgREST reader does nothing here. Each query below therefore hand-writes its
 * own visibility filters — `active`, `status='active'`, `visibility='public'`,
 * `kind <> 'other'`. Reading the policies and assuming they apply is the easiest
 * way to leak private data onto a public SEO page.
 *
 * Counts only. No names, no ids, no user content — a campus page says how much
 * is happening, never who is doing it.
 */
import type { DataLayer } from './data';
import { logger } from '../utils/logger';

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,60}$/;

export interface CampusSummary {
  slug: string;
  name: string;
  city: string;
  state: string;
  kind: string;
  /** Aggregate counts — deliberately never identities. */
  counts: {
    students: number;
    courses: number;
    communities: number;
    listings: number;
    creators: number;
  };
  /** Course codes only: public, non-personal, and the useful SEO surface. */
  courses: Array<{ code: string; title: string }>;
  programmes: string[];
}

export class CampusSummaryService {
  constructor(private data: DataLayer) {}

  private get db() {
    return this.data.getClient();
  }

  /** Normalised slug, or null when it could not possibly be one. */
  static normalizeSlug(raw: unknown): string | null {
    const slug = String(raw ?? '')
      .trim()
      .toLowerCase();
    return SLUG_RE.test(slug) ? slug : null;
  }

  async getBySlug(rawSlug: unknown, programme?: string | null): Promise<CampusSummary | null> {
    const slug = CampusSummaryService.normalizeSlug(rawSlug);
    if (!slug) return null;

    const { data: campus, error } = await this.db
      .from('marketplace_campuses')
      // `active` and `kind` are enforced here, NOT inherited from RLS.
      .select('id, name, city, state, slug, kind, active')
      .eq('slug', slug)
      .eq('active', true)
      .neq('kind', 'other')
      .maybeSingle();
    if (error || !campus) return null;

    const c = campus as {
      id: string;
      name: string;
      city: string;
      state: string;
      slug: string;
      kind: string;
    };

    const programmeFilter =
      typeof programme === 'string' && programme.trim() ? programme.trim().slice(0, 80) : null;

    const count = async (
      table: string,
      build: (q: any) => any
    ): Promise<number> => {
      try {
        const { count: n, error: countError } = await build(
          this.db.from(table).select('id', { count: 'exact', head: true })
        );
        if (countError) throw countError;
        return n ?? 0;
      } catch (err) {
        // A public page must render even if one counter is unavailable.
        logger.warn('campus summary count failed', {
          table,
          error: err instanceof Error ? err.message : String(err),
        });
        return 0;
      }
    };

    const [students, courses, communities, listings, creators] = await Promise.all([
      count('profiles', (q) => {
        let x = q.eq('institution_id', c.id).is('deactivated_at', null);
        if (programmeFilter) x = x.ilike('programme', programmeFilter);
        return x;
      }),
      count('courses', (q) => q.eq('institution_id', c.id)),
      count('communities', (q) => q.eq('institution_id', c.id).eq('visibility', 'public')),
      count('marketplace_listings', (q) => q.eq('campus_id', c.id).eq('status', 'active')),
      // A "creator" here is a profile at this campus with an active digital
      // listing. Counted via listings rather than creator_stats so a suspended
      // creator whose listings are down does not still inflate the number.
      count('marketplace_listings', (q) =>
        q.eq('campus_id', c.id).eq('status', 'active').in('listing_kind', ['study_pack', 'question_bank'])
      ),
    ]);

    const [{ data: courseRows }, { data: programmeRows }] = await Promise.all([
      this.db
        .from('courses')
        .select('code, title')
        .eq('institution_id', c.id)
        .order('code', { ascending: true })
        .limit(60),
      this.db
        .from('profiles')
        .select('programme')
        .eq('institution_id', c.id)
        .not('programme', 'is', null)
        .limit(400),
    ]);

    // Programmes are aggregated to distinct names with no counts attached: at a
    // small campus "1 student studies X" would identify a person.
    const programmes = [
      ...new Set(
        ((programmeRows || []) as Array<{ programme?: string | null }>)
          .map((r) => (r.programme || '').trim())
          .filter(Boolean)
      ),
    ]
      .sort()
      .slice(0, 40);

    return {
      slug: c.slug,
      name: c.name,
      city: c.city,
      state: c.state,
      kind: c.kind,
      counts: { students, courses, communities, listings, creators },
      courses: ((courseRows || []) as Array<{ code: string; title: string }>).map((r) => ({
        code: r.code,
        title: r.title,
      })),
      programmes,
    };
  }

  /** Active campuses for the sitemap and the campus index. */
  async listSlugs(limit = 1000): Promise<Array<{ slug: string; name: string }>> {
    const { data, error } = await this.db
      .from('marketplace_campuses')
      .select('slug, name')
      .eq('active', true)
      .neq('kind', 'other')
      .order('name', { ascending: true })
      .limit(Math.min(5000, Math.max(1, limit)));
    if (error) throw error;
    return (data || []) as Array<{ slug: string; name: string }>;
  }
}

let service: CampusSummaryService | null = null;

export function getCampusSummaryService(data: DataLayer): CampusSummaryService {
  if (!service) service = new CampusSummaryService(data);
  return service;
}
