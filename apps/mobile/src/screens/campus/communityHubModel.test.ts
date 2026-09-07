import { COMMUNITY_KINDS, type Community, type MyCommunity } from '@lantern/shared/network';
import {
  COMMUNITY_CHIPS,
  buildCommunityHub,
  communityCardMeta,
  communityChipLabel,
  communityChipOf,
  communityHeaderMeta,
  effectiveCommunityKind,
  matchesChip,
} from './communityHubModel';

const community = (over: Partial<Community> = {}): Community => ({
  id: over.id ?? 'c1',
  kind: over.kind ?? 'topic',
  slug: over.slug ?? 'slug',
  name: over.name ?? 'Room',
  description: over.description ?? null,
  institution_id: over.institution_id ?? null,
  programme: null,
  study_level: null,
  course_id: null,
  tags: over.tags ?? [],
  visibility: over.visibility ?? 'public',
  is_official: over.is_official ?? false,
  member_count: over.member_count ?? 0,
  ...(over.created_at !== undefined ? { created_at: over.created_at } : {}),
});

const mine = (over: Partial<MyCommunity> = {}): MyCommunity => ({
  ...community(over),
  role: over.role ?? 'member',
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
    // A kind the sibling lane adds must not fall off the chips silently.
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

describe('the degraded server, where every student-made room is a `topic`', () => {
  it('reads the purpose tag the create flow wrote', () => {
    expect(effectiveCommunityKind(community({ tags: ['hostel'] }))).toBe('hostel');
    expect(communityChipOf(community({ tags: ['club'] }))).toBe('clubs');
    expect(communityChipOf(community({ tags: ['faith'] }))).toBe('faith');
  });

  it('keeps a study room an interest, not an academic scope', () => {
    // A student-made study room beside a derived course room would make the
    // course room's meaning (verified past questions) worthless.
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

describe('card meta', () => {
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
});

describe('header meta', () => {
  it('describes a tag-derived hostel room as Hostel in BOTH places', () => {
    // Build 172: the detail HEADER read "Interest · 1 member · 1 online" while
    // the list card read "Hostel · 1 member" with the house glyph, for the one
    // room. Both now come through `effectiveCommunityKind`.
    const room = community({ kind: 'topic', tags: ['hostel'], member_count: 1 });
    const card = communityCardMeta(room);
    const header = communityHeaderMeta(room, room.member_count, 1);

    expect(card).toEqual({ label: 'Hostel', icon: 'home', ink: 'groups' });
    expect(header.label).toBe(card.label);
    expect(header.icon).toBe(card.icon);
    expect(header.ink).toBe(card.ink);
    expect(header.line).toBe('Hostel · 1 member · 1 online');
  });

  it('omits the online count at zero, like the shared line does', () => {
    expect(communityHeaderMeta(community({ kind: 'course', member_count: 1204 }), 1204, 0).line).toBe(
      'Course · 1,204 members'
    );
  });

  it('leaves a real kind alone once the migration lands', () => {
    const room = community({ kind: 'sports', tags: [], member_count: 2 });
    expect(communityHeaderMeta(room, 2, 0)).toEqual({
      label: 'Sports',
      icon: 'trophy',
      ink: 'groups',
      line: 'Sports · 2 members',
    });
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

  it('ranks Find with the shared comparator: own campus, then busiest', () => {
    const model = buildCommunityHub({
      mine: [],
      discovered: [
        community({ id: 'big', member_count: 900, institution_id: 'other' }),
        community({ id: 'mine-small', member_count: 3, institution_id: 'inst-1' }),
        community({ id: 'mine-big', member_count: 40, institution_id: 'inst-1' }),
      ],
      chip: 'all',
      loadedQuery: '',
      institutionId: 'inst-1',
      unknown: false,
    });
    expect(model.find.map((c) => c.id)).toEqual(['mine-big', 'mine-small', 'big']);
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

  it('searches the rooms already joined, so a search does not leave them all on screen', () => {
    const model = buildCommunityHub({
      mine: [mine({ id: 'a', name: 'Anatomy' }), mine({ id: 'b', name: 'Chess' })],
      discovered: [],
      chip: 'all',
      loadedQuery: 'chess',
      unknown: false,
    });
    expect(model.mine.map((c) => c.id)).toEqual(['b']);
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

  it('separates "no match for this chip" from a true empty state', () => {
    const filtered = buildCommunityHub({
      mine: [],
      discovered: [],
      chip: 'hostel',
      loadedQuery: '',
      unknown: false,
    });
    expect(filtered.empty).toBe('noMatch');
    // The campus-hall picture belongs to the student who is starting out, not
    // to one who filtered themselves into an empty chip.
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
