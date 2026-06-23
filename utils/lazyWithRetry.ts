import { lazy, type ComponentType, type LazyExoticComponent } from 'react';

const CHUNK_RELOAD_KEY = 'lantern_chunk_reload';

export function clearChunkReloadFlag(): void {
  try {
    sessionStorage.removeItem(CHUNK_RELOAD_KEY);
  } catch {
    // ignore
  }
}

type ModuleWithDefault<T> = { default: T };

/**
 * Lazy-load a route chunk; on stale-deploy failures, hard-reload once to fetch new assets.
 */
export function lazyWithRetry<T extends ComponentType<unknown>>(
  factory: () => Promise<ModuleWithDefault<T>>
): LazyExoticComponent<T> {
  return lazy(() =>
    factory().catch((err: unknown) => {
      let reloaded = false;
      try {
        reloaded = sessionStorage.getItem(CHUNK_RELOAD_KEY) === '1';
      } catch {
        // ignore
      }

      if (!reloaded) {
        try {
          sessionStorage.setItem(CHUNK_RELOAD_KEY, '1');
        } catch {
          // ignore
        }
        window.location.reload();
        return new Promise<ModuleWithDefault<T>>(() => {});
      }

      try {
        sessionStorage.removeItem(CHUNK_RELOAD_KEY);
      } catch {
        // ignore
      }
      throw err;
    })
  );
}
