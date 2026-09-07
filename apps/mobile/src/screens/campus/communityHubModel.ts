/**
 * The Communities segment, as data.
 *
 * Campus → Communities is open to every signed-in student with an academic
 * profile (founder decision, 2026-09-07) and communities go beyond coursework:
 * clubs, hostels, events, faith, sports, anything campus life holds. That turns
 * one flat list into a hub with a shape, and the shape is decided HERE rather
 * than inside `CampusScreen`'s render so mobile jest can hold it in node:
 *
 *   Your communities  — the rooms the student is already in (auto campus rooms
 *                       first: those are the ones a profile save re-derives,
 *                       and therefore the ones they did not choose)
 *   Find a community  — everything else, narrowed by a kind chip and the
 *                       search box, ranked by the SHARED comparator.
 *
 * Nothing here re-implements a shared rule. Kinds, their labels, their icons,
 * their ink and the discovery ranking all come from
 * `@lantern/shared/network` (communityGovernance.ts), which the API and web
 * read too — §8 parity rule 2: a client never sorts or labels a community row
 * its own way.
 *
 * THE ONE PIECE OF LOCAL LOGIC, and why it exists: `effectiveCommunityKind`.
 * The server behind this build still mints every student-made community as
 * `kind = 'topic'` and carries the purpose as a TAG (`POST /communities` →
 * `createTopicCommunity`), so a hostel, a fellowship and a rag week all arrive
 * labelled "Interest". Until the kinds migration is hand-applied, the tag is
 * the only thing that distinguishes them, and reading it is what keeps the
 * chips honest. The moment rows carry a real kind, this function returns it
 * unchanged and nothing else in the segment moves.
 */
import {
  ACADEMIC_COMMUNITY_KINDS,
  communityHeaderLine,
  communityKindMeta,
  rankDiscoverCommunities,
  type Community,
  type CommunityKind,
  type MyCommunity,
} from '@lantern/shared/network';
import type { AppIconName } from '../../components/ui/appIconMap';

/** The chip row, in the order it is drawn. `all` is last and clears the filter. */
export type CommunityChip =
  | 'academic'
  | 'interests'
  | 'clubs'
  | 'hostel'
  | 'events'
  | 'faith'
  | 'sports'
  | 'all';

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

