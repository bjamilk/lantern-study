import { COMMUNITY_KINDS, parseCommunityEventStart } from './communityGovernance';
import {
  COMMUNITY_CHIPS,
  COMMUNITY_DISCOVER_LIMIT,
  buildCommunityHomeActivity,
  buildCommunityHub,
  chipServerKind,
  communityCardMeta,
  communityChipLabel,
  communityChipOf,
  communityHeaderMeta,
  compareYoursCommunities,
  discoverKindOrFilter,
  effectiveCommunityKind,
  matchesChip,
  planCommunityDiscovery,
  type HubCommunity,
  type HubMyCommunity,
} from './communityHub';
import type { CommunityChannel, CommunityChannels } from './communityServer';

const community = (over: Partial<HubCommunity> = {}): HubCommunity => ({
  id: over.id ?? 'c1',
  kind: over.kind ?? 'topic',
  name: over.name ?? 'Room',
  description: over.description ?? null,
  tags: over.tags ?? [],
  institution_id: over.institution_id ?? null,
  member_count: over.member_count ?? 0,
  ...(over.created_at !== undefined ? { created_at: over.created_at } : {}),
  ...(over.starts_at !== undefined ? { starts_at: over.starts_at } : {}),
});

const mine = (over: Partial<HubMyCommunity> = {}): HubMyCommunity => ({
  ...community(over),
  source: over.source ?? 'joined',
});

describe('chips', () => {
  it('draws the founder order with All last', () => {
    expect(COMMUNITY_CHIPS.map(communityChipLabel)).toEqual([
      'Academic',
      'Interests',
      'Clubs',
      'Hostel',
      'Events',
      'Faith',
      'Sports',
      'All',
    ]);
  });

  it('places every shared kind under exactly one chip', () => {
    for (const kind of COMMUNITY_KINDS) {
      expect(COMMUNITY_CHIPS).toContain(communityChipOf(community({ kind })));
    }
  });

  it('reads the four academic kinds as Academic whatever they are tagged', () => {
    for (const kind of ['institution', 'programme', 'level', 'course'] as const) {
      expect(communityChipOf(community({ kind, tags: ['sports'] }))).toBe('academic');
    }
  });
});

describe('the degraded server, where every student-made room is a topic', () => {
  it('reads the purpose tag the create flow wrote', () => {
    expect(effectiveCommunityKind(community({ tags: ['hostel'] }))).toBe('hostel');
    expect(communityChipOf(community({ tags: ['club'] }))).toBe('clubs');
    expect(communityChipOf(community({ tags: ['faith'] }))).toBe('faith');
  });

  it('keeps a study room an interest, not an academic scope', () => {
    expect(communityChipOf(community({ tags: ['study'] }))).toBe('interests');
  });

  it('leaves a real kind alone once the migration lands', () => {
    expect(effectiveCommunityKind(community({ kind: 'event', tags: [] }))).toBe('event');
    expect(communityChipOf(community({ kind: 'sports', tags: [] }))).toBe('sports');
  });

  it('falls an untagged topic room back to Interests rather than nowhere', () => {
    expect(matchesChip(community({ tags: [] }), 'interests')).toBe(true);
  });
});

describe('card and header meta', () => {
  it('takes label, glyph and ink from the shared kind meta', () => {
    expect(communityCardMeta(community({ kind: 'course' }))).toEqual({
      label: 'Course',
      icon: 'book',
      ink: 'campus',
    });
    expect(communityCardMeta(community({ tags: ['hostel'] }))).toEqual({
      label: 'Hostel',
      icon: 'home',
      ink: 'groups',
    });
  });

  it('describes a tag-derived hostel room as Hostel in both places', () => {
    const room = community({ kind: 'topic', tags: ['hostel'], member_count: 1 });
    const card = communityCardMeta(room);
    const header = communityHeaderMeta(room, 1, 1);
    expect(header.label).toBe(card.label);
    expect(header.icon).toBe(card.icon);
    expect(header.line).toBe('Hostel · 1 member · 1 online');
  });
});

describe('Yours order', () => {
  it('puts the campus room first, then other auto rooms, then joined', () => {
    const campus = mine({ id: 'campus', name: 'UNILAG', kind: 'institution', source: 'auto' });
    const course = mine({ id: 'course', name: 'Anatomy', kind: 'course', source: 'auto' });
    const club = mine({ id: 'club', name: 'Chess', source: 'joined' });
    expect([club, course, campus].sort(compareYoursCommunities).map((c) => c.id)).toEqual([
      'campus',
      'course',
      'club',
    ]);
  });
});

