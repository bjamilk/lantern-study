/**
 * Process-local concurrency gates for protecting the Node event loop and
 * upstream provider/DB capacity. Multi-instance scale still requires many
 * API replicas + shared Redis + Postgres headroom.
 */

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const n = parseInt(value || '', 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export class ConcurrencyGate {
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(
    public readonly name: string,
    public readonly max: number
  ) {}

  get activeCount(): number {
    return this.active;
  }

  get waitingCount(): number {
    return this.waiters.length;
  }

  get available(): number {
    return Math.max(0, this.max - this.active);
  }

  tryAcquire(): boolean {
    if (this.active >= this.max) return false;
    this.active += 1;
    return true;
  }

  /** Acquire or wait (prefer tryAcquire + 503 on the hot path). */
  async acquire(): Promise<() => void> {
    if (this.tryAcquire()) {
      return () => this.release();
    }
    await new Promise<void>((resolve) => {
      this.waiters.push(resolve);
    });
    this.active += 1;
    return () => this.release();
  }

  release(): void {
    if (this.active > 0) this.active -= 1;
    const next = this.waiters.shift();
    if (next) next();
  }

  snapshot() {
    return {
      name: this.name,
      max: this.max,
      active: this.active,
      waiting: this.waiters.length,
      available: this.available,
    };
  }
}

/** Concurrent outbound AI chat/transcription calls per process. */
export const aiInflightGate = new ConcurrencyGate(
  'ai_inflight',
  parsePositiveInt(process.env.AI_MAX_INFLIGHT, 16)
);

/** Concurrent companion SSE responses held open per process. */
export const companionStreamGate = new ConcurrencyGate(
  'companion_streams',
  parsePositiveInt(process.env.COMPANION_STREAM_MAX, 32)
);

export function concurrencySnapshots() {
  return [aiInflightGate.snapshot(), companionStreamGate.snapshot()];
}
