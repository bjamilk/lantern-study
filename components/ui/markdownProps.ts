/**
 * react-markdown hands every mapped component the mdast `node` it was built
 * from, on top of the element's own DOM attributes.
 *
 * `node` is not a DOM attribute: spreading the props object whole writes
 * `node="[object Object]"` into the markup and React warns about it. Every
 * mapping destructures `node` away and spreads only the rest.
 */
export type MdProps<T> = T & { node?: unknown };
