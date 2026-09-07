import {
  INVITE_LINK_UNAVAILABLE,
  communityInviteLink,
  communitySlugLine,
  inviteCodeCopyFailure,
  inviteCopyOutcome,
} from './communityInviteModel';

describe('the invite link', () => {
  it('is built from the slug, using the shared public URL', () => {
    expect(communityInviteLink('ug-biology-101')).toBe(
      'https://lanternstudy.com/discover/c/ug-biology-101'
    );
  });

  it('trims a padded slug rather than building a broken URL', () => {
    expect(communityInviteLink('  hostel-block-c ')).toBe(
      'https://lanternstudy.com/discover/c/hostel-block-c'
    );
  });

  it('yields no link at all when there is no slug', () => {
    // A link built from nothing looks valid and 404s for whoever opens it.
    for (const slug of [null, undefined, '', '   ']) {
      expect(communityInviteLink(slug)).toBeNull();
    }
  });
});

describe('what the student is told after tapping Copy invite link', () => {
  const link = 'https://lanternstudy.com/discover/c/hostel-block-c';

  it('confirms a copy that landed', () => {
    expect(inviteCopyOutcome(true, link)).toEqual({ message: 'Link copied', tone: 'success' });
  });

  it('says a failed copy failed AND carries the link inline', () => {
    // The build-172 defect was silence: the clipboard was empty and the
    // student had no way to reach the link.
    const outcome = inviteCopyOutcome(false, link);
    expect(outcome.tone).toBe('error');
    expect(outcome.message).toContain('Could not copy');
    expect(outcome.message).toContain(link);
  });

  it('carries the code inline when a code copy fails', () => {
    expect(inviteCodeCopyFailure('ABC123')).toContain('ABC123');
  });
});

describe('the slug a founder can read', () => {
  it('spells out the link the slug produces', () => {
    expect(communitySlugLine('hostel-block-c')).toBe(
      'Invite link: https://lanternstudy.com/discover/c/hostel-block-c'
    );
  });

  it('says there is none rather than showing a half-built URL', () => {
    expect(communitySlugLine(null)).toBe(INVITE_LINK_UNAVAILABLE);
  });
});
