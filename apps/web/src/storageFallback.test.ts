/**
 * Storage in embedded webviews: `window.localStorage` can be null, unwritable,
 * or throw on access. Boot reads storage before React mounts, so any of those
 * is a blank page unless a stand-in is installed first.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installStorageFallback } from '../../../utils/storageFallback';

/** The suite runs in node; give the module the window surface it looks for. */
function withWindow(localStorageValue: unknown, sessionStorageValue?: unknown): any {
  const win: any = {};
  Object.defineProperty(win, 'localStorage', {
    configurable: true,
    get: () => {
      if (localStorageValue === 'throws') throw new Error('SecurityError');
      return localStorageValue;
    },
  });
  Object.defineProperty(win, 'sessionStorage', {
    configurable: true,
    get: () => sessionStorageValue ?? null,
  });
  vi.stubGlobal('window', win);
  return win;
}

function workingStorage(seed: Record<string, string> = {}) {
  const entries = new Map(Object.entries(seed));
  return {
    get length() {
      return entries.size;
    },
    clear: () => entries.clear(),
    getItem: (key: string) => (entries.has(key) ? entries.get(key)! : null),
    key: (index: number) => Array.from(entries.keys())[index] ?? null,
    removeItem: (key: string) => void entries.delete(key),
    setItem: (key: string, value: string) => void entries.set(key, value),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('installStorageFallback', () => {
  it('installs a working store when localStorage is null', () => {
    const win = withWindow(null);
    installStorageFallback();

    win.localStorage.setItem('theme', 'dark');
    expect(win.localStorage.getItem('theme')).toBe('dark');
    expect(win.localStorage.length).toBe(1);
  });

  it('survives a localStorage getter that throws', () => {
    const win = withWindow('throws');
    expect(() => installStorageFallback()).not.toThrow();

    win.localStorage.setItem('a', '1');
    expect(win.localStorage.getItem('a')).toBe('1');
  });

  it('leaves a healthy store alone', () => {
    const real = workingStorage({ theme: 'light' });
    const win = withWindow(real);
    installStorageFallback();

    expect(win.localStorage).toBe(real);
  });

  it('carries values over when the store reads but cannot write', () => {
    // Old Safari private mode: getItem works, setItem throws. Replacing it with
    // an empty store would drop the auth token and sign the user out.
    const readOnly = {
      ...workingStorage({ 'sb-auth-token': 'session', theme: 'dark' }),
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    };
    Object.defineProperty(readOnly, 'length', { value: 2 });
    const keys = ['sb-auth-token', 'theme'];
    readOnly.key = (index: number) => keys[index] ?? null;

    const win = withWindow(readOnly);
    installStorageFallback();

    expect(win.localStorage).not.toBe(readOnly);
    expect(win.localStorage.getItem('sb-auth-token')).toBe('session');
    expect(win.localStorage.getItem('theme')).toBe('dark');
    expect(() => win.localStorage.setItem('theme', 'light')).not.toThrow();
    expect(win.localStorage.getItem('theme')).toBe('light');
  });

  it('removeItem and clear behave on the stand-in', () => {
    const win = withWindow(null);
    installStorageFallback();

    win.localStorage.setItem('a', '1');
    win.localStorage.setItem('b', '2');
    win.localStorage.removeItem('a');
    expect(win.localStorage.getItem('a')).toBeNull();
    expect(win.localStorage.length).toBe(1);

    win.localStorage.clear();
    expect(win.localStorage.length).toBe(0);
  });
});
