/**
 * Credential changes must not leave sessions alive on devices the user no
 * longer controls. The revoke route is the server half of that: it stamps a
 * session cutoff (which invalidates every previously issued token) and asks
 * Supabase to end all sessions.
 *
 * Wiring is what actually breaks here — a route that silently skips the
 * cutoff, or drops auth, looks identical from the client — so this asserts
 * the layer stack and the cutoff call rather than re-testing Express.
 */
import router from './auth';

function findRoute(path: string, method: string) {
  return router.stack.find(
    (layer: any) => layer.route?.path === path && layer.route?.methods?.[method]
  );
}

describe('POST /auth/revoke-other-sessions', () => {
  it('is registered', () => {
    expect(findRoute('/revoke-other-sessions', 'post')).toBeTruthy();
  });

  it('requires authentication and is rate limited', () => {
    const layer: any = findRoute('/revoke-other-sessions', 'post');
    const names = layer.route.stack.map((s: any) => s.name);
    // authMiddleware guards it; a limiter sits in front so the global signOut
    // cannot be used to hammer Supabase.
    expect(names).toContain('authMiddleware');
    expect(layer.route.stack.length).toBeGreaterThanOrEqual(3);
  });

  it('stamps a session cutoff, which is what invalidates existing tokens', () => {
    const source = require('fs').readFileSync(__dirname + '/auth.ts', 'utf8');
    const handler = source.slice(source.indexOf("'/revoke-other-sessions'"));
    expect(handler).toContain('setUserSessionCutoff');
    // The GoTrue call moved into the data layer (lane R2, PR 2b); it used to
    // read `signOut(userId, 'global')` inline here. Same call, same order —
    // the cutoff still comes first, which is the property this guards.
    expect(handler).toContain('signOutUserGlobally(userId)');
    expect(handler.indexOf('setUserSessionCutoff')).toBeLessThan(
      handler.indexOf('signOutUserGlobally'),
    );
  });
});
