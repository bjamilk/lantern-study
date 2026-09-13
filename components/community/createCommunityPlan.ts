import {
  COMMUNITY_EVENT_LOCATION_MAX,
  effectiveCommunityKind,
  parseCommunityEventStart,
  type CommunityKind,
} from '@lantern/shared/network';
import type { AppIconName } from '../ui/appIconMap';

/**
 * Start a community — the pure part.
 *
 * The server (POST /api/v1/communities → `createCommunity`) accepts
 * `{ name, description?, tags?, kind? }` and mints a PUBLIC community. The
 * four academic kinds — institution, programme, level, course — are derived
 * from a student's profile and cannot be hand-made. The purpose travels BOTH
 * as `kind` (the real column, once 20260908120000 is applied — before that the
 * API files the room as `topic`) AND as a tag, which is what every surface
 * reads back to give the room its chip either way (`communityBadgeLabel`).
 *
 * Visibility is a real control: public (default) or private. Private rooms
 * stay off Find; join is invite-link or code from Manage. Event date/place
 * write `startsAt` / `location` when the when-field parses; otherwise they
 * stay in the description.
 */

export const COMMUNITY_NAME_MIN = 3;
export const COMMUNITY_NAME_MAX = 60;
export const COMMUNITY_DESCRIPTION_MAX = 400;
export const COMMUNITY_TAGS_MAX = 5;

export interface CommunityPurpose {
  id: string;
  label: string;
  /** The tag stored on the community, so Find can filter by it. */
  tag: string;
  /** The `communities.kind` this purpose writes (a social kind, never academic). */
  kind: CommunityKind;
  icon: AppIconName;
  /** One plain line under the picker explaining what this kind of room is for. */
  hint: string;
}

/**
 * Founder decision (binding): communities go BEYOND academic discussion —
 * clubs, hostels, events, faith, sports, anything campus life holds — with the
 * same moderation everywhere.
 */
export const COMMUNITY_PURPOSES: readonly CommunityPurpose[] = [
  {
    id: 'study',
    kind: 'topic',
    label: 'Study',
    tag: 'study',
    icon: 'school',
    hint: 'A subject, a past-questions drive, an exam everyone is sitting.',
  },
  {
    id: 'club',
    kind: 'club',
    label: 'Club or society',
    tag: 'club',
    icon: 'people',
    hint: 'A society, a department association, a student body.',
  },
  {
    id: 'hostel',
    kind: 'hostel',
    label: 'Hostel or hall',
    tag: 'hostel',
    icon: 'home',
    hint: 'The people you actually live near.',
  },
  {
    id: 'event',
    kind: 'event',
    label: 'Event',
    tag: 'event',
    icon: 'calendar',
    hint: 'One thing happening on a date — a week, a rally, a party, a fair.',
  },
  {
    id: 'faith',
    kind: 'faith',
    label: 'Faith',
    tag: 'faith',
    icon: 'sparkles',
    hint: 'A fellowship, a prayer group, a campus congregation.',
  },
  {
    id: 'sports',
    kind: 'sports',
    label: 'Sports',
    tag: 'sports',
    icon: 'trophy',
    hint: 'A team, a court, a league on campus.',
  },
  {
    id: 'interest',
    kind: 'interest',
    label: 'Interest',
    tag: 'interest',
    icon: 'star',
    hint: 'Anything else students gather around.',
  },
] as const;

export function communityPurpose(id: string | null | undefined): CommunityPurpose | null {
  if (!id) return null;
  return COMMUNITY_PURPOSES.find((purpose) => purpose.id === id) ?? null;
}

/** The kind a purpose writes; `topic` for study and for an unknown purpose. */
export function createdCommunityKind(purposeId: string | null | undefined): CommunityKind {
  return communityPurpose(purposeId)?.kind ?? 'topic';
}

export type CommunityVisibility = 'public' | 'private';

export interface CreateCommunityDraft {
  name: string;
  purposeId: string | null;
  description: string;
  /** Free-text, comma or space separated. */
  tags: string;
  visibility: CommunityVisibility;
  /** Event purpose only — plain text, e.g. "Fri 12 Sep, 4pm". */
  eventWhen?: string;
  eventWhere?: string;
}

export interface CreateCommunityErrors {
  name?: string;
  purposeId?: string;
  description?: string;
}

export function validateCreateCommunity(draft: CreateCommunityDraft): CreateCommunityErrors {
  const errors: CreateCommunityErrors = {};
  const name = draft.name.trim();
  if (name.length < COMMUNITY_NAME_MIN) {
    errors.name = `Name it in at least ${COMMUNITY_NAME_MIN} characters`;
  } else if (name.length > COMMUNITY_NAME_MAX) {
    errors.name = `Keep the name under ${COMMUNITY_NAME_MAX} characters`;
  }
  if (!communityPurpose(draft.purposeId)) {
    errors.purposeId = 'Pick what this community is for';
  }
  if (draft.description.trim().length > COMMUNITY_DESCRIPTION_MAX) {
    errors.description = `Keep the description under ${COMMUNITY_DESCRIPTION_MAX} characters`;
  }
  return errors;
}

