/**
 * A ~200-line stand-in for React's hook runtime, so a hook can be rendered and
 * its effects inspected in the web suite's plain Node environment (there is no
 * jsdom here, and `renderToStaticMarkup` never runs effects at all).
 *
 * Exports: `reactMock` — the object a test hands to `vi.mock('react', …)`;
 *  `renderHook` — render a hook, re-render it, run/flush its effects;
 *  `describeEffects` — the stable, human-readable dependency signature of every
 *  effect the render registered, in registration order.
 * Touches: nothing outside itself. It holds one module-level "current render"
 *  the mocked hooks read, exactly as React holds a current fiber.
 * Gotchas:
 *  - `useSyncExternalStore` is implemented as `getSnapshot()`, which is what
 *    lets a real zustand store be read without a React renderer.
 *  - Hook slots are positional, as in React: a conditional hook call would
 *    corrupt the slot list here the same way it corrupts a fiber.
 *  - Effects are NOT run by `render()`. `runEffects()` runs them, in
 *    registration order, applying React's own dependency comparison against
 *    the previous render — so the order test can assert registration without
 *    touching any of the effect bodies.
 */

interface EffectSlot {
    deps: unknown[] | undefined;
    cleanup?: (() => void) | void;
    hasRun: boolean;
}

interface HookSlot {
    kind: 'state' | 'ref' | 'memo' | 'effect';
    value?: unknown;
    deps?: unknown[];
    effect?: EffectSlot;
}

interface RenderState {
    slots: HookSlot[];
    index: number;
    /** Effect bodies queued by THIS render, in registration order. */
    queue: Array<{ slotIndex: number; create: () => (() => void) | void; deps: unknown[] | undefined }>;
    /** Dependency signatures, in registration order — what the order test reads. */
    signatures: string[];
    rerender: () => void;
}

let current: RenderState | null = null;

function requireRender(): RenderState {
    if (!current) {
        throw new Error('Hook called outside renderHook() — the harness has no current render.');
    }
    return current;
}

function nextSlot(kind: HookSlot['kind']): HookSlot {
    const state = requireRender();
    const slot = state.slots[state.index];
    if (slot) {
        if (slot.kind !== kind) {
            throw new Error(
                `Hook order changed between renders: slot ${state.index} was ${slot.kind}, now ${kind}.`
            );
        }
        state.index += 1;
        return slot;
    }
    const created: HookSlot = { kind };
    state.slots[state.index] = created;
    state.index += 1;
    return created;
}

function sameDeps(a: unknown[] | undefined, b: unknown[] | undefined): boolean {
    if (!a || !b || a.length !== b.length) return false;
    return a.every((value, i) => Object.is(value, b[i]));
}

/**
 * A stable, readable name for one dependency value. Functions are named so two
 * different store setters produce two different signatures; everything else is
 * JSON, which is enough to tell `['u1', true]` from `['u1', false]`.
 */
function describeDep(value: unknown): string {
    if (typeof value === 'function') return `fn:${value.name || 'anonymous'}`;
    if (value === undefined) return 'undefined';
    if (value instanceof Date) return `date:${value.toISOString()}`;
    try {
        return JSON.stringify(value) ?? String(value);
    } catch {
        return String(value);
    }
}

export function describeDeps(deps: unknown[] | undefined): string {
    if (deps === undefined) return '(no deps)';
    return `[${deps.map(describeDep).join(', ')}]`;
}

const useState = <S,>(initial: S | (() => S)): [S, (next: S | ((prev: S) => S)) => void] => {
    const state = requireRender();
    const slot = nextSlot('state');
    if (!('value' in slot)) {
        slot.value = typeof initial === 'function' ? (initial as () => S)() : initial;
    }
    const setter = (next: S | ((prev: S) => S)) => {
        const previous = slot.value as S;
        const resolved = typeof next === 'function' ? (next as (prev: S) => S)(previous) : next;
        if (Object.is(resolved, previous)) return;
        slot.value = resolved;
        state.rerender();
    };
    return [slot.value as S, setter];
};

const useRef = <T,>(initial: T): { current: T } => {
    const slot = nextSlot('ref');
    if (!('value' in slot)) slot.value = { current: initial };
    return slot.value as { current: T };
};

const useMemo = <T,>(factory: () => T, deps: unknown[] | undefined): T => {
    const slot = nextSlot('memo');
    if (!('value' in slot) || !sameDeps(slot.deps, deps)) {
        slot.value = factory();
        slot.deps = deps;
    }
    return slot.value as T;
};

const useCallback = <T,>(fn: T, deps: unknown[] | undefined): T => useMemo(() => fn, deps);

const useEffect = (create: () => (() => void) | void, deps?: unknown[]): void => {
    const state = requireRender();
    const slotIndex = state.index;
    const slot = nextSlot('effect');
    if (!slot.effect) slot.effect = { deps: undefined, hasRun: false };
    state.signatures.push(describeDeps(deps));
    state.queue.push({ slotIndex, create, deps });
};

/** Real React reads the store through a subscription; here one read is enough. */
const useSyncExternalStore = <T,>(
    _subscribe: (onChange: () => void) => () => void,
    getSnapshot: () => T
): T => getSnapshot();

export const reactMock = {
    useState,
    useRef,
    useMemo,
    useCallback,
    useEffect,
    useLayoutEffect: useEffect,
    useInsertionEffect: useEffect,
    useSyncExternalStore,
    useDebugValue: () => {},
    useId: () => 'harness-id',
};

export interface HookHarness<T> {
    /** What the hook returned on the most recent render. */
    result: T;
    /** Dependency signature of every effect, in registration order. */
    effectSignatures: string[];
    /** Render again (same hook instance, same slots). */
    render: () => T;
    /** Run the effects whose deps changed, in registration order. */
    runEffects: () => void;
    /** Run every effect's cleanup, as an unmount would. */
    unmount: () => void;
}

export function renderHook<T>(hook: () => T): HookHarness<T> {
    const slots: HookSlot[] = [];
    let latest: T;
    let signatures: string[] = [];
    let queue: RenderState['queue'] = [];

    const render = (): T => {
        const previous = current;
        const state: RenderState = {
            slots,
            index: 0,
            queue: [],
            signatures: [],
            // A setState during render re-runs the hook, as React would.
            rerender: () => {
                render();
            },
        };
        current = state;
        try {
            latest = hook();
        } finally {
            current = previous;
        }
        signatures = state.signatures;
        queue = state.queue;
        harness.result = latest;
        harness.effectSignatures = signatures;
        return latest;
    };

    const runEffects = () => {
        for (const entry of queue) {
            const slot = slots[entry.slotIndex];
            const effect = slot.effect!;
            if (effect.hasRun && sameDeps(effect.deps, entry.deps)) continue;
            if (effect.hasRun && typeof effect.cleanup === 'function') effect.cleanup();
            effect.cleanup = entry.create();
            effect.deps = entry.deps;
            effect.hasRun = true;
        }
    };

    const unmount = () => {
        for (const slot of slots) {
            if (slot.kind !== 'effect' || !slot.effect) continue;
            if (typeof slot.effect.cleanup === 'function') slot.effect.cleanup();
            slot.effect.cleanup = undefined;
            slot.effect.hasRun = false;
        }
    };

    const harness: HookHarness<T> = {
        result: undefined as unknown as T,
        effectSignatures: [],
        render,
        runEffects,
        unmount,
    };

    render();
    return harness;
}
