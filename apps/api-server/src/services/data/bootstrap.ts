/**
 * data/bootstrap.ts — the ONE place a running process builds its data layer.
 *
 * ## Why this exists
 *
 * Two processes need a layer: the API (`server.ts`) and the BullMQ worker
 * (`worker.ts` → `queue/processors`). Until monolith lane M3 Phase B each of
 * them wrote its own wiring — construct the facade, take its client, build the
 * host, call `createDataLayer` — which is four lines that must agree, in two
 * files that are edited for different reasons. They had already drifted once
 * on `supabaseUrl`: the server passed its resolved `dbConfig.url`, the worker
 * passed `process.env.SUPABASE_URL || ""`, so a worker booted without that
 * variable signed storage URLs against an empty origin.
 *
 * One call, two callers. When `SupabaseService` is deleted this function loses
 * its `legacyService` half and nothing else changes.
 *
 * ## What it touches
 *
 * Nothing directly: it constructs the service-role client (through the facade,
 * which owns that construction today) and hands both handles back.
 */
import { SupabaseService } from '../supabase';
import { createDataLayerHost } from '../dataLayerHost';

import { createDataLayer, type DataLayer } from './index';

export type RuntimeDataLayer = {
  dataLayer: DataLayer;
  /**
   * The facade instance the layer's bridge still carries. Transitional: the
   * remaining `supabase.*.test.ts` suites and the last importers are what keep
   * it alive, and it goes with the class.
   */
  legacyService: SupabaseService;
};

export function createRuntimeDataLayer(config: {
  url: string;
  serviceRoleKey: string;
}): RuntimeDataLayer {
  const legacyService = new SupabaseService(config);
  const dataLayer = createDataLayer({
    client: legacyService.getClient(),
    supabaseUrl: config.url,
    host: createDataLayerHost(legacyService),
  });
  return { dataLayer, legacyService };
}