export function isCreateCommunityValid(draft: CreateCommunityDraft): boolean {
  return Object.keys(validateCreateCommunity(draft)).length === 0;
}

const TAG_RE = /^[a-z0-9][a-z0-9-]{0,29}$/;

/** Lowercase, de-punctuated, deduped, capped. Invalid fragments are dropped, not rejected. */
export function normalizeCommunityTags(input: string, purposeTag?: string | null): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (raw: string) => {
    const tag = raw
      .trim()
      .toLowerCase()
      .replace(/[\s_]+/g, '-')
      .replace(/[^a-z0-9-]/g, '')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
    if (!tag || !TAG_RE.test(tag) || seen.has(tag)) return;
    seen.add(tag);
    out.push(tag);
  };
  if (purposeTag) push(purposeTag);
  for (const fragment of input.split(/[,\n]/)) {
    if (out.length >= COMMUNITY_TAGS_MAX) break;
    push(fragment);
  }
  return out.slice(0, COMMUNITY_TAGS_MAX);
}

/**
 * An event's when/where in the description, in plain words.
 *
 * There are no `starts_at` / `location` columns, so the alternative to this is
 * either dropping what the student typed or inventing a field the API would
 * throw away. Written into the description, it survives, it is visible on
 * every surface that already shows a description, and the modal tells the
 * student that is where it is going.
 */
export function composeEventDescription(input: {
  description: string;
  when?: string;
  where?: string;
}): string {
  const lines: string[] = [];
  const body = input.description.trim();
  if (body) lines.push(body);
  const when = (input.when ?? '').trim();
  const where = (input.where ?? '').trim();
  if (when) lines.push(`When: ${when}`);
  if (where) lines.push(`Where: ${where}`);
  return lines.join('\n');
}

export interface CreateCommunityRequest {
  name: string;
  kind: CommunityKind;
  description?: string;
  tags?: string[];
  visibility: CommunityVisibility;
  startsAt?: string | null;
  location?: string | null;
}

/** The exact body POST /communities accepts — nothing the server would drop. */
export function buildCreateCommunityRequest(
  draft: CreateCommunityDraft
): CreateCommunityRequest | null {
  if (!isCreateCommunityValid(draft)) return null;
  const purpose = communityPurpose(draft.purposeId);
  const startsAt =
    purpose?.id === 'event' ? parseCommunityEventStart(draft.eventWhen ?? '') : null;
  const location =
    purpose?.id === 'event' && (draft.eventWhere ?? '').trim()
      ? (draft.eventWhere ?? '').trim().slice(0, COMMUNITY_EVENT_LOCATION_MAX)
      : null;
  const description =
    purpose?.id === 'event' && !startsAt
      ? composeEventDescription({
          description: draft.description,
          when: draft.eventWhen,
          where: draft.eventWhere,
        })
      : draft.description.trim();
  const tags = normalizeCommunityTags(draft.tags, purpose?.tag ?? null);
  return {
    name: draft.name.trim(),
    kind: createdCommunityKind(purpose?.id),
    visibility: draft.visibility === 'private' ? 'private' : 'public',
    ...(description ? { description: description.slice(0, COMMUNITY_DESCRIPTION_MAX) } : {}),
    ...(tags.length ? { tags } : {}),
    ...(startsAt ? { startsAt } : {}),
    ...(location ? { location } : {}),
  };
}

/**
 * The one sentence the modal shows about who will be able to see the room.
 * It is a promise about behaviour, so it lives beside the request builder that
 * makes the promise true.
 */
export function createCommunityVisibilityNote(visibility: CommunityVisibility): string {
  return visibility === 'private'
    ? 'Only people with an invite link or code can find this community. Copy a code from Manage after you create it.'
    : 'Anyone signed in can find and join this community.';
}

export const CREATE_COMMUNITY_VISIBILITY_NOTE = createCommunityVisibilityNote('public');

export const CREATE_COMMUNITY_MODERATION_NOTE =
  'You start as its admin. Anything posted here can be reported, and the same rules apply as everywhere else on Lantern.';

/**
 * The badge on a community card and on its page.
 *
 * `communityKindLabel` answers "Topic" for every student-made room, which is
 * true and useless — a hostel, a fellowship and a rag week all read the same.
 * When the purpose tag this modal writes is present, show that instead; fall
 * back to the kind for the four academic kinds and for rooms made before
 * purposes existed.
 */
export function communityBadgeLabel(
  kind: string,
  tags: readonly string[] | null | undefined,
  kindLabel: (kind: string) => string
): string {
  return kindLabel(effectiveCommunityKind({ kind, tags }));
}
