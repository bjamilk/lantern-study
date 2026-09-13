/**
 * "Start a community" — the form's rules, without the form.
 *
 * `POST /api/v1/communities` (`createCommunity`) takes
 * `{ name, kind?, description?, tags? }` and mints a PUBLIC community. The
 * kinds migration (20260908120000) is hand-applied: before it the API files
 * the room as `topic` and keeps the tag; after it the real kind is written.
 * Visibility is a real control. Private rooms stay off Find; join is
 * invite-link or code from Manage. Event columns ride on the same
 * migration. So this planner sends:
 *
 *  - the PURPOSE travels as `kind` AND as a tag, which is what
 *    `effectiveCommunityKind` in the Campus hub reads back to give the room
 *    its real label, glyph and chip on either side of the migration;
 *  - an event's when/where is composed into the description in plain words,
 *    because the alternative is dropping what the student typed;
 *  - visibility is public unless the student picks private.
 *
 * The tags and the copy are deliberately the SAME words web's
 * `components/community/createCommunityPlan.ts` writes: a room started on a
 * phone and one started in a browser must come back identical, or the two
 * clients would file them under different chips.
 */
import {
  COMMUNITY_EVENT_LOCATION_MAX,
  communityKindMeta,
  parseCommunityEventStart,
  type CommunityKind,
} from '@lantern/shared/network';
import type { AppIconName } from '../../components/ui/appIconMap';

export const COMMUNITY_NAME_MIN = 3;
export const COMMUNITY_NAME_MAX = 60;
export const COMMUNITY_DESCRIPTION_MAX = 400;
export const COMMUNITY_TAGS_MAX = 5;
export const COMMUNITY_EVENT_FIELD_MAX = 60;

export interface CommunityPurpose {
  id: string;
  label: string;
  /** The tag stored on the community, so Find can filter by it. */
  tag: string;
  /** The kind this room WOULD carry once the kinds migration lands. */
  kind: CommunityKind;
  /** One plain line under the picker explaining what this kind of room is for. */
  hint: string;
}

/**
 * Founder decision (binding): communities go BEYOND academic discussion —
 * clubs, hostels, events, faith, sports, anything campus life holds — with the
 * same moderation everywhere. The four academic kinds are absent because they
 * are DERIVED from a student's profile: a hand-made second "University of
 * Lagos" would fork the row auto-membership and member counts depend on.
 */
export const COMMUNITY_PURPOSES: readonly CommunityPurpose[] = [
  {
    id: 'study',
    label: 'Study',
    tag: 'study',
    kind: 'topic',
    hint: 'A subject, a past-questions drive, an exam everyone is sitting.',
  },
  {
    id: 'club',
    label: 'Club or society',
    tag: 'club',
    kind: 'club',
    hint: 'A society, a department association, a student body.',
  },
  {
    id: 'hostel',
    label: 'Hostel or hall',
    tag: 'hostel',
    kind: 'hostel',
    hint: 'The people you actually live near.',
  },
  {
    id: 'event',
    label: 'Event',
    tag: 'event',
    kind: 'event',
    hint: 'One thing happening on a date — a week, a rally, a party, a fair.',
  },
  {
    id: 'faith',
    label: 'Faith',
    tag: 'faith',
    kind: 'faith',
    hint: 'A fellowship, a prayer group, a campus congregation.',
  },
  {
    id: 'sports',
    label: 'Sports',
    tag: 'sports',
    kind: 'sports',
    hint: 'A team, a court, a league on campus.',
  },
  {
    id: 'interest',
    label: 'Interest',
    tag: 'interest',
    kind: 'interest',
    hint: 'Anything else students gather around.',
  },
] as const;

export function communityPurpose(id: string | null | undefined): CommunityPurpose | null {
  if (!id) return null;
  return COMMUNITY_PURPOSES.find((purpose) => purpose.id === id) ?? null;
}

/** The glyph beside a purpose — the shared kind meta's, never a fresh choice. */
export function purposeIcon(purpose: CommunityPurpose): AppIconName {
  return communityKindMeta(purpose.kind).icon as AppIconName;
}

export type CommunityVisibility = 'public' | 'private';

