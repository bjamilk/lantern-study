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
import { parseCommunityCode, parseInviteCode } from '../screens/discover/joinByCodeModel';

/**
 * Map legacy / notification links into navigation state.
 *
 * Every target is built with `toTab` (or an explicit `initial: false`), so a
 * notification tap lands on the artefact with its tab's root underneath it
 * rather than in a stack Back cannot leave.
 *
 * Nothing here has a side effect: it returns a navigation target and does no
 * I/O, joins nothing and writes nothing. The `discover/join/<code>` branch in
 * particular carries the code to the Communities segment's Join sheet, which
 * the student confirms — membership is not granted by resolving the link. The
 * group-invite path is different and does not pass through this table; see
 * hooks/useDeepLinkHandler.ts.
 *
 * `as any` recurs on every params object because `screen`/`params`/`initial`
 * is React Navigation's nested descriptor, and the return type here is the
 * flat `Record<string, string>` the callers share.
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
    case 'discover': {
      // `lanternstudy://discover/join/<code>` and `…/discover/c/<slug>` — the
      // two shapes a community link arrives in. `parseDeepLink` splits
      // `<type>/<id>` generically, so the code is `extra`-less and the raw URL
      // is re-read by `parseCommunityCode`, which is also what the Join sheet
      // and web use: one link cannot mean two things across three doors.
      /**
       * A one-time INVITE CODE goes to the Join sheet, which REDEEMS it —
       * `/discover/join/ABCD2345` used to be read as a slug (lowercased) and
       * pushed straight to a community page that 404s, because until this wave
       * a "code" could only ever be a slug. The sheet still falls back to the
       * slug lookup for an ambiguous string, so a public community whose slug
       * happens to look like a code is not lost.
       */
      const code = parseInviteCode(url);
      if (code) {
        return {
          screen: 'CampusTab',
          params: {
            screen: 'Campus',
            params: { segment: 'communities', joinCode: code, at: Date.now() },
          } as any,
        };
      }
      const slug = parseCommunityCode(url);
      if (slug) {
        return {
          screen: 'CampusTab',
          params: { screen: 'CommunityDetail', params: { slug }, initial: false } as any,
        };
      }
      // A code we cannot resolve to a community opens the Communities segment
      // with the Join sheet prefilled — never a dead end, and never a silent
      // drop, which is what a `return null` here would be.
      return {
        screen: 'CampusTab',
        params: {
          screen: 'Campus',
          params: {
            segment: 'communities',
            joinCode: parsed.id === 'join' ? '' : parsed.id,
            at: Date.now(),
          },
        } as any,
      };
    }
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
