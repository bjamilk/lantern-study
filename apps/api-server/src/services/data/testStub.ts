/**
 * data/testStub.ts — TEST ONLY. Adapts a flat `SupabaseService` stand-in to the
 * `DataLayer` shape a flipped route family is injected with.
 *
 * ## Why this exists
 *
 * Most route suites hand `initialize*Routes` a bare object of `jest.fn()`s
 * named after facade methods — sometimes a literal, often a `Proxy` or a
 * factory shared by twenty tests. Flipping the route to
 * `dataLayer.<domain>.<fn>(…)` means the injected object needs namespaces.
 * Where the stand-in is a simple literal, the suite regroups its stubs under
 * the owning namespace and reads better for it (see
 * `routes/groups.batchInvite.test.ts`). Where it is not, this adapter does the
 * regrouping generically:
 *
 *     initializeDeckRoutes(stubDataLayer(service), cache);
 *
 * ## How it behaves
 *
 *  - `layer.<anything>.<fn>` resolves to `stub.<fn>`, looked up AT CALL TIME,
 *    so a test that swaps a method after initialization still wins;
 *  - a member the stand-in does not define stays `undefined`, so a route's
 *    `dataLayer.x.y?.(…)` optional call behaves exactly as it did against the
 *    facade stand-in;
 *  - `getClient` and `legacyService` come off the stand-in, falling back to the
 *    stand-in itself for `legacyService` — which is what a suite that hands its
 *    fake to a `services/` singleton expects.
 *
 * ## The gotcha
 *
 * It maps EVERY namespace onto the same flat object, so it cannot catch a
 * route calling the wrong namespace — only `tsc` can, and it does. This is a
 * migration aid for existing suites, not the shape a NEW suite should use:
 * write new ones against real namespaces.
 */
import type { DataLayer } from "./index";

export function stubDataLayer(stub: Record<string, unknown>): DataLayer {
  const namespace = new Proxy(
    {},
    {
      get: (_target, member: string | symbol) => {
        if (typeof member !== "string") return undefined;
        const value = stub[member];
        if (typeof value !== "function") return value;
        return (...args: unknown[]) =>
          (stub[member] as (...a: unknown[]) => unknown)(...args);
      },
    },
  );

  return new Proxy({} as DataLayer, {
    get: (_target, prop: string | symbol) => {
      if (typeof prop !== "string") return undefined;
      if (prop === "then") return undefined;
      if (prop === "getClient") {
        return typeof stub.getClient === "function"
          ? (...args: unknown[]) =>
              (stub.getClient as (...a: unknown[]) => unknown)(...args)
          : stub.getClient;
      }
      if (prop === "legacyService") return stub.legacyService ?? stub;
      return namespace;
    },
  });
}