describe('the segment', () => {
  it('puts auto campus rooms above joined ones', () => {
    const model = buildCommunityHub({
      mine: [
        mine({ id: 'a', name: 'Zoology club', source: 'joined' }),
        mine({ id: 'b', name: 'Anatomy', source: 'auto' }),
      ],
      discovered: [],
      chip: 'all',
      loadedQuery: '',
      unknown: false,
    });
    expect(model.mine.map((c) => c.id)).toEqual(['b', 'a']);
  });

  it('leads Yours with the institution room', () => {
    const model = buildCommunityHub({
      mine: [
        mine({ id: 'course', name: 'PHARM 212', kind: 'course', source: 'auto' }),
        mine({ id: 'campus', name: 'UNILAG', kind: 'institution', source: 'auto' }),
      ],
      discovered: [],
      chip: 'all',
      loadedQuery: '',
      unknown: false,
    });
    expect(model.mine.map((c) => c.id)).toEqual(['campus', 'course']);
  });

  it('never lists a community the student is already in under Find', () => {
    const model = buildCommunityHub({
      mine: [mine({ id: 'same' })],
      discovered: [community({ id: 'same' }), community({ id: 'other' })],
      chip: 'all',
      loadedQuery: '',
      unknown: false,
    });
    expect(model.find.map((c) => c.id)).toEqual(['other']);
  });

  it('applies the chip to both sections', () => {
    const model = buildCommunityHub({
      mine: [mine({ id: 'course', kind: 'course' }), mine({ id: 'club', tags: ['club'] })],
      discovered: [
        community({ id: 'club2', tags: ['club'] }),
        community({ id: 'campus', kind: 'institution' }),
      ],
      chip: 'clubs',
      loadedQuery: '',
      unknown: false,
    });
    expect(model.mine.map((c) => c.id)).toEqual(['club']);
    expect(model.find.map((c) => c.id)).toEqual(['club2']);
  });

  it('says nothing about what exists when the load failed', () => {
    const model = buildCommunityHub({
      mine: [],
      discovered: [],
      chip: 'all',
      loadedQuery: '',
      unknown: true,
    });
    expect(model.empty).toBe('unknown');
    expect(model.showEmptyIllustration).toBe(false);
  });

  it('separates no-match from a true empty state', () => {
    const filtered = buildCommunityHub({
      mine: [],
      discovered: [],
      chip: 'hostel',
      loadedQuery: '',
      unknown: false,
    });
    expect(filtered.empty).toBe('noMatch');
    expect(filtered.showEmptyIllustration).toBe(false);

    const empty = buildCommunityHub({
      mine: [],
      discovered: [],
      chip: 'all',
      loadedQuery: '',
      unknown: false,
    });
    expect(empty.empty).toBe('empty');
    expect(empty.showEmptyIllustration).toBe(true);
  });
});

describe('discovery plan', () => {
  it('maps the single-kind chips onto the shared vocabulary', () => {
    expect(chipServerKind('hostel')).toBe('hostel');
    expect(chipServerKind('clubs')).toBe('club');
    expect(chipServerKind('academic')).toBeNull();
    expect(chipServerKind('all')).toBeNull();
  });

  it('asks the server for the chip kind and keeps a widening fallback', () => {
    const plan = planCommunityDiscovery({ chip: 'hostel', query: '  moremi  ' });
    expect(plan.params).toEqual({ limit: COMMUNITY_DISCOVER_LIMIT, q: 'moremi', kind: 'hostel' });
    expect(plan.fallback).toEqual({ limit: COMMUNITY_DISCOVER_LIMIT, q: 'moremi' });
  });

  it('includes topic+tag rows in the PostgREST kind filter', () => {
    expect(discoverKindOrFilter('hostel')).toBe(
      'kind.eq.hostel,and(kind.eq.topic,tags.cs.{hostel})',
    );
  });
});

describe('parseCommunityEventStart', () => {
  it('keeps a datetime-local / ISO value and drops prose', () => {
    expect(parseCommunityEventStart('2026-09-15T10:00')).toBe(new Date('2026-09-15T10:00').toISOString());
    expect(parseCommunityEventStart('Fri 12 Sep, 4pm')).toBeNull();
    expect(parseCommunityEventStart('  ')).toBeNull();
  });
});

describe('community home activity', () => {
  const channel = (over: Partial<CommunityChannel>): CommunityChannel => ({
    id: over.id ?? 'ch',
    name: over.name ?? 'board',
    description: null,
    avatarUrl: null,
    memberCount: 2,
    questionCount: 0,
    visibility: 'community',
    courseId: null,
    isLounge: over.isLounge ?? false,
    isMember: over.isMember ?? true,
    unreadCount: over.unreadCount ?? 0,
    lastMessage: over.lastMessage ?? null,
    lastMessageTime: over.lastMessageTime ?? null,
  });

  it('leads with the lounge last line, then latest boards, then open rooms', () => {
    const payload: Pick<CommunityChannels, 'lounge' | 'boards' | 'rooms'> = {
      lounge: channel({
        id: 'lounge',
        isLounge: true,
        lastMessage: 'See you at 4',
        lastMessageTime: '2026-09-12T10:00:00.000Z',
      }),
      boards: [
        channel({
          id: 'old',
          name: 'old',
          lastMessage: 'old post',
          lastMessageTime: '2026-09-01T00:00:00.000Z',
        }),
        channel({
          id: 'new',
          name: 'exam-week',
          lastMessage: 'new post',
          lastMessageTime: '2026-09-12T11:00:00.000Z',
        }),
      ],
      rooms: [
        {
          id: 'room-1',
          title: 'PHARM 212 live',
          courseId: null,
          communityId: 'c1',
          topicId: null,
          topic: null,
          kind: 'room',
          createdBy: null,
          startedAt: new Date(Date.parse('2026-09-12T11:00:00.000Z') - 60 * 60 * 1000).toISOString(),
          isActive: true,
          participantCount: 3,
          presenceChannel: 'study-room:room-1',
          joined: true,
        },
      ],
    };
    const items = buildCommunityHomeActivity(payload, Date.parse('2026-09-12T12:00:00.000Z'));
    expect(items.map((item) => item.kind)).toEqual(['lounge', 'board', 'board', 'room']);
    expect(items[0]?.title).toBe('General');
    expect(items[1]?.id).toBe('new');
  });

  it('omits the strip when nothing has happened', () => {
    expect(
      buildCommunityHomeActivity({
        lounge: channel({ id: 'lounge', isLounge: true }),
        boards: [channel({ id: 'quiet', isMember: true })],
        rooms: [],
      }),
    ).toEqual([]);
  });
});
