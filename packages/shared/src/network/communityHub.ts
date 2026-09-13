/**
 * Campus → Communities hub — chips, ranking, discovery query, and the
 * activity strip on a community home.
 *
 * Web and mobile used to decide these separately: web opened on All + a
 * leftover Discover Rooms tab; mobile opened Academic-first with tag fallback
 * for `kind = 'topic'`. One module so the two cannot drift.
 *
 * Mobile imports via `@lantern/shared/network`, never the bare package.
 */

import {
  ACADEMIC_COMMUNITY_KINDS,
  communityKindMeta,
  isCommunityKind,
  rankDiscoverCommunities,
  type CommunityKind,
} from './communityGovernance';
import {
  COMMUNITY_COPY,
  COMMUNITY_LOUNGE_CHANNEL_NAME,
  communityHeaderLine,
  roomSubtitle,
  type CommunityChannel,
  type CommunityChannels,
} from './communityServer';
import { boardDisplayName, boardSubtitle } from './communityBoard';

export type CommunityChip =
  | 'academic'
  | 'interests'
  | 'clubs'
  | 'hostel'
  | 'events'
  | 'faith'
  | 'sports'
  | 'all';

/** Founder order: Academic first, All last and clears the filter. */
export const COMMUNITY_CHIPS: readonly CommunityChip[] = [
  'academic',
  'interests',
  'clubs',
  'hostel',
  'events',
  'faith',
  'sports',
  'all',
];

const CHIP_LABELS: Record<CommunityChip, string> = {
  academic: 'Academic',
  interests: 'Interests',
  clubs: 'Clubs',
  hostel: 'Hostel',
  events: 'Events',
  faith: 'Faith',
  sports: 'Sports',
  all: 'All',
};

export function communityChipLabel(chip: CommunityChip): string {
  return CHIP_LABELS[chip];
}

const KIND_CHIP: Record<CommunityKind, Exclude<CommunityChip, 'all'>> = {
  institution: 'academic',
  programme: 'academic',
  level: 'academic',
  course: 'academic',
  topic: 'interests',
  interest: 'interests',
  general: 'interests',
  club: 'clubs',
  hostel: 'hostel',
  event: 'events',
  faith: 'faith',
  sports: 'sports',
};

/**
 * Purpose tags the create flow writes, mapped onto the kind the row would
 * carry if the server stored one. `study` stays an interest: it is a
 * student-made subject room, not a derived academic scope.
 */
const TAG_KIND: Record<string, CommunityKind> = {
  study: 'topic',
  interest: 'interest',
  club: 'club',
  hostel: 'hostel',
  event: 'event',
  faith: 'faith',
  sports: 'sports',
  sport: 'sports',
};

const ACADEMIC = new Set<string>(ACADEMIC_COMMUNITY_KINDS);

export interface CommunityKindFields {
  kind: CommunityKind | string;
  tags?: readonly string[] | null;
}

/**
 * The kind to render this row as. A `topic` row carrying a purpose tag is
 * really that purpose; a real kind is left alone; academic kinds stay
 * themselves even when tagged.
 */
export function effectiveCommunityKind(community: CommunityKindFields): CommunityKind {
  const kind = community.kind as CommunityKind;
  if (ACADEMIC.has(kind)) return kind;
  if (kind !== 'topic') return isCommunityKind(kind) ? kind : 'topic';
  for (const tag of community.tags ?? []) {
    const hit = TAG_KIND[String(tag).trim().toLowerCase()];
    if (hit) return hit;
  }
  return 'topic';
}

export function communityChipOf(community: CommunityKindFields): CommunityChip {
  return KIND_CHIP[effectiveCommunityKind(community)] ?? 'interests';
}

export function matchesChip(community: CommunityKindFields, chip: CommunityChip): boolean {
  return chip === 'all' || communityChipOf(community) === chip;
}

export interface CommunityCardMeta {
  label: string;
  /** `AppIcon` name — same vocabulary on web and mobile. */
  icon: string;
  ink: 'campus' | 'groups';
}

export function communityCardMeta(community: CommunityKindFields): CommunityCardMeta {
  const meta = communityKindMeta(effectiveCommunityKind(community));
  return { label: meta.label, icon: meta.icon, ink: meta.ink };
}

export interface CommunityHeaderMeta extends CommunityCardMeta {
  line: string;
}

export function communityHeaderMeta(
  community: CommunityKindFields,
  memberCount: number,
  onlineCount: number,
): CommunityHeaderMeta {
  const kind = effectiveCommunityKind(community);
  return {
    ...communityCardMeta(community),
    line: communityHeaderLine(kind, memberCount, onlineCount),
  };
}

export interface HubCommunity {
  id: string;
  kind: CommunityKind | string;
  name: string;
  description: string | null;
  tags?: readonly string[] | null;
  institution_id: string | null;
  member_count: number;
  created_at?: string | null;
  starts_at?: string | null;
}

export interface HubMyCommunity extends HubCommunity {
  source: 'auto' | 'joined';
}

export interface CommunityHubInput<M extends HubMyCommunity = HubMyCommunity, C extends HubCommunity = HubCommunity> {
  mine: readonly M[];
  discovered: readonly C[];
  chip: CommunityChip;
  loadedQuery: string;
  institutionId?: string | null;
  unknown: boolean;
  now?: number;
}

export type CommunityHubEmpty = 'none' | 'noMatch' | 'empty' | 'unknown';

