/**
 * Phase 3 — the Network layer's shared vocabulary (workstreams L, M, N, O, P).
 *
 * Types and pure helpers shared by web and mobile. Anything that renders a
 * community, a feed item, a trust chip or a mastery score should import from
 * here so the two clients cannot drift into describing the same row two
 * different ways.
 */

// ---------------------------------------------------------------------------
// L — Communities and discovery
// ---------------------------------------------------------------------------

export const COMMUNITY_KINDS = ['institution', 'programme', 'level', 'course', 'topic'] as const;
export type CommunityKind = (typeof COMMUNITY_KINDS)[number];

export interface Community {
  id: string;
  kind: CommunityKind;
  slug: string;
  name: string;
  description: string | null;
  institution_id: string | null;
  programme: string | null;
  study_level: number | null;
  course_id: string | null;
  tags: string[];
  visibility: 'public' | 'private';
  is_official: boolean;
  member_count: number;
}

export interface MyCommunity extends Community {
  role: 'member' | 'moderator' | 'admin';
  /**
   * 'auto' memberships are derived from the academic profile and recomputed on
   * every profile save — the UI must present leaving one as "hide", not
   * "delete", because a re-derivation will otherwise appear to undo it.
   */
  source: 'auto' | 'joined';
}

export interface CommunityDetail extends Community {
  isMember: boolean;
  /** Present when the viewer is a member — drives Hide vs Leave. */
  source?: MyCommunity['source'] | null;
}

export interface DiscoverGroup {
  id: string;
  name: string;
  description: string | null;
  avatarUrl: string | null;
  memberCount: number;
  questionCount: number;
  tags: string[];
  communityId: string | null;
  courseId: string | null;
  visibility: 'private' | 'community' | 'public';
  isMember: boolean;
}

export interface DiscoverPerson {
  id: string;
  name: string;
  avatarUrl: string | null;
  programme: string | null;
  trustLevel: TrustLevel;
  activePacks: number;
  learnersHelped: number;
  followerCount: number;
}

const COMMUNITY_KIND_LABELS: Record<CommunityKind, string> = {
  institution: 'Campus',
  programme: 'Programme',
  level: 'Year',
  course: 'Course',
  topic: 'Interest',
};

export function communityKindLabel(kind: CommunityKind | string): string {
  return COMMUNITY_KIND_LABELS[kind as CommunityKind] ?? 'Community';
}

/** "1,204 members" / "1 member" — used identically on both clients. */
export function memberCountLabel(count: number): string {
  const n = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  return `${n.toLocaleString()} ${n === 1 ? 'member' : 'members'}`;
}

/**
 * One-line explainer under each Discover tab. Kept here so web and mobile
 * cannot describe the same hub two different ways.
 */
export const DISCOVER_SECTION_INTRO: Record<'communities' | 'groups' | 'people', string> = {
  communities:
    'Campus and course rooms made from your university, programme and courses. Join one to find study groups inside it.',
  groups:
    'Study chats you can find and join. They stay private until an owner lists them here.',
  people:
    'Students who published a study pack or question bank — tap a card to open their shop.',
};

export const DISCOVER_COMING_SOON_TITLE = 'Discover';
export const DISCOVER_COMING_SOON_BODY =
  'Coming soon — campus rooms and people are still being set up.';

/**
 * The Discover hub (communities, groups, people, Start a room) is platform-admin
 * only until campus rooms ship. Marketplace as a standalone destination is not
 * gated by this.
 */
export function canAccessDiscoverHub(isPlatformAdmin: boolean): boolean {
  return isPlatformAdmin === true;
}

/**
 * Auto-derived campus rooms come back on the next profile save, so the honest
 * action is Hide, not Leave. Joined rooms can actually be left.
 */
export function communityMembershipAction(
  isMember: boolean,
  source?: MyCommunity['source'] | null
): 'Join' | 'Leave' | 'Hide' {
  if (!isMember) return 'Join';
  return source === 'auto' ? 'Hide' : 'Leave';
}

/**
 * Groups listed on a community page. Community-scoped rooms stay hidden
 * until the viewer has joined that community — otherwise the public slug
 * would leak private study chats.
 */
export function communityPageGroupVisibilities(
  viewerIsMember: boolean
): Array<'public' | 'community'> {
  return viewerIsMember ? ['public', 'community'] : ['public'];
}

const DISCOVERY_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Groups are private by default. Listing one on Discover is an explicit act.
 * A 'community' listing without a community id would silently leak a private
 * room, so it collapses back to private.
 */
export function resolveGroupDiscovery(input: {
  visibility?: 'private' | 'community' | 'public' | null;
  communityId?: string | null;
}): { visibility: 'private' | 'community' | 'public'; communityId: string | null } {
  const visibility =
    input.visibility === 'community' || input.visibility === 'public'
      ? input.visibility
      : 'private';
  const communityId =
    typeof input.communityId === 'string' && DISCOVERY_UUID_RE.test(input.communityId)
      ? input.communityId
      : null;
  if (visibility === 'private') return { visibility: 'private', communityId: null };
  if (visibility === 'community' && !communityId) {
    return { visibility: 'private', communityId: null };
  }
  return { visibility, communityId };
}

