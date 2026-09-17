/**
 * @deprecated Import from the `services/data/*` module that owns the name.
 *
 * This file was `SupabaseService`: one class, 18,257 lines at its peak and
 * 7,226 at the end, through which every route reached Postgres and Storage.
 * Step 18 of the monolith decomposition took it apart — the bodies moved into
 * `services/data/*` (one module per domain, plain functions over an injected
 * client), the composition root moved to `services/data/index.ts`, and every
 * importer moved to the layer. The class is gone as of monolith lane M3.
 *
 * What is left is a forwarding shim, so that the fourteen importers of these
 * module-scope names did not all have to move in the same pull request. Each
 * name is re-exported from the module that owns it. **Move your import to that
 * module**; this file is removed one release after the lane lands, and there is
 * nothing here to add to.
 *
 * Where the behaviour went, if you are following a trail:
 *
 * | you wanted | it is now |
 * | --- | --- |
 * | `new SupabaseService(config)` | `createRuntimeDataLayer(config)` in `services/data/bootstrap.ts` |
 * | `supabaseService.<method>(…)` | `dataLayer.<namespace>.<method>(…)` |
 * | the raw client | `dataLayer.getClient()` |
 * | which namespace owns a name | `services/data/dataLayer.surface.json` |
 *
 * The decomposition is written up in `docs/data-layer-wiring.md` and
 * `docs/services-flip-plan.md`.
 */

// Cover images: the bucket, the migration marker and the two errors a route
// turns into a 503.
export {
  COVER_IMAGE_BUCKET,
  COVER_IMAGE_MIGRATION,
  CoverColumnMissingError,
  CoverStorageUnavailableError,
  isMissingCoverPathColumn,
} from "./data/coverImages";

// Test list/provenance mappers: pure, and shared by `routes/tests.ts` and the
// two suites that pin their shape.
export {
  buildAttemptTally,
  buildTestProvenance,
  mapTestListRow,
} from "./data/testMappers";

// Academic filing.
export { resolveStudySetIdFromConfigLike } from "./data/academic";

// The auth-error classifier the optional-auth middleware branches on.
export { isTransientAuthError } from "./data/client";

// The three chat mutation result shapes `routes/messages.ts` annotates with.
export type { BoardRepostResult } from "./data/boardActions";
export type { ChatMessageMutationResult } from "./data/groupMessages";
export type { MessagePinResult } from "./data/chatSend";
