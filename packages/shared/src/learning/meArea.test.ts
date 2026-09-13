import { isMeAreaSection, ME_AREA_SECTIONS } from './meArea';

describe('me area sections', () => {
  it('keeps Profile and Progress as the two peer sections', () => {
    expect(ME_AREA_SECTIONS.map((section) => section.id)).toEqual(['profile', 'progress']);
  });

  it('accepts only those two ids', () => {
    expect(isMeAreaSection('profile')).toBe(true);
    expect(isMeAreaSection('progress')).toBe(true);
    expect(isMeAreaSection('settings')).toBe(false);
    expect(isMeAreaSection('')).toBe(false);
  });
});