// ---------------------------------------------------------------------------
// M — Academic feed and presence
// ---------------------------------------------------------------------------

export const ACTIVITY_VERBS = [
  'published_pack',
  'published_bank',
  'shared_note',
  'joined_group',
  'joined_community',
  'completed_challenge',
  'unlocked_badge',
  'followed_creator',
  'added_deck_collaborator',
  'answered_question',
] as const;
export type ActivityVerb = (typeof ACTIVITY_VERBS)[number];

export type ActivityAudience = 'community' | 'group' | 'followers' | 'public';

export interface FeedActor {
  id: string;
  name: string;
  avatarUrl: string | null;
  programme: string | null;
}

export interface FeedItem {
  id: number;
  verb: ActivityVerb;
  objectType: string | null;
  objectId: string | null;
  audienceType: ActivityAudience;
  audienceId: string | null;
  courseId: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
  actor: FeedActor | null;
}

export interface FeedPage {
  items: FeedItem[];
  nextCursor: string | null;
}

/**
 * One sentence describing a feed item. Kept here rather than in each client so
 * the web and mobile feeds cannot describe the same event differently.
 * Returns null for a verb we have no copy for — callers should skip the row
 * rather than render a blank card.
 */
export function describeFeedItem(item: FeedItem): string | null {
  const who = item.actor?.name || 'Someone';
  const title = typeof item.payload?.title === 'string' ? item.payload.title : null;
  const groupName = typeof item.payload?.groupName === 'string' ? item.payload.groupName : null;

  switch (item.verb) {
    case 'published_pack':
      return title ? `${who} published a study pack — ${title}` : `${who} published a study pack`;
    case 'published_bank':
      return title ? `${who} published a question bank — ${title}` : `${who} published a question bank`;
    case 'shared_note':
      return title ? `${who} shared a note — ${title}` : `${who} shared a note`;
    case 'joined_group':
      return groupName ? `${who} joined ${groupName}` : `${who} joined the group`;
    case 'joined_community':
      return title ? `${who} joined ${title}` : `${who} joined a community`;
    case 'completed_challenge':
      return `${who} completed a challenge`;
    case 'unlocked_badge':
      return title ? `${who} unlocked the ${title} badge` : `${who} unlocked a badge`;
    case 'followed_creator':
      return `${who} followed a creator`;
    case 'added_deck_collaborator':
      return title ? `${who} is collaborating on ${title}` : `${who} added a deck collaborator`;
    case 'answered_question':
      return `${who} answered a question`;
    default:
      return null;
  }
}

export const PRESENCE_CONTEXTS = ['studying', 'reviewing', 'testing', 'reading', 'writing'] as const;
export type PresenceContext = (typeof PRESENCE_CONTEXTS)[number];

export interface PresenceSnapshot {
  total: number;
  byContext: Record<string, number>;
  topics: Array<{ topic: string; count: number }>;
  /** Whether the VIEWER shares their own activity — drives the reciprocity nudge. */
  sharing: boolean;
  /** Course most present people are in — Join room uses this. */
  joinCourseId?: string | null;
  joinTopic?: string | null;
}

/**
 * "23 studying right now" / "23 studying cardiology right now".
 * Returns null when nobody is present, so callers render nothing rather than
 * an honest-but-dispiriting "0 studying".
 */
export function presenceLabel(snapshot: PresenceSnapshot | null | undefined): string | null {
  if (!snapshot || snapshot.total <= 0) return null;
  const top = snapshot.topics[0];
  const people = snapshot.total === 1 ? '1 person' : `${snapshot.total} people`;
  return top ? `${people} studying ${top.topic} right now` : `${people} studying right now`;
}

// ---------------------------------------------------------------------------
// N — Trust
// ---------------------------------------------------------------------------

export const TRUST_LEVELS = ['new', 'rising', 'trusted', 'verified'] as const;
export type TrustLevel = (typeof TRUST_LEVELS)[number];

const TRUST_LABELS: Record<TrustLevel, string> = {
  new: 'New creator',
  rising: 'Rising',
  trusted: 'Trusted',
  verified: 'Verified',
};

export function trustLabel(level: TrustLevel | string | null | undefined): string | null {
  if (!level) return null;
  return TRUST_LABELS[level as TrustLevel] ?? null;
}

/**
 * Whether a trust level is worth showing a chip for. 'new' deliberately gets
 * NO chip: labelling every newcomer "New creator" on every card reads as a
 * warning and punishes exactly the people we want publishing.
 */
export function shouldShowTrustChip(level: TrustLevel | string | null | undefined): boolean {
  return level === 'rising' || level === 'trusted' || level === 'verified';
}

export const DISPUTE_CATEGORIES = [
  'not_received',
  'not_as_described',
  'damaged',
  'wrong_item',
  'seller_unresponsive',
  'unauthorised',
  'other',
] as const;
export type DisputeCategory = (typeof DISPUTE_CATEGORIES)[number];

