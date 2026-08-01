import {
  privateProfileForcesMessageRequest,
  userAppearsInPeopleSearch,
  userDiscoverableForInvites,
} from './privacyPolicy';

describe('people search discoverability', () => {
  it('includes private profiles when discoverableForInvites is true', () => {
    expect(
      userAppearsInPeopleSearch({
        profileVisibility: 'private',
        discoverableForInvites: true,
      })
    ).toBe(true);
  });

  it('includes public and groups profiles when discoverable', () => {
    expect(
      userAppearsInPeopleSearch({
        profileVisibility: 'public',
        discoverableForInvites: true,
      })
    ).toBe(true);
    expect(
      userAppearsInPeopleSearch({
        profileVisibility: 'groups',
        discoverableForInvites: true,
      })
    ).toBe(true);
  });

  it('hides users when discoverableForInvites is false regardless of profileVisibility', () => {
    expect(
      userAppearsInPeopleSearch({
        profileVisibility: 'public',
        discoverableForInvites: false,
      })
    ).toBe(false);
    expect(
      userAppearsInPeopleSearch({
        profileVisibility: 'private',
        discoverableForInvites: false,
      })
    ).toBe(false);
  });

  it('treats missing discoverableForInvites as discoverable', () => {
    expect(userDiscoverableForInvites({} as { discoverableForInvites: boolean })).toBe(true);
  });
});

describe('privateProfileForcesMessageRequest', () => {
  it('is true only for private visibility', () => {
    expect(privateProfileForcesMessageRequest({ profileVisibility: 'private' })).toBe(true);
    expect(privateProfileForcesMessageRequest({ profileVisibility: 'public' })).toBe(false);
    expect(privateProfileForcesMessageRequest({ profileVisibility: 'groups' })).toBe(false);
  });
});
