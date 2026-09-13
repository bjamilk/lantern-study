import {
  STUDY_SET_SHARE_ORIGIN,
  buildStudySetShareLink,
  studySetShareUrl,
} from './shareLink';

describe('studySetShareUrl', () => {
  it('builds the set room path against the supplied origin', () => {
    expect(studySetShareUrl('abc-123', 'https://staging.example.com')).toBe(
      'https://staging.example.com/study/sets/abc-123'
    );
  });

  it('falls back to the production origin when none is given', () => {
    expect(studySetShareUrl('abc-123')).toBe(`${STUDY_SET_SHARE_ORIGIN}/study/sets/abc-123`);
  });

  it('strips a trailing slash rather than emitting a double slash', () => {
    expect(studySetShareUrl('abc', 'https://lanternstudy.com/')).toBe(
      'https://lanternstudy.com/study/sets/abc'
    );
  });

  it('rejects a non-web origin so a native scheme never becomes a link', () => {
    // Mobile has no `window.location`; a caller passing the app scheme by
    // mistake must still produce something a recipient could paste.
    expect(studySetShareUrl('abc', 'lanternstudy://')).toBe(
      `${STUDY_SET_SHARE_ORIGIN}/study/sets/abc`
    );
    expect(studySetShareUrl('abc', 'about:blank')).toBe(
      `${STUDY_SET_SHARE_ORIGIN}/study/sets/abc`
    );
  });

  it('encodes an id that would otherwise break the path', () => {
    expect(studySetShareUrl('a/b?c', 'https://x.test')).toBe('https://x.test/study/sets/a%2Fb%3Fc');
  });
});

describe('buildStudySetShareLink', () => {
  it('never claims the recipient can open the link', () => {
    // The invariant the whole module exists for: sharing is not implemented,
    // so no phrasing may promise access. Guarded for BOTH visibilities.
    for (const visibility of ['private', 'public'] as const) {
      const share = buildStudySetShareLink({ setId: 's1', title: 'Anatomy', visibility });
      expect(share.recipientCanOpen).toBe(false);
      expect(share.toast).toContain('only you can open it for now');
      expect(share.message).toContain('only you can open the link for now');
      expect(share.toast.toLowerCase()).not.toContain('anyone with the link');
      // The caveat is made ONCE. It used to be pasted twice into the body
      // ("Only the owner can open this link for now — this set is private, so
      // only you can open it for now"), which is the stutter this guards.
      expect(share.message.match(/only you can open/g)).toHaveLength(1);
      expect(share.message).not.toContain('Only the owner can open this link');
    }
  });

  it('says a private set is private', () => {
    const share = buildStudySetShareLink({ setId: 's1', title: 'Anatomy', visibility: 'private' });
    expect(share.toast).toBe('Link copied. This set is private — only you can open it for now.');
    expect(share.message.endsWith('This set is private — only you can open the link for now.')).toBe(
      true
    );
  });

  it('explains why a set the student already marked public still is not open', () => {
    const share = buildStudySetShareLink({ setId: 's1', title: 'Anatomy', visibility: 'public' });
    expect(share.toast).toBe(
      'Link copied. Public sets are not readable by anyone else yet — only you can open it for now.'
    );
  });

  it('treats a missing or unknown visibility as private', () => {
    expect(buildStudySetShareLink({ setId: 's1', title: 'A' }).toast).toContain(
      'This set is private'
    );
    expect(
      buildStudySetShareLink({ setId: 's1', title: 'A', visibility: null }).toast
    ).toContain('This set is private');
  });

  it('carries the set name and the url into the share sheet body', () => {
    const share = buildStudySetShareLink({
      setId: 's1',
      title: 'Anatomy 101',
      origin: 'https://x.test',
    });
    expect(share.title).toBe('Anatomy 101');
    expect(share.url).toBe('https://x.test/study/sets/s1');
    expect(share.message.startsWith('Anatomy 101\nhttps://x.test/study/sets/s1')).toBe(true);
  });

  it('falls back to a generic name for an untitled set', () => {
    const share = buildStudySetShareLink({ setId: 's1', title: '   ' });
    expect(share.title).toBe('Study set');
  });
});