export const DISPUTE_CATEGORY_LABELS: Record<DisputeCategory, string> = {
  not_received: "I never received it",
  not_as_described: "It's not what was described",
  damaged: 'It arrived damaged',
  wrong_item: 'I received the wrong item',
  seller_unresponsive: "The seller isn't responding",
  unauthorised: "I didn't authorise this purchase",
  other: 'Something else',
};

export const DISPUTE_REASON_MAX = 1000;

// ---------------------------------------------------------------------------
// O — Learning connections
// ---------------------------------------------------------------------------

export interface LearningConnectionSummary {
  helpedThisWeek: number;
  helpedByThisWeek: number;
  helpedAllTime: number;
}

/**
 * "You helped 4 people learn this week". Returns null at zero — a "you helped
 * 0 people" line is a reproach, not a metric.
 */
export function learningConnectionLabel(
  summary: LearningConnectionSummary | null | undefined
): string | null {
  if (!summary || summary.helpedThisWeek <= 0) return null;
  const n = summary.helpedThisWeek;
  return `You helped ${n} ${n === 1 ? 'person' : 'people'} learn this week`;
}

// ---------------------------------------------------------------------------
// P — Mastery graph
// ---------------------------------------------------------------------------

export interface TopicMastery {
  topic: string;
  courseId: string | null;
  attempts: number;
  correct: number;
  accuracy: number;
  avgResponseS: number | null;
  lastAttemptAt: string | null;
  cardsTotal: number;
  cardsMature: number;
  cardsDue: number;
  leechCount: number;
  /** NULL means "not enough evidence yet" — never render it as 0 %. */
  masteryScore: number | null;
}

export interface MasteryGraph {
  topics: TopicMastery[];
  weak: TopicMastery[];
  strong: TopicMastery[];
}

export interface ExamReadiness {
  courseId: string;
  courseCode: string | null;
  examDate: string;
  daysUntil: number;
  topicsTracked: number;
  averageMastery: number | null;
  weakestTopics: string[];
}

export type MasteryBand = 'unknown' | 'weak' | 'developing' | 'strong';

/**
 * Band a mastery score for display. A null score is 'unknown', NOT 'weak':
 * telling a student they are weak at something we have never tested them on
 * is the fastest way to lose their trust in everything else we say.
 */
export function masteryBand(score: number | null | undefined): MasteryBand {
  if (score == null || !Number.isFinite(score)) return 'unknown';
  if (score < 60) return 'weak';
  if (score < 80) return 'developing';
  return 'strong';
}

export const MASTERY_BAND_LABELS: Record<MasteryBand, string> = {
  unknown: 'Not enough data yet',
  weak: 'Needs work',
  developing: 'Getting there',
  strong: 'Strong',
};

/** "16 days to your exam" / "Exam today". */
export function examCountdownLabel(daysUntil: number): string {
  if (daysUntil <= 0) return 'Exam today';
  if (daysUntil === 1) return '1 day to your exam';
  return `${daysUntil} days to your exam`;
}

/** Minimum cohort before any population aggregate is shown. Mirrors the RPC. */
export const MASTERY_MIN_COHORT = 20;

// ---------------------------------------------------------------------------
// Q — Referrals and ambassadors (Phase 4)
// ---------------------------------------------------------------------------

export interface ReferralRow {
  id: string;
  refereeId: string;
  /** First name only — a referrer does not get a directory of full names. */
  refereeName: string | null;
  status: 'pending' | 'qualified' | 'rewarded';
  createdAt: string;
  qualifiedAt: string | null;
  rewardAmount: number | null;
}

export interface ReferralSummary {
  code: string | null;
  isAmbassador: boolean;
  total: number;
  pending: number;
  qualified: number;
  coinsEarned: number;
  referrals: ReferralRow[];
}

export const REFERRAL_REWARD_REFERRER = 200;
export const REFERRAL_REWARD_REFEREE = 100;

/** Build the shareable invite link for a code. */
export function referralLink(code: string, origin = 'https://lanternstudy.com'): string {
  return `${origin}/signup?ref=${encodeURIComponent(code)}`;
}

/**
 * The message a student actually sends. Kept here so web and mobile share one
 * wording — an invite that reads differently per platform looks like a scam.
 */
export function referralShareMessage(code: string, origin?: string): string {
  return (
    `I'm using Lantern Study for flashcards, past questions and study groups. ` +
    `Join with my link and we both get ${REFERRAL_REWARD_REFEREE} coins once you get going: ` +
    referralLink(code, origin)
  );
}

const REFERRAL_STATUS_LABELS: Record<ReferralRow['status'], string> = {
  pending: 'Signed up',
  qualified: 'Started studying',
  rewarded: 'Bonus paid',
};

export function referralStatusLabel(status: ReferralRow['status']): string {
  return REFERRAL_STATUS_LABELS[status] ?? 'Signed up';
}

/**
 * Explains the gate honestly. The reward lands when the person you invited
 * actually studies — saying so up front prevents the "I invited 5 people and
 * got nothing" support ticket.
 */
export const REFERRAL_ACTIVATION_EXPLAINER =
  'Your bonus lands once they have really started — about ten study actions across two different days.';

export * from './studyRooms';
