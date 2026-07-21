import { isDeactivatedLifecycleRoute } from './accountLifecycle';

describe('isDeactivatedLifecycleRoute', () => {
  const userId = 'user-123';

  it('allows pause, reactivate, export, and logout paths', () => {
    expect(isDeactivatedLifecycleRoute('POST', `/${userId}/deactivate`, userId)).toBe(true);
    expect(isDeactivatedLifecycleRoute('POST', `/${userId}/reactivate`, userId)).toBe(true);
    expect(isDeactivatedLifecycleRoute('GET', `/${userId}/export`, userId)).toBe(true);
    expect(isDeactivatedLifecycleRoute('POST', '/logout', userId)).toBe(true);
  });

  it('rejects unrelated authenticated routes', () => {
    expect(isDeactivatedLifecycleRoute('GET', `/${userId}/settings`, userId)).toBe(false);
    expect(isDeactivatedLifecycleRoute('POST', '/message', userId)).toBe(false);
  });
});