export interface CreateCommunityDraft {
  name: string;
  purposeId: string | null;
  description: string;
  visibility: CommunityVisibility;
  /** Event purpose only — plain text, e.g. "Fri 12 Sep, 4pm". */
  eventWhen: string;
  eventWhere: string;
}

export const EMPTY_CREATE_COMMUNITY_DRAFT: CreateCommunityDraft = {
  name: '',
  purposeId: null,
  description: '',
  visibility: 'public',
  eventWhen: '',
  eventWhere: '',
};

export type CreateCommunityField = 'name' | 'purposeId' | 'description' | 'eventWhen' | 'eventWhere';

export type CreateCommunityErrors = Partial<Record<CreateCommunityField, string>>;

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
  if (draft.eventWhen.trim().length > COMMUNITY_EVENT_FIELD_MAX) {
    errors.eventWhen = `Keep this under ${COMMUNITY_EVENT_FIELD_MAX} characters`;
  }
  if (draft.eventWhere.trim().length > COMMUNITY_EVENT_FIELD_MAX) {
    errors.eventWhere = `Keep this under ${COMMUNITY_EVENT_FIELD_MAX} characters`;
  }
  return errors;
}

export function isCreateCommunityValid(draft: CreateCommunityDraft): boolean {
  return Object.keys(validateCreateCommunity(draft)).length === 0;
}

/**
 * An event's when/where in the description, in plain words.
 *
 * There are no `starts_at` / `location` columns on this server, so the
 * alternative is either dropping what the student typed or sending a field the
 * API throws away — which would make the response look like a confirmation of
 * something that never happened. Written into the description it survives, it
 * shows on every surface that already renders a description, and the screen
 * tells the student that is where it is going.
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
  /**
   * The real `communities.kind` (a social kind). Pre-20260908120000 the API
   * files the room as `topic` and keeps the purpose tag, which is what
   * `effectiveCommunityKind` reads back either way.
   */
  kind: CommunityKind;
  description?: string;
  tags?: string[];
  visibility: CommunityVisibility;
  startsAt?: string | null;
  location?: string | null;
}

/** The exact body `POST /communities` accepts — nothing the server would drop. */
export function buildCreateCommunityRequest(
  draft: CreateCommunityDraft
): CreateCommunityRequest | null {
  if (!isCreateCommunityValid(draft)) return null;
  const purpose = communityPurpose(draft.purposeId);
  if (!purpose) return null;
  const startsAt = purpose.id === 'event' ? parseCommunityEventStart(draft.eventWhen) : null;
  const location =
    purpose.id === 'event' && draft.eventWhere.trim()
      ? draft.eventWhere.trim().slice(0, COMMUNITY_EVENT_LOCATION_MAX)
      : null;
  const description =
    purpose.id === 'event' && !startsAt
      ? composeEventDescription({
          description: draft.description,
          when: draft.eventWhen,
          where: draft.eventWhere,
        })
      : draft.description.trim();
  return {
    name: draft.name.trim().replace(/\s+/g, ' '),
    kind: purpose.kind,
    visibility: draft.visibility === 'private' ? 'private' : 'public',
    ...(description ? { description: description.slice(0, COMMUNITY_DESCRIPTION_MAX) } : {}),
    tags: [purpose.tag],
    ...(startsAt ? { startsAt } : {}),
    ...(location ? { location } : {}),
  };
}

/**
 * The one sentence the screen shows about who will see the room. It is a
 * promise about behaviour, so it lives beside the request builder that makes
 * the promise true.
 */
export function createCommunityVisibilityNote(visibility: CommunityVisibility): string {
  return visibility === 'private'
    ? 'Only people with an invite link or code can find this community. Copy a code from Manage after you create it.'
    : 'Anyone signed in can find and join this community.';
}

export const CREATE_COMMUNITY_VISIBILITY_NOTE = createCommunityVisibilityNote('public');

export const CREATE_COMMUNITY_MODERATION_NOTE =
  'You start as its admin. Anything posted here can be reported, and the same rules apply as everywhere else on Lantern.';

export const CREATE_COMMUNITY_EVENT_NOTE =
  'Use a date and time like 2026-09-15 16:00 so the event lists soonest-first. A written date still goes into the description.';

export const CREATE_COMMUNITY_TITLE = 'Start a community';
export const CREATE_COMMUNITY_SUBMIT = 'Create community';
