import {
  NIGERIAN_GEOPOLITICAL_ZONES,
  resolveNigerianGeopoliticalZone,
} from './campuses';

describe('resolveNigerianGeopoliticalZone', () => {
  it.each([
    ['Benue', 'North Central'],
    ['Yobe', 'North East'],
    ['Kaduna', 'North West'],
    ['Enugu', 'South East'],
    ['Rivers', 'South South'],
    ['Lagos', 'South West'],
  ])('maps %s to %s', (state, expected) => {
    expect(resolveNigerianGeopoliticalZone(state)).toBe(expected);
  });

  it('normalizes FCT aliases and casing', () => {
    expect(resolveNigerianGeopoliticalZone('fct')).toBe('North Central');
    expect(resolveNigerianGeopoliticalZone(' Federal Capital Territory ')).toBe(
      'North Central'
    );
  });

  it('returns null when a generic location cannot be attributed', () => {
    expect(resolveNigerianGeopoliticalZone('Nigeria')).toBeNull();
    expect(resolveNigerianGeopoliticalZone()).toBeNull();
  });

  it('exposes all six Nigerian zones', () => {
    expect(NIGERIAN_GEOPOLITICAL_ZONES).toHaveLength(6);
  });
});
