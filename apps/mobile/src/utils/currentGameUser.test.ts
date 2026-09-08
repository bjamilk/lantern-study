/**
 * The game player's name is a display name, resolved through the same shared
 * planner as every other mobile surface: never the email address, and a
 * genuinely missing name renders the neutral self-label 'You' rather than
 * letters taken from the account's email.
 */
import { buildCurrentGameUser } from './currentGameUser';

function user(over: Record<string, unknown> = {}) {
  return {
    id: 'user-1',
    email: 'nimaj22@gmail.com',
    user_metadata: {},
    ...over,
  } as any;
}

describe('buildCurrentGameUser name', () => {
  it('prefers the synced profile name', () => {
    expect(buildCurrentGameUser(user(), 'Benjamin Amadi').name).toBe('Benjamin Amadi');
  });

  it('falls back to the metadata full name, then name', () => {
    expect(buildCurrentGameUser(user({ user_metadata: { full_name: 'Ada Lovelace' } })).name).toBe(
      'Ada Lovelace'
    );
    expect(buildCurrentGameUser(user({ user_metadata: { name: 'Ada Lovelace' } })).name).toBe(
      'Ada Lovelace'
    );
  });

  it('NEVER names the player after the email local part', () => {
    // The whole point: no profile name, no metadata name — the result must be
    // the neutral 'You', not 'nimaj22'.
    const built = buildCurrentGameUser(user());
    expect(built.name).toBe('You');
    expect(built.name).not.toBe('nimaj22');
    expect(built.name).not.toMatch(/@/);
  });

  it('drops a literal address arriving as the synced profile name', () => {
    expect(buildCurrentGameUser(user(), 'nimaj22@gmail.com').name).toBe('You');
  });

  it('drops the email local part arriving as the ambiguous synced name', () => {
    // `profileName` is the slot the offline stand-in travels on, so a value
    // equal to the local part is refused there — the top-bar "NI" rule.
    expect(buildCurrentGameUser(user(), 'nimaj22').name).toBe('You');
  });

  it('keeps a genuine metadata name that happens to equal the email local part', () => {
    // 'ada' from the signup metadata for ada@uni.edu is the student's real
    // name and IS kept — a genuine source, not the offline stand-in.
    expect(
      buildCurrentGameUser(user({ email: 'ada@uni.edu', user_metadata: { name: 'ada' } })).name
    ).toBe('ada');
  });
});
