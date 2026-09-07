/**
 * What the Communities segment ASKS FOR — the chip row and the search box,
 * turned into `GET /discover/communities` parameters.
 *
 * Until this wave the chips only filtered what the phone already held, so
 * "Hostel" could show an empty list while the server held twenty hostel rooms
 * past the 30-row page. The chip is now part of the QUERY.
 *
 * THE ONE SUBTLETY, and why the fallback exists. The server filters with
 * `.eq('kind', kind)` — an exact match on `communities.kind`. On a database
 * where the kinds migration has not been hand-applied, every student-made
 * community is still filed as `topic` with its purpose carried as a TAG, so a
 * `kind=hostel` query answers zero rows for a campus that genuinely has
 * hostels. A zero-row answer therefore triggers ONE retry without the `kind`,
 * and `matchesChip` (communityHubModel.ts, which reads the tag) narrows the
 * result on the phone — the pre-migration behaviour, kept as a floor rather
 * than as the default. The moment rows carry a real kind the first query
 * answers and the fallback never runs.
 *
 * Chips that cover SEVERAL kinds send no `kind` at all: `academic` is four
 * kinds and `interests` is three, and a single-valued parameter cannot ask for
 * them. Asking for one of the three and calling it "Interests" would quietly
 * hide the other two.
 */
import { isCommunityKind, type CommunityKind } from '@lantern/shared/network';
import type { CommunityChip } from './communityHubModel';

/** Chips that name exactly ONE shared kind, and can therefore be a query. */
const CHIP_SERVER_KIND: Partial<Record<CommunityChip, CommunityKind>> = {
  clubs: 'club',
  hostel: 'hostel',
  events: 'event',
  faith: 'faith',
  sports: 'sports',
};

export interface DiscoverParams {
  q?: string;
  kind?: CommunityKind;
  limit: number;
}

export interface CommunityDiscoveryPlan {
  /** The request to make. */
  params: DiscoverParams;
  /**
   * The request to make INSTEAD when the first answers zero rows, or null when
   * there is nothing to widen — a kind-less query that came back empty means
   * the campus really has nothing.
   */
  fallback: DiscoverParams | null;
}

export const COMMUNITY_DISCOVER_LIMIT = 30;

/** The kind a chip narrows to on the server, or null when it names several. */
export function chipServerKind(chip: CommunityChip): CommunityKind | null {
  const kind = CHIP_SERVER_KIND[chip];
  // Guarded against the shared vocabulary rather than trusted: a kind renamed
  // in `@lantern/shared/network` must stop being sent, not become a filter the
  // server silently ignores.
  return kind && isCommunityKind(kind) ? kind : null;
}

export function planCommunityDiscovery(input: {
  chip: CommunityChip;
  /** The search box's text, sent as typed — shared normalises it server-side. */
  query?: string;
  limit?: number;
}): CommunityDiscoveryPlan {
  const limit = input.limit ?? COMMUNITY_DISCOVER_LIMIT;
  const q = (input.query ?? '').trim();
  const base: DiscoverParams = { limit, ...(q ? { q } : {}) };
  const kind = chipServerKind(input.chip);
  if (!kind) return { params: base, fallback: null };
  return { params: { ...base, kind }, fallback: base };
}
