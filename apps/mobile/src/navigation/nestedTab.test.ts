import { toTab } from './nestedTab';

describe('toTab', () => {
  it('always sets initial:false so the tab root stays beneath the target', () => {
    expect(toTab('TestTaking', { testId: 'a' })).toEqual({
      screen: 'TestTaking',
      params: { testId: 'a' },
      initial: false,
    });
  });

  it('omits params entirely when the screen takes none', () => {
    const result = toTab('CreateGroup');
    expect(result).toEqual({ screen: 'CreateGroup', initial: false });
    // Not `params: undefined` — that would overwrite a screen's own defaults
    // and shows up as an explicit key to React Navigation.
    expect('params' in result).toBe(false);
  });

  it('keeps the params object it was handed, without copying or reordering it', () => {
    const params = { groupId: 'g1', groupName: 'Physics' };
    expect(toTab('GroupChat', params).params).toBe(params);
  });

  it('returns a fresh object each call, so no two navigates share params', () => {
    const a = toTab('Library', { tab: 'notes' });
    const b = toTab('Library', { tab: 'notes' });
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});
