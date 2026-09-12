/**
 * Every test session created inside a set must say which set it is in.
 *
 * Live, a set room's Test tab was empty for every set: the tab lists
 * `GET /tests?studySetId=…` and not one of the account's 77 sessions carried a
 * `study_set_id`. Only the personal-test door ever sent one; the session and
 * draft doors built their payloads inline and dropped it. These are the rules
 * the shared builder now enforces at every door.
 */
import { describe, expect, it } from 'vitest';
import { resolveSessionStudySetId, withStudySetId } from './testSessionPayload';

const SET = 'fdbfd2b9-1111-4222-8333-444444444444';

describe('resolveSessionStudySetId', () => {
  it('reads the set off the config, which is what every create path already sends', () => {
    expect(resolveSessionStudySetId({ config: { studySetId: SET } })).toBe(SET);
  });

  it('prefers an explicit set over the config, since the caller named the room', () => {
    expect(
      resolveSessionStudySetId({ studySetId: SET, config: { studySetId: 'other-set' } })
    ).toBe(SET);
  });

  it('is null for a session that belongs to no set', () => {
    expect(resolveSessionStudySetId({ config: { groupId: 'g1' } as any })).toBeNull();
    expect(resolveSessionStudySetId({})).toBeNull();
    expect(resolveSessionStudySetId({ config: null })).toBeNull();
  });

  it('treats blank and non-string values as no set rather than filing under ""', () => {
    expect(resolveSessionStudySetId({ studySetId: '   ' })).toBeNull();
    expect(resolveSessionStudySetId({ studySetId: null })).toBeNull();
    expect(resolveSessionStudySetId({ config: { studySetId: 0 as any } })).toBeNull();
  });

  it('trims, so a stray newline cannot make a set id that matches nothing', () => {
    expect(resolveSessionStudySetId({ studySetId: `\n${SET} ` })).toBe(SET);
  });
});

describe('withStudySetId', () => {
  const base = { config: { studySetId: SET }, questions: [], is_offline: false };

  it('stamps the set onto the create payload', () => {
    expect(withStudySetId(base, base)).toEqual({ ...base, studySetId: SET });
  });

  it('leaves a set-less payload untouched rather than sending studySetId: null', () => {
    const groupTest = { config: { groupId: 'g1' }, questions: [] };
    const payload = withStudySetId(groupTest, groupTest as any);
    expect(payload).toEqual(groupTest);
    expect('studySetId' in payload).toBe(false);
  });

  it('does not mutate the payload it was handed', () => {
    const original = { ...base };
    withStudySetId(original, original);
    expect('studySetId' in original).toBe(false);
  });
});
