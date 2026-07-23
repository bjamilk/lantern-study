import { describe, expect, it, vi } from 'vitest';
import { applyJsonXhrHeaders } from './xhrHeaders';

describe('applyJsonXhrHeaders', () => {
  it('sets Content-Type exactly once when auth headers already include it', () => {
    const setRequestHeader = vi.fn();

    applyJsonXhrHeaders(
      { setRequestHeader },
      {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token',
        'X-Requested-With': 'LanternStudy',
      }
    );

    expect(setRequestHeader).toHaveBeenCalledWith('Authorization', 'Bearer token');
    expect(setRequestHeader).toHaveBeenCalledWith('X-Requested-With', 'LanternStudy');
    expect(
      setRequestHeader.mock.calls.filter(
        ([key]) => String(key).toLowerCase() === 'content-type'
      )
    ).toEqual([['Content-Type', 'application/json']]);
  });
});
