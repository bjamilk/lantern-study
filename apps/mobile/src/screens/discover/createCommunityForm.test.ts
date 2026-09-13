import { communityChipOf } from '../campus/communityHubModel';
import {
  COMMUNITY_DESCRIPTION_MAX,
  COMMUNITY_PURPOSES,
  EMPTY_CREATE_COMMUNITY_DRAFT,
  buildCreateCommunityRequest,
  composeEventDescription,
  purposeIcon,
  validateCreateCommunity,
  type CreateCommunityDraft,
} from './createCommunityForm';

const draft = (over: Partial<CreateCommunityDraft> = {}): CreateCommunityDraft => ({
  ...EMPTY_CREATE_COMMUNITY_DRAFT,
  name: 'Chess club',
  purposeId: 'club',
  ...over,
});

describe('validation', () => {
  it('refuses a name that is too short and a description that is too long', () => {
    expect(validateCreateCommunity(draft({ name: 'ab' })).name).toBeDefined();
    expect(
      validateCreateCommunity(draft({ description: 'x'.repeat(COMMUNITY_DESCRIPTION_MAX + 1) }))
        .description
    ).toBeDefined();
  });

  it('requires a purpose, because it is what the chips and the glyph read', () => {
    expect(validateCreateCommunity(draft({ purposeId: null })).purposeId).toBeDefined();
    expect(buildCreateCommunityRequest(draft({ purposeId: null }))).toBeNull();
  });

  it('collapses runs of whitespace in the name it sends', () => {
    expect(buildCreateCommunityRequest(draft({ name: '  Chess   club  ' }))?.name).toBe('Chess club');
  });
});

describe('what survives the round trip', () => {
  it('sends only the keys the endpoint accepts, kind included', () => {
    const body = buildCreateCommunityRequest(draft({ description: 'Every Friday' }));
    expect(Object.keys(body ?? {}).sort()).toEqual([
      'description',
      'kind',
      'name',
      'tags',
      'visibility',
    ]);
    expect(body?.visibility).toBe('public');
    expect(body?.kind).toBe('club');
  });

  it('carries the purpose as the tag the hub reads back', () => {
    // The server stores every student-made room as `topic`; the tag is the only
    // thing that puts a hostel under Hostel rather than under Interests.
    for (const purpose of COMMUNITY_PURPOSES) {
      const body = buildCreateCommunityRequest(draft({ purposeId: purpose.id }));
      expect(body?.tags).toEqual([purpose.tag]);
      expect(communityChipOf({ kind: 'topic', tags: body?.tags ?? [] })).not.toBe('academic');
    }
  });

  it('files a club under Clubs and a hostel under Hostel once it comes back', () => {
    const club = buildCreateCommunityRequest(draft({ purposeId: 'club' }));
    expect(communityChipOf({ kind: 'topic', tags: club?.tags ?? [] })).toBe('clubs');
    const hostel = buildCreateCommunityRequest(draft({ purposeId: 'hostel' }));
    expect(communityChipOf({ kind: 'topic', tags: hostel?.tags ?? [] })).toBe('hostel');
  });

  it('sends private when asked, and keeps prose when/where in the description', () => {
    const body = buildCreateCommunityRequest(
      draft({
        purposeId: 'event',
        visibility: 'private',
        eventWhen: 'Fri 12 Sep, 4pm',
        eventWhere: 'Main hall',
      })
    );
    expect(body?.visibility).toBe('private');
    expect(body).not.toHaveProperty('startsAt');
  });

  it('writes a parseable event time onto startsAt', () => {
    const body = buildCreateCommunityRequest(
      draft({
        purposeId: 'event',
        description: 'Rag week',
        eventWhen: '2026-09-15T10:00',
        eventWhere: 'Main hall',
      })
    );
    expect(body?.startsAt).toBe(new Date('2026-09-15T10:00').toISOString());
    expect(body?.location).toBe('Main hall');
    expect(body?.description).toBe('Rag week');
  });

  it('keeps an event’s when and where by writing them into the description', () => {
    const body = buildCreateCommunityRequest(
      draft({
        purposeId: 'event',
        description: 'Rag week',
        eventWhen: 'Fri 12 Sep, 4pm',
        eventWhere: 'Main hall',
      })
    );
    expect(body?.description).toBe('Rag week\nWhen: Fri 12 Sep, 4pm\nWhere: Main hall');
  });

  it('does not put when/where on a room that is not an event', () => {
    const body = buildCreateCommunityRequest(
      draft({ purposeId: 'club', description: 'Chess', eventWhen: 'Friday' })
    );
    expect(body?.description).toBe('Chess');
  });

  it('composes nothing out of nothing', () => {
    expect(composeEventDescription({ description: '' })).toBe('');
  });
});

describe('purposes', () => {
  it('offers no academic kind — those are derived from the profile', () => {
    for (const purpose of COMMUNITY_PURPOSES) {
      expect(['institution', 'programme', 'level', 'course']).not.toContain(purpose.kind);
    }
  });

  it('takes each glyph from the shared kind meta rather than choosing one', () => {
    expect(purposeIcon(COMMUNITY_PURPOSES.find((p) => p.id === 'hostel')!)).toBe('home');
    expect(purposeIcon(COMMUNITY_PURPOSES.find((p) => p.id === 'event')!)).toBe('calendar');
  });
});
