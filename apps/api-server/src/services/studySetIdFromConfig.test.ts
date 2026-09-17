/**
 * `POST /tests` never wrote `study_set_id`, so a set room's Test tab — which
 * lists by exactly that column — was empty for every set and every user. The
 * clients carry the set on the payload or on its nested `config`; the server
 * has to read either, or a session is filed differently depending on which
 * door it came through.
 */
import { resolveStudySetIdFromConfigLike } from './data/academic';

const SET = 'fdbfd2b9-1111-4222-8333-444444444444';

describe('resolveStudySetIdFromConfigLike', () => {
  it('reads a top-level studySetId', () => {
    expect(resolveStudySetIdFromConfigLike({ studySetId: SET })).toBe(SET);
  });

  it('reads the snake_case form the offline sync sends', () => {
    expect(resolveStudySetIdFromConfigLike({ study_set_id: SET })).toBe(SET);
  });

  it('reads it off the config, which is how a retaken test carries its set', () => {
    expect(resolveStudySetIdFromConfigLike({ config: { studySetId: SET } })).toBe(SET);
  });

  it('prefers the top-level value when both are present', () => {
    expect(
      resolveStudySetIdFromConfigLike({ studySetId: SET, config: { studySetId: 'other' } }),
    ).toBe(SET);
  });

  it('is null for a session in no set, so the column is simply not written', () => {
    expect(resolveStudySetIdFromConfigLike({ config: { groupId: 'g1' } })).toBeNull();
    expect(resolveStudySetIdFromConfigLike({})).toBeNull();
    expect(resolveStudySetIdFromConfigLike(null)).toBeNull();
    expect(resolveStudySetIdFromConfigLike({ studySetId: '  ' })).toBeNull();
    expect(resolveStudySetIdFromConfigLike({ studySetId: 42 })).toBeNull();
  });
});