export interface CommunityHubModel<M extends HubMyCommunity = HubMyCommunity, C extends HubCommunity = HubCommunity> {
  mine: M[];
  find: C[];
  empty: CommunityHubEmpty;
  showEmptyIllustration: boolean;
  filtered: boolean;
}

/**
 * Yours: campus room first, then other auto rooms, then joined, then name.
 * That is what "open Campus on Yours, campus room first" means.
 */
export function compareYoursCommunities(a: HubMyCommunity, b: HubMyCommunity): number {
  const rank = (c: HubMyCommunity): number => {
    if (effectiveCommunityKind(c) === 'institution') return 0;
    if (c.source === 'auto') return 1;
    return 2;
  };
  const delta = rank(a) - rank(b);
  if (delta !== 0) return delta;
  return a.name.localeCompare(b.name);
}

export function buildCommunityHub<M extends HubMyCommunity, C extends HubCommunity>({
  mine,
  discovered,
  chip,
  loadedQuery,
  institutionId,
  unknown,
  now,
}: CommunityHubInput<M, C>): CommunityHubModel<M, C> {
  const needle = loadedQuery.trim().toLowerCase();
  const mineRows = mine
    .filter((community) => matchesChip(community, chip))
    .filter(
      (community) =>
        !needle ||
        community.name.toLowerCase().includes(needle) ||
        (community.description ?? '').toLowerCase().includes(needle),
    )
    .sort(compareYoursCommunities);

  const joinedIds = new Set(mine.map((community) => community.id));
  const findRows = rankDiscoverCommunities(
    discovered.filter(
      (community) => !joinedIds.has(community.id) && matchesChip(community, chip),
    ),
    { institutionId: institutionId ?? null, ...(now !== undefined ? { now } : {}) },
  );

  const filtered = chip !== 'all' || needle.length > 0;
  const hasRows = mineRows.length + findRows.length > 0;

  let empty: CommunityHubEmpty;
  if (hasRows) empty = 'none';
  else if (unknown) empty = 'unknown';
  else if (filtered) empty = 'noMatch';
  else empty = 'empty';

  return {
    mine: mineRows,
    find: findRows,
    empty,
    showEmptyIllustration: empty === 'empty',
    filtered,
  };
}

// ---------------------------------------------------------------------------
// Discovery query
// ---------------------------------------------------------------------------

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
  params: DiscoverParams;
  /**
   * Widen once when a kind-scoped query answers zero rows. The API now also
   * matches `topic` rows that carry the requested kind as a tag, so this is a
   * floor for pre-migration databases rather than the default path.
   */
  fallback: DiscoverParams | null;
}

export const COMMUNITY_DISCOVER_LIMIT = 30;

export function chipServerKind(chip: CommunityChip): CommunityKind | null {
  const kind = CHIP_SERVER_KIND[chip];
  return kind && isCommunityKind(kind) ? kind : null;
}

/**
 * PostgREST `or` for a single kind, including topic rows that still carry
 * the purpose as a tag.
 */
export function discoverKindOrFilter(kind: CommunityKind): string {
  return `kind.eq.${kind},and(kind.eq.topic,tags.cs.{${kind}})`;
}

export function planCommunityDiscovery(input: {
  chip: CommunityChip;
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

// ---------------------------------------------------------------------------
// Community home — activity first
// ---------------------------------------------------------------------------

export const COMMUNITY_HOME_COPY = {
  sectionActivity: 'Happening now',
  emptyActivity: 'Nothing new yet. Open General or a board to start it.',
} as const;

export type CommunityHomeActivityKind = 'lounge' | 'board' | 'room';

export interface CommunityHomeActivityItem {
  kind: CommunityHomeActivityKind;
  id: string;
  title: string;
  subtitle: string;
  unread: number;
}

function timeMs(iso: string | null | undefined): number {
  if (!iso) return 0;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : 0;
}

/**
 * The strip that leads a community home: lounge last line, latest board
 * posts, open rooms. Empty when there is nothing to show — callers omit
 * the section rather than drawing a "nothing" card over the channel list.
 */
export function buildCommunityHomeActivity(
  payload: Pick<CommunityChannels, 'lounge' | 'boards' | 'rooms'>,
  now: number = Date.now(),
  limit = 4,
): CommunityHomeActivityItem[] {
  const items: CommunityHomeActivityItem[] = [];
  const lounge = payload.lounge;
  if (lounge && (lounge.lastMessage || lounge.unreadCount > 0)) {
    items.push({
      kind: 'lounge',
      id: lounge.id,
      title: boardDisplayName({ isLounge: true, name: COMMUNITY_LOUNGE_CHANNEL_NAME }),
      subtitle: lounge.lastMessage?.trim() || COMMUNITY_COPY.loungeSubtitle,
      unread: lounge.unreadCount,
    });
  }

  const boards = [...(payload.boards ?? [])]
    .filter((board) => board.isMember && (board.lastMessage || board.unreadCount > 0))
    .sort((a: CommunityChannel, b: CommunityChannel) => timeMs(b.lastMessageTime) - timeMs(a.lastMessageTime));

  for (const board of boards) {
    items.push({
      kind: 'board',
      id: board.id,
      title: boardDisplayName(board),
      subtitle: boardSubtitle(board, now),
      unread: board.unreadCount,
    });
  }

  for (const room of payload.rooms ?? []) {
    items.push({
      kind: 'room',
      id: room.id,
      title: room.title,
      subtitle: roomSubtitle(room, now),
      unread: 0,
    });
  }

  return items.slice(0, limit);
}
