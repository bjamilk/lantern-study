import { ConcurrencyGate } from './concurrencyGate';

describe('ConcurrencyGate', () => {
  it('limits concurrent acquisitions', () => {
    const gate = new ConcurrencyGate('test', 2);
    expect(gate.tryAcquire()).toBe(true);
    expect(gate.tryAcquire()).toBe(true);
    expect(gate.tryAcquire()).toBe(false);
    expect(gate.activeCount).toBe(2);
    gate.release();
    expect(gate.tryAcquire()).toBe(true);
    expect(gate.activeCount).toBe(2);
  });

  it('wakes waiters on release', async () => {
    const gate = new ConcurrencyGate('wait', 1);
    expect(gate.tryAcquire()).toBe(true);
    const pending = gate.acquire();
    expect(gate.waitingCount).toBe(1);
    gate.release();
    const release = await pending;
    expect(gate.activeCount).toBe(1);
    release();
    expect(gate.activeCount).toBe(0);
  });
});
