/**
 * dataLayerHost.ts — the shrinking bridge from the data layer back to the
 * `SupabaseService` facade.
 *
 * ## Purpose
 *
 * `services/data/index.ts` builds every `deps` literal the data modules need.
 * Deps it could not build from the data layer alone arrived here. There is now
 * exactly ONE left, `legacyService` — the facade instance itself, handed to the
 * `services/` callers and route families this lane has not reached yet.
 *
 * It held fifteen in Phase A of monolith lane M3: five bodies that had never
 * left the facade (moved into `services/data/*`), the per-instance rating
 * circuit breaker (now held per LAYER), and eight wrappers over services that
 * took the facade whole. Phase B flipped those eight services onto layer host
 * types, so `createDataLayer` builds every one of those arrows itself, passing
 * `layer`.
 *
 * ## The gotcha
 *
 * This file only shrinks, and it is nearly gone: when `legacyService` has no
 * reader, `SupabaseService` has nothing left that anything needs, which is the
 * condition for deleting the facade. Do not add an entry without saying in the
 * PR how it comes back out.
 *
 * ## What it touches
 *
 * Nothing. It holds no client and issues no query.
 */
import type { SupabaseService } from './supabase';
import type { DataLayerHost } from './data';

export function createDataLayerHost(service: SupabaseService): DataLayerHost {
  return {
    legacyService: service,
  };
}
