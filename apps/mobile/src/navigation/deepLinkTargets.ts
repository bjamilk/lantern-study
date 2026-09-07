/**
 * Where a deep link lands.
 *
 * Pure: `parseDeepLink` and `toTab` are the only things it needs, so the whole
 * table can be asserted in node. It is shared by the linking config, the
 * notification tap handler and every "Open" button, so a link cannot mean one
 * thing on a cold start and another on a tap.
 */
import { parseDeepLink } from '@lantern/shared/linking';
import { toTab } from './nestedTab';

/**
 * Map legacy / notification links into navigation state.
 *
 * Every target is built with `toTab` (or an explicit `initial: false`), so a
 * notification tap lands on the artefact with its tab's root underneath it
 * rather than in a stack Back cannot leave.
 */
export function resolveDeepLinkNavigation(url: string): { screen: string; params?: Record<string, string> } | null {
  const parsed = parseDeepLink(url);
  if (!parsed) return null;
  switch (parsed.type as string) {
    // Wave G: a finished generation links to what it made. `note` and `quiz`
    // are not members of the shared `DeepLinkType` union — `parseDeepLink`
    // returns them happily, since it splits `<type>/<id>` generically, and
    // widening that union is packages/shared's call, not this app's.
    case 'note':
      return { screen: 'StudyTab', params: toTab('NoteEditor', { noteId: parsed.id }) as any };
    case 'quiz':
      // The DAILY quiz — the one answered in place on the dashboard — has no
      // screen of its own, so its tab root IS the artefact. Naming Dashboard
      // here with initial:false would stack the root under itself.
      //
      // A quiz generated from a note is NOT this: it is saved as a test of
      // the student's own and links as `test/<id>`. It used to be filed under
      // `quiz/daily`, which is why "Open" on a finished note quiz landed on
      // Home while the Tests list said "No tests available". This case
      // survives only for job records persisted by that build.
      return { screen: 'HomeTab' };
    case 'deck':
      return { screen: 'StudyTab', params: toTab('DeckDetail', { deckId: parsed.id }) as any };
    case 'group':
      return { screen: 'ChatTab', params: { screen: 'GroupChat', params: { groupId: parsed.id }, initial: false } as any };
    case 'listing':
      return { screen: 'CampusTab', params: { screen: 'ListingDetail', params: { listingId: parsed.id }, initial: false } as any };
    case 'flashcard':
      return parsed.extra?.deckId
        ? { screen: 'StudyTab', params: toTab('DeckDetail', { deckId: parsed.extra.deckId }) as any }
        : { screen: 'StudyTab', params: toTab('FlashcardsList') as any };
    case 'profile':
      return { screen: 'EditProfile' } as any;
    case 'marketplace':
      // marketplace/orders/:orderId (Paystack return / notification deep links)
      if (parsed.id === 'orders' && parsed.extra?.orderId) {
        return {
          screen: 'CampusTab',
          params: {
            initial: false,
            screen: 'OrderDetail',
            params: {
              orderId: parsed.extra.orderId,
              payment: parsed.extra.payment,
              reference: parsed.extra.reference || parsed.extra.trxref,
            },
          } as any,
        };
      }
      return { screen: 'CampusTab', params: { screen: 'Campus', params: { segment: 'shop' } } as any };
    case 'budget':
      return { screen: 'MeTab', params: { screen: 'BudgetHome', initial: false } as any };
    case 'join':
      return { screen: 'JoinClass', params: { code: parsed.id } } as any;
    case 'test':
      // A generated test opens as the test itself; the bare `test` link (no
      // id) is the older "go to my tests" form and still lands on the list.
      return parsed.id
        ? {
            screen: 'StudyTab',
            params: toTab('TestTaking', {
              testId: parsed.id,
              testName: parsed.extra?.name || 'Your test',
            }) as any,
          }
        : { screen: 'StudyTab', params: toTab('TestsList') as any };
    default:
      return null;
  }
}
