import { flattenColor } from './color';

describe('flattenColor', () => {
  it('returns an opaque colour untouched', () => {
    // Light `primaryBackground`: nothing must move when a token has no alpha.
    expect(flattenColor('#eef2ff', '#efeae2')).toBe('#eef2ff');
    expect(flattenColor('rgb(10, 20, 30)', '#000000')).toBe('rgb(10, 20, 30)');
  });

  it('composites an 8-digit hex token over the ground', () => {
    // Dark `primaryBackground` #6366f120 is 12.5% opaque over pure black.
    expect(flattenColor('#6366f120', '#000000')).toBe('#0c0d1e');
  });

  it('composites an rgba() string (what withAlpha emits)', () => {
    expect(flattenColor('rgba(129, 140, 248, 0.15)', '#16181c')).toBe('#26293d');
  });

  it('treats a fully transparent colour as the ground', () => {
    expect(flattenColor('#ffffff00', '#123456')).toBe('#123456');
  });

  it('expands 3- and 4-digit hex', () => {
    expect(flattenColor('#fff', '#000000')).toBe('#fff');
    expect(flattenColor('#fff8', '#000000')).toBe('#888888');
  });

  it('returns the input unchanged when either colour is unparseable', () => {
    expect(flattenColor('not-a-colour', '#000000')).toBe('not-a-colour');
    expect(flattenColor('#6366f120', 'nonsense')).toBe('#6366f120');
  });
});
