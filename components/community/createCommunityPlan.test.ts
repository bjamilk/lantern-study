import { describe, expect, it } from 'vitest';
import {
  COMMUNITY_DESCRIPTION_MAX,
  COMMUNITY_PURPOSES,
  COMMUNITY_TAGS_MAX,
  buildCreateCommunityRequest,
  communityBadgeLabel,
  composeEventDescription,
  createdCommunityKind,
  normalizeCommunityTags,
  validateCreateCommunity,
  type CreateCommunityDraft,
} from './createCommunityPlan';

const draft = (over: Partial<CreateCommunityDraft> = {}): CreateCommunityDraft => ({
  name: 'Hostel B Block',
  purposeId: 'hostel',
  description: '',
  tags: '',
  ...over,
});

describe('validateCreateCommunity', () => {
  it('accepts a named community with a purpose', () => {
    expect(validateCreateCommunity(draft())).toEqual({});
  });

  it('asks for a longer name rather than failing silently', () => {
    expect(validateCreateCommunity(draft({ name: 'AB' })).name).toBeTruthy();
  });

  it('requires a purpose — an untagged room is unfindable', () => {
    expect(validateCreateCommunity(draft({ purposeId: null })).purposeId).toBeTruthy();
  });

  it('rejects a description the API would truncate', () => {
    const long = 'x'.repeat(COMMUNITY_DESCRIPTION_MAX + 1);
    expect(validateCreateCommunity(draft({ description: long })).description).toBeTruthy();
  });
});

describe('normalizeCommunityTags', () => {
  it('leads with the purpose tag and dedupes the typed ones', () => {
    expect(normalizeCommunityTags('Study, study, Past Questions', 'study')).toEqual([
      'study',
      'past-questions',
    ]);
  });

  it('drops fragments that are not tags instead of rejecting the form', () => {
    expect(normalizeCommunityTags('!!!, ---, ok', null)).toEqual(['ok']);
  });

  it('caps the list', () => {
    const many = 'a,b,c,d,e,f,g,h';
    expect(normalizeCommunityTags(many, 'club')).toHaveLength(COMMUNITY_TAGS_MAX);
  });
});

describe('composeEventDescription', () => {
  it('keeps when and where as readable lines under the description', () => {
    expect(
      composeEventDescription({ description: 'Rag week.', when: 'Fri 12 Sep', where: 'Main field' })
    ).toBe('Rag week.\nWhen: Fri 12 Sep\nWhere: Main field');
  });

  it('renders nothing for an empty event', () => {
    expect(composeEventDescription({ description: '  ' })).toBe('');
  });
});

describe('buildCreateCommunityRequest', () => {
  it('sends only what POST /communities accepts', () => {
    const body = buildCreateCommunityRequest(
      draft({ description: '  Ground floor.  ', tags: 'hall' })
    );
    expect(body).toEqual({
      name: 'Hostel B Block',
      kind: 'hostel',
      description: 'Ground floor.',
      tags: ['hostel', 'hall'],
    });
    // No visibility, no code, no event columns — none of them is offered yet.
    expect(Object.keys(body ?? {}).sort()).toEqual(['description', 'kind', 'name', 'tags']);
  });

  it('folds an event when/where into the description it can actually store', () => {
    const body = buildCreateCommunityRequest(
      draft({
        name: 'Faculty Week 2026',
        purposeId: 'event',
        description: 'Everyone welcome.',
        eventWhen: 'Mon 15 Sep, 10am',
        eventWhere: 'Faculty quad',
      })
    );
    expect(body?.description).toBe(
      'Everyone welcome.\nWhen: Mon 15 Sep, 10am\nWhere: Faculty quad'
    );
    expect(body?.tags).toEqual(['event']);
  });

  it('refuses an invalid draft rather than posting a half-formed room', () => {
    expect(buildCreateCommunityRequest(draft({ name: '' }))).toBeNull();
  });

  it('omits empty optional keys', () => {
    const body = buildCreateCommunityRequest(draft({ purposeId: null, name: 'Chess Club' }));
    expect(body).toBeNull();
    const ok = buildCreateCommunityRequest(draft({ name: 'Chess Club', purposeId: 'club' }));
    expect(ok).toEqual({ name: 'Chess Club', kind: 'club', tags: ['club'] });
  });
});

describe('the surface the server actually supports', () => {
  it('writes a social kind per purpose — the academic kinds are derived, not hand-made', () => {
    expect(createdCommunityKind('study')).toBe('topic');
    expect(createdCommunityKind('hostel')).toBe('hostel');
    expect(createdCommunityKind(null)).toBe('topic');
    for (const purpose of COMMUNITY_PURPOSES) {
      expect(['institution', 'programme', 'level', 'course']).not.toContain(purpose.kind);
    }
  });

  it('offers campus life, not only study', () => {
    const ids = COMMUNITY_PURPOSES.map((p) => p.id);
    expect(ids).toEqual(
      expect.arrayContaining(['study', 'club', 'hostel', 'event', 'faith', 'sports', 'interest'])
    );
  });
});

describe('communityBadgeLabel', () => {
  const kindLabel = (kind: string) => (kind === 'topic' ? 'Topic' : 'Course');

  it('names the purpose rather than saying "Topic" about every student room', () => {
    expect(communityBadgeLabel('topic', ['hostel', 'hall'], kindLabel)).toBe('Hostel or hall');
  });

  it('falls back to the kind for academic rooms', () => {
    expect(communityBadgeLabel('course', ['study'], kindLabel)).toBe('Course');
  });

  it('falls back to the kind for a room made before purposes existed', () => {
    expect(communityBadgeLabel('topic', [], kindLabel)).toBe('Topic');
    expect(communityBadgeLabel('topic', null, kindLabel)).toBe('Topic');
  });
});
