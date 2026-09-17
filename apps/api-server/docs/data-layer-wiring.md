# How a route reaches the data layer (step 18 wiring decision)

`services/supabase.ts` is a pure facade: 382 one-line delegations into `services/data/*`,
rebuilding INLINE the `deps` literal each data function needs. Step 18 flips the ~125
importers off it. This is how they get the domain functions, deps already wired.

## Decision: (a) a composition root, `services/data/index.ts`

`createDataLayer({ client, supabaseUrl, host })` returns one object of per-domain
namespaces of bound functions — `{ getClient, groups, users, notifications, uploads,
readState }` — with each domain's `deps` literal built ONCE. Route families keep the
injector they already have; only the type changes:
`initializeGroupRoutes(data: DataLayer, cache)`, and bodies read
`data.groups.isGroupMember(...)`, `data.users.getUserById(...)`.

### Why not (b), importing the data modules directly from routes

Data functions take `(client, deps, …args)`, so every route file would rebuild `deps`
itself — the duplication the facade is being dismantled for — and thread the client in.
Worse for tests: the ~60 route suites inject a bare stand-in into `initialize*Routes` and
never load the real data modules. (b) would need `jest.mock('../services/data/<domain>')`
per suite — a rewrite each. (a) leaves the seam alone: a suite regroups its `jest.fn()`s.

### Follow-up, not fixed here

`getClient()` escapes flip to `dataLayer.getClient()` unchanged — raw queries in
route files, 84 sites: marketplace/offers 15, aiCompanion 11, users 8,
gamification 8, budget 8, marketplace/seller 6, marketplace/listings 5,
marketplace/orders 4, marketplace/discovery 4, groups 4, sitemap 3,
marketplace/cart 2, auth 2, and one each in tests, marketplace/payments,
analytics and ai. They belong in `services/data/*` like the admin queries did.

### Mock-update pattern (mechanical, one shape for every suite)

```ts
mod.initializeGroupRoutes({                 // was: { getGroupById, getUserById, … }
  groups: { getGroupById, addGroupMembersBatch, … },
  users: { getUserById },
  notifications: { createNotification },
  getClient: () => ({}),
} as any, cacheStub);
```
The stubs are untouched; they move under the namespace that owns them.
`jest.mock('../services/supabase', …)` is dropped from a flipped suite — the route no
longer imports it (the `DataLayer` type import is erased at compile time).

Where the stand-in is not a literal — a factory shared by twenty tests, or a `Proxy` —
`stubDataLayer(flat)` (`services/data/testStub.ts`, test only) adapts it in one line.

### Not a god object

Each namespace is that domain's own module, 9–21 functions; `DataLayer` is a record of
namespaces, not a 380-method class. Nothing calls across namespaces except the `deps`
arrows, which read through the layer AT CALL TIME
(`(id, uid) => layer.groups.isGroupMember(id, uid)`), so an overridden
`layer.groups.isGroupMember` is honoured by siblings, as with the facade's `this.` arrows.

### The `host` seam, and why the facade survives this PR

Three deps cannot be wired from the data layer alone:
`incrementUserStatsAndAwardBadges` passes `service: this` into `data/gamification.ts`, and
`deleteUserAccountFully` / `exportUserDataArchive` (`services/userDataLifecycle.ts`) take
the whole `SupabaseService`. They arrive as an explicitly typed `DataLayerHost`, built in
`server.ts` from the facade. It SHRINKS as later lanes bind more domains and flip those
two callees; empty, with every importer flipped, the facade can be deleted. Until then
`services/supabase.ts` stays deprecated-but-live for the callers this lane has not
reached, and its inline `deps` literals stay exactly as they are — a facade method must
keep reading `this.<method>` so `jest.spyOn(SupabaseService.prototype, …)` still
intercepts sibling calls in the ~50 suites that rely on it.

### Drift guard, and growth

Layer and facade wire the same `deps` twice during the transition; both are typed against
the same exported `*Deps` types, so a missing or mistyped dep in either is a compile
error. Namespaces are added domain by domain as lanes need them (this PR binds the five
`routes/groups.ts` uses), COMPLETELY — every exported function of the module — so the next
lane adds callers, never wiring.
