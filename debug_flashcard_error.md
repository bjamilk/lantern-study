# Flashcard Menu Error — Resolved

## Original problem
Error: "Cannot read properties of null (reading 'id')" in FlashcardsScreen when accessing `deck.id`.

## Root cause (inferred)
Null or malformed deck entries could enter client state from cached AsyncStorage or unfiltered API responses. The API `getDecks` path returns valid rows; corruption was client-side defensive gap on mobile.

## Fixes applied
- **Web:** `sanitizeDecks` in `stores/flashcardStore.ts`; `fetchDecks` filters null entries in `services/supabase.ts`
- **Mobile:** `sanitizeDecks` parity in `apps/mobile/src/stores/flashcardStore.ts` (fetch + cache load)
- **API:** `getDecks` filters rows missing `id` before returning

## Status
Mitigated in web, mobile, and API layers. If the error recurs, capture network response from `GET /api/v1/decks` and AsyncStorage `lantern_decks` contents.
