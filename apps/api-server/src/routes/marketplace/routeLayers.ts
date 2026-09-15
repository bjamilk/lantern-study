/**
 * Flatten the marketplace router's layer stack.
 *
 * Before R5a the marketplace surface was one router, so a test could read
 * `(router as any).stack` and find a route layer directly. The split mounts ten
 * sub-routers under `index.ts`, so the route layers now live one level down.
 * This walks the tree the way Express does and returns the route layers in
 * resolution order, letting the route tests keep their "find the layer, call the
 * last handler" shape unchanged.
 *
 * Test-support only; nothing in the request path imports it.
 */
export function routeLayers(router: unknown): any[] {
  const out: any[] = [];
  const stack: any[] = (router as any)?.stack ?? [];
  for (const layer of stack) {
    if (layer.route) {
      out.push(layer);
    } else if (layer.name === 'router' && layer.handle?.stack) {
      out.push(...routeLayers(layer.handle));
    }
  }
  return out;
}
