import { describe, expect, it } from 'vitest';
import { isTeachAuthRequest, isTeachNextPath } from './teachIntent';

describe('isTeachNextPath', () => {
  it('accepts teach destinations', () => {
    expect(isTeachNextPath('/teach')).toBe(true);
    expect(isTeachNextPath('/teach/new')).toBe(true);
    expect(isTeachNextPath('/teach/classes/abc')).toBe(true);
  });

  it('rejects other or unsafe next values', () => {
    expect(isTeachNextPath('/dashboard')).toBe(false);
    expect(isTeachNextPath('//evil.example')).toBe(false);
    expect(isTeachNextPath('https://lanternstudy.com/teach')).toBe(false);
    expect(isTeachNextPath(null)).toBe(false);
  });
});

describe('isTeachAuthRequest', () => {
  it('detects instructor signup and login-next', () => {
    expect(isTeachAuthRequest('/signup/teach', '')).toBe(true);
    expect(isTeachAuthRequest('/login', '?next=/teach')).toBe(true);
    expect(isTeachAuthRequest('/signup', '?intent=teach')).toBe(true);
    expect(isTeachAuthRequest('/signup', '')).toBe(false);
    expect(isTeachAuthRequest('/login', '?next=/dashboard')).toBe(false);
  });
});
