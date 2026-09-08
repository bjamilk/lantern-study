import { communityDisplayName, memberCountLabel } from './communityLabels';

describe('memberCountLabel', () => {
  it('is singular at one', () => {
    expect(memberCountLabel(1)).toBe('1 member');
    expect(memberCountLabel(0)).toBe('0 members');
    expect(memberCountLabel(2)).toBe('2 members');
  });
});

describe('communityDisplayName', () => {
  it('collapses a derived course name whose code and title are identical', () => {
    // What Campus actually showed: the row for course PHARM 212, whose title
    // a student had typed as its own code.
    expect(communityDisplayName('PHARM 212 — PHARM 212')).toBe('PHARM 212');
    expect(communityDisplayName('pharm 212 — PHARM 212')).toBe('pharm 212');
  });

  it('keeps a real code-and-title pair intact', () => {
    expect(communityDisplayName('PHARM 212 — Pharmacology II')).toBe(
      'PHARM 212 — Pharmacology II'
    );
  });

  it('never touches a hyphen, which is ordinary punctuation in a name', () => {
    expect(communityDisplayName('Ben&Peace - Ben&Peace')).toBe('Ben&Peace - Ben&Peace');
  });

  it('leaves names with no separator, or several, alone', () => {
    expect(communityDisplayName('Pilot hall test')).toBe('Pilot hall test');
    expect(communityDisplayName('A — B — A')).toBe('A — B — A');
    expect(communityDisplayName('  200 level  ')).toBe('200 level');
    expect(communityDisplayName(null)).toBe('');
  });
});