/** Which chip each kind answers to. Every shared kind is placed exactly once. */
const KIND_CHIP: Record<CommunityKind, Exclude<CommunityChip, 'all'>> = {
  institution: 'academic',
  programme: 'academic',
  level: 'academic',
  course: 'academic',
  // `topic` is the legacy/degraded kind and `general` is the catch-all: both
  // read as "an interest", which is the bucket a student looks in for them.
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
 * The purpose tags the create flow writes (web's `COMMUNITY_PURPOSES` writes
 * the same words), mapped onto the kind the row would carry if the server
 * could store one. `study` stays an interest: it is a subject room, not a
 * derived academic scope, and treating it as Academic would put a student-made
 * room beside their real course room.
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

/**
 * The kind to render this row as. See the header: a `topic` row carrying a
 * purpose tag is really that purpose, and every academic kind is itself.
 */
export function effectiveCommunityKind(
  community: Pick<Community, 'kind' | 'tags'>
): CommunityKind {
  const kind = community.kind as CommunityKind;
  if (ACADEMIC.has(kind)) return kind;
  if (kind !== 'topic') return kind;
  for (const tag of community.tags ?? []) {
    const hit = TAG_KIND[String(tag).trim().toLowerCase()];
    if (hit) return hit;
  }
  return 'topic';
}

export function communityChipOf(community: Pick<Community, 'kind' | 'tags'>): CommunityChip {
  return KIND_CHIP[effectiveCommunityKind(community)] ?? 'interests';
}

export function matchesChip(
  community: Pick<Community, 'kind' | 'tags'>,
  chip: CommunityChip
): boolean {
  return chip === 'all' || communityChipOf(community) === chip;
}

export interface CommunityCardMeta {
  /** "Course" / "Hostel" — the word under the name. */
  label: string;
  icon: AppIconName;
  /** The feature ink token this row is painted in: `campus` or `groups`. */
  ink: 'campus' | 'groups';
}

/**
 * The icon + word + ink a card shows — straight from the shared kind meta, so
 * mobile, web and the API describe a room identically.
 */
export function communityCardMeta(community: Pick<Community, 'kind' | 'tags'>): CommunityCardMeta {
  const meta = communityKindMeta(effectiveCommunityKind(community));
  return { label: meta.label, icon: meta.icon as AppIconName, ink: meta.ink };
}

export interface CommunityHeaderMeta extends CommunityCardMeta {
  /** "Hostel · 1 member · 1 online" — the online part is omitted at 0. */
  line: string;
}

/**
 * The same three facts a card shows, plus the counted line a DETAIL header
 * shows. It exists so the header cannot describe a room differently from the
 * card the student tapped to reach it: build 172 showed "Interest · 1 member"
 * in the header and "Hostel · 1 member" with a house glyph in the list, for
 * the one community, because the header read `community.kind` raw and the card
 * read `effectiveCommunityKind`. Both now come through here.
 */
export function communityHeaderMeta(
  community: Pick<Community, 'kind' | 'tags'>,
  memberCount: number,
  onlineCount: number
): CommunityHeaderMeta {
  return {
    ...communityCardMeta(community),
    line: communityHeaderLine(effectiveCommunityKind(community), memberCount, onlineCount),
  };
}

export interface CommunityHubInput {
  /** The membership list (`GET /communities`). */
  mine: readonly MyCommunity[];
  /** What discovery returned for the CURRENT query. */
  discovered: readonly Community[];
  chip: CommunityChip;
  /** The query the `discovered` rows actually answer, not the box's live text. */
  loadedQuery: string;
  /** The viewer's own campus, so their university's rooms lead the list. */
  institutionId?: string | null;
  /**
   * True when the last load failed or is showing cached rows — the segment may
   * then not claim "nothing to join" or "no match", because a failed request
   * says nothing about what exists.
   */
  unknown: boolean;
  now?: number;
}

export type CommunityHubEmpty =
  /** There are rows to show. */
  | 'none'
  /** Loaded fine, this chip/search has nothing — say which. */
  | 'noMatch'
  /** Loaded fine, the student is in nothing and there is nothing to join. */
  | 'empty'
  /** The load failed; the banner above has already said so. */
  | 'unknown';

export interface CommunityHubModel {
  mine: MyCommunity[];
  find: Community[];
  empty: CommunityHubEmpty;
  /**
   * Whether the true-empty illustration may be drawn. ONE place, so the
   * campus-hall picture cannot creep onto a "no hostels here" state — a
   * student who filtered themselves into an empty chip is not starting out.
   */
  showEmptyIllustration: boolean;
  /** True when the chip or the search box is narrowing the list. */
  filtered: boolean;
}

function bySourceThenName(a: MyCommunity, b: MyCommunity): number {
  if (a.source !== b.source) return a.source === 'auto' ? -1 : 1;
  return a.name.localeCompare(b.name);
}

/**
 * The whole segment in one object.
 *
 * Discovery is already server-filtered by the query, so the query is only
 * applied again to "Your communities" — otherwise searching would leave every
 * joined room on screen and read as if the search had failed.
 */
export function buildCommunityHub({
  mine,
  discovered,
  chip,
  loadedQuery,
  institutionId,
  unknown,
  now,
}: CommunityHubInput): CommunityHubModel {
  const needle = loadedQuery.trim().toLowerCase();
  const mineRows = mine
    .filter((community) => matchesChip(community, chip))
    .filter(
      (community) =>
        !needle ||
        community.name.toLowerCase().includes(needle) ||
        (community.description ?? '').toLowerCase().includes(needle)
    )
    .sort(bySourceThenName);

  const joinedIds = new Set(mine.map((community) => community.id));
  const findRows = rankDiscoverCommunities(
    discovered.filter(
      (community) => !joinedIds.has(community.id) && matchesChip(community, chip)
    ),
    { institutionId: institutionId ?? null, ...(now !== undefined ? { now } : {}) }
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
