import { describe, expect, it } from 'vitest';
import { parseAppRoute } from './appRoutes';

describe('teach portal and class join routes', () => {
  it('parses /teach as a standalone route with no student AppMode', () => {
    expect(parseAppRoute('/teach')).toEqual({
      mode: null,
      params: {},
      standalone: 'teach',
    });
    expect(parseAppRoute('/teach/new').standalone).toBe('teach');
    expect(parseAppRoute('/teach/classes/abc/roster').standalone).toBe('teach');
    expect(parseAppRoute('/teach/admin').standalone).toBe('teach');
  });

  it('parses /join/:code as a standalone join page', () => {
    expect(parseAppRoute('/join/ABC234')).toEqual({
      mode: null,
      params: { joinCode: 'ABC234' },
      standalone: 'join',
    });
    expect(parseAppRoute('/join/abc234').params.joinCode).toBe('ABC234');
  });

  it('does not bounce teach or join to the dashboard', () => {
    expect(parseAppRoute('/teach').redirect).toBeUndefined();
    expect(parseAppRoute('/join/ABC234').redirect).toBeUndefined();
  });
});
