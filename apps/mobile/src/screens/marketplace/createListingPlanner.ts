/**
 * Whether a new listing has had its type chosen.
 *
 * WHY THIS EXISTS
 * ---------------
 * Create Listing used to open with the required "Listing type" already set to
 * "Textbooks & Course Books › Course textbook" — highlighted as if the seller
 * had picked it. A seller who never touched it published into a category they
 * never chose. The form now starts with no type, and publish is blocked until
 * one is picked.
 *
 * A type is "chosen" once the classifier has committed a leaf: it sets both the
 * taxonomy node id AND the listing category together (the "Something else" leaf
 * sets the node id and category `other`). Either one missing means the seller
 * has not chosen yet.
 *
 * Pure and import-free so mobile jest (node env, `*.test.ts` only) can reach it.
 */
export function isListingTypeChosen(input: {
  category: string | null | undefined;
  taxonomyNodeId: string | null | undefined;
}): boolean {
  return Boolean(input.category) && Boolean(input.taxonomyNodeId);
}
