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
 * One call, two callers.
 *
 * ## What it touches
 *
 * It constructs the one service-role client (`data/client.ts`) and hands back
 * the layer bound to it. Nothing else in the process may construct a second.
 */
import { createDataClient } from './client';
import { createDataLayer, type DataLayer } from './index';

export type RuntimeDataLayer = {
  dataLayer: DataLayer;
};

export function createRuntimeDataLayer(config: {
  url: string;
  serviceRoleKey: string;
}): RuntimeDataLayer {
  return {
    dataLayer: createDataLayer({
      client: createDataClient(config),
      supabaseUrl: config.url,
    }),
  };
}
