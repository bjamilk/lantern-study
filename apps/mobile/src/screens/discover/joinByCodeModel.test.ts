import {
  INVITE_REFUSAL_COPY,
  JOIN_BY_CODE_INVALID,
  JOIN_BY_CODE_NOT_FOUND,
  joinByCodeFailureCopy,
  looksLikeInviteCode,
  parseCommunityCode,
  planJoinByCode,
} from './joinByCodeModel';
import { COMMUNITY_NOT_ENABLED_COPY } from '@lantern/shared/api';

describe('what a pasted code resolves to', () => {
  it('reads the slug out of every shape the link arrives in', () => {
    for (const input of [
      'https://lanternstudy.com/discover/c/unilag-medicine',
      'https://lanternstudy.com/discover/c/unilag-medicine/',
      'https://lanternstudy.com/discover/c/unilag-medicine?utm_source=whatsapp',
      'https://lanternstudy.com/discover/c/unilag-medicine#top',
      '/discover/c/unilag-medicine',
      'lanternstudy://discover/join/unilag-medicine',
      'UNILAG-MEDICINE',
    ]) {
      expect(parseCommunityCode(input)).toBe('unilag-medicine');
    }
  });

  it('lands on the community even when the link points deeper into it', () => {
    expect(parseCommunityCode('https://lanternstudy.com/discover/c/unilag-medicine/ch/abc')).toBe(
      'unilag-medicine'
    );
  });

  it('answers null rather than pushing a screen that will 404', () => {
    expect(parseCommunityCode('')).toBeNull();
    expect(parseCommunityCode(null)).toBeNull();
    expect(parseCommunityCode('what even is this ?')).toBeNull();
    expect(parseCommunityCode('https://example.com/')).toBeNull();
  });
});

describe('a real one-time invite code', () => {
  it('is recognised as a code once the slug lookup has come back empty', () => {
    // 8 characters from the shared alphabet. Telling this student "that is not
    // a Lantern link" would send them back to retype something that was right.
    expect(looksLikeInviteCode('ABCD2345')).toBe(true);
  });

  it('does not read a link or a dashed slug as a code', () => {
    expect(looksLikeInviteCode('unilag-medicine')).toBe(false);
    expect(looksLikeInviteCode('https://lanternstudy.com/discover/c/abcd2345')).toBe(false);
  });
});

describe('planJoinByCode — what leaves the device', () => {
  it('reads a code AND a slug out of an ambiguous 8-character string, code first', () => {
    const plan = planJoinByCode('abcd2345');
    expect(plan.code).toBe('ABCD2345');
    expect(plan.slug).toBe('abcd2345');
    expect(plan.error).toBeNull();
  });

  it('pulls the code out of a shared invite link', () => {
    expect(planJoinByCode('https://lanternstudy.com/join/ABCD2345').code).toBe('ABCD2345');
    expect(planJoinByCode('lanternstudy://discover/join/abcd-2345').code).toBe('ABCD2345');
  });

  it('leaves a dashed slug as a slug and nothing else', () => {
    const plan = planJoinByCode('https://lanternstudy.com/discover/c/unilag-medicine');
    expect(plan.code).toBeNull();
    expect(plan.slug).toBe('unilag-medicine');
  });

  it('refuses junk before any request is made', () => {
    const plan = planJoinByCode('what even is this ?');
    expect(plan.code).toBeNull();
    expect(plan.slug).toBeNull();
    expect(plan.error).toBe(JOIN_BY_CODE_INVALID);
  });
});

describe('joinByCodeFailureCopy — what a refusal says', () => {
  const notEnabled = Object.assign(new Error('community invites are not available yet'), {
    notEnabled: true,
    code: 'NOT_ENABLED',
    status: 503,
  });

  it('says the tool is not switched on for a pre-migration API', () => {
    expect(joinByCodeFailureCopy(notEnabled, true)).toBe(COMMUNITY_NOT_ENABLED_COPY);
    expect(joinByCodeFailureCopy(notEnabled, false)).toBe(COMMUNITY_NOT_ENABLED_COPY);
  });

  it('gives every refused code the same sentence — never an oracle', () => {
    const unknown = Object.assign(new Error('Invite not found'), { status: 404 });
    const expired = Object.assign(new Error('That invite expired at 12:00'), { status: 404 });
    expect(joinByCodeFailureCopy(unknown, true)).toBe(INVITE_REFUSAL_COPY);
    expect(joinByCodeFailureCopy(expired, true)).toBe(INVITE_REFUSAL_COPY);
  });

  it('speaks about the community when there was no code to redeem', () => {
    expect(joinByCodeFailureCopy(new Error('nope'), false)).toBe(JOIN_BY_CODE_NOT_FOUND);
  });
});
