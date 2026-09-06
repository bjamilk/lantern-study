import { planReconnectRetry } from './reconnectRetry';

describe('planReconnectRetry', () => {
  it('fires once when the link is back and the last load failed', () => {
    expect(
      planReconnectRetry({ isConnected: true, alreadyRetried: false, listFailed: true, searchFailed: false })
    ).toEqual({ schedule: true, resetLatch: false });
  });

  it('fires for a failed server search too', () => {
    expect(
      planReconnectRetry({ isConnected: true, alreadyRetried: false, listFailed: false, searchFailed: true })
        .schedule
    ).toBe(true);
  });

  it('does nothing while offline, and clears the latch for the next reconnection', () => {
    expect(
      planReconnectRetry({ isConnected: false, alreadyRetried: true, listFailed: true, searchFailed: true })
    ).toEqual({ schedule: false, resetLatch: true });
  });

  it('does nothing when nothing failed', () => {
    expect(
      planReconnectRetry({ isConnected: true, alreadyRetried: false, listFailed: false, searchFailed: false })
    ).toEqual({ schedule: false, resetLatch: false });
  });

  // The loop this latch exists to stop: the store clears `listError` when a
  // fetch starts and sets it again when the fetch fails, so a retry that fails
  // looks, to a dependency array, like a brand-new failure.
  it('cannot loop: a failed retry does not re-arm while the link stays up', () => {
    // 1. Failure seen, link up, not yet retried -> fire.
    const first = planReconnectRetry({
      isConnected: true,
      alreadyRetried: false,
      listFailed: true,
      searchFailed: false,
    });
    expect(first.schedule).toBe(true);

    // 2. The retry starts: the store blanks listError (nothing to do).
    expect(
      planReconnectRetry({ isConnected: true, alreadyRetried: true, listFailed: false, searchFailed: false })
        .schedule
    ).toBe(false);

    // 3. The retry fails: listError is set AGAIN. Without the latch this
    //    would schedule another shot; with it, it must not.
    expect(
      planReconnectRetry({ isConnected: true, alreadyRetried: true, listFailed: true, searchFailed: false })
    ).toEqual({ schedule: false, resetLatch: false });
  });

  it('gets a fresh shot only after the link has actually dropped and returned', () => {
    const down = planReconnectRetry({
      isConnected: false,
      alreadyRetried: true,
      listFailed: true,
      searchFailed: false,
    });
    expect(down.resetLatch).toBe(true);
    // The caller cleared the latch on `resetLatch`; the link returns.
    expect(
      planReconnectRetry({ isConnected: true, alreadyRetried: false, listFailed: true, searchFailed: false })
        .schedule
    ).toBe(true);
  });
});
