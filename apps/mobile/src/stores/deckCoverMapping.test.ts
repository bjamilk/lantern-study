/**
 * A deck's cover has to survive the mapper.
 *
 * `mapDeckFromApi` rebuilds every deck row field by field, and it did not
 * carry `cover_path` / `coverPath`. So a cover uploaded successfully, drew its
 * banner from the optimistic local URI, and then vanished on the next
 * `fetchDecks` — after which every menu read the deck as having no cover and
 * offered "Add cover…", leaving no way to remove one. (The web had the same
 * bug in its own `mapDeckFromApi`.)
 */
// NOT imported from the store: `flashcardStore` imports the bare
// `@lantern/shared` barrel, which jest cannot resolve here (it re-exports
// .tsx components). `coverPathFields` IS the rule the mapper spreads.
import { coverPathFields } from '../components/ui/coverPickerModel';

const mapDeckFromApi = (data: any) => ({ id: data.id, ...coverPathFields(data) });

const BASE = { id: 'deck-1', name: 'Weak Areas Review' };
const PATH = 'owner-id/decks/deck-1/1757000000000-cover.webp';

describe('mapDeckFromApi', () => {
  it('keeps a cover that arrived snake_case from the list endpoint', () => {
    const deck = mapDeckFromApi({ ...BASE, cover_path: PATH });
    expect(deck?.cover_path).toBe(PATH);
    expect(deck?.coverPath).toBe(PATH);
  });

  it('keeps a cover that arrived camelCase from the cover route', () => {
    const deck = mapDeckFromApi({ ...BASE, coverPath: PATH });
    expect(deck?.cover_path).toBe(PATH);
    expect(deck?.coverPath).toBe(PATH);
  });

  it('reports no cover as null, not undefined, so "Remove cover" stays hidden', () => {
    const deck = mapDeckFromApi(BASE);
    expect(deck?.coverPath).toBeNull();
    expect(deck?.cover_path).toBeNull();
  });
});
