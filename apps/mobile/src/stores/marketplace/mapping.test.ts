/**
 * Table tests for the marketplace mapping layer (lane R5b).
 *
 * These functions were inline inside the 2.5k-line store, where the only way
 * to exercise them was to drive the whole store. Pulled out, each one is a
 * pure input→output table: the rules that used to be provable only on a
 * handset — absent rights fields mean "not told", a null summary section keeps
 * the number already on screen, a chip outranks a drilled-in node — are now
 * asserted here.
 */
import {
  BUYER_ACTION_ORDER_STATUSES,
  EMPTY_SHOP_SUMMARY,
  buildBrowseScopeQuery,
  categoriesForTab,
  getCategoryInfo,
  mapOfferOrder,
  mapRemoteListing,
  marketplaceTabLabel,
  mergeShopSummary,
  offerAwaitsUser,
  orderAwaitsBuyerPayment,
  orderNeedsSeller,
  sumUnread,
} from './mapping';
import type { RemoteListing } from './types';

const baseRow: RemoteListing = {
  id: 'l1',
  user_id: 'u1',
  category: 'textbook_exchange',
  title: 'Organic Chemistry',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-02T00:00:00.000Z',
};

describe('mapRemoteListing', () => {
  it('fills the defaults a browse row omits', () => {
    const mapped = mapRemoteListing(baseRow);
    expect(mapped).toMatchObject({
      id: 'l1',
      user_id: 'u1',
      seller_id: 'u1',
      seller: undefined,
      images: [],
      views_count: 0,
      favorites_count: 0,
      status: 'active',
      rating_avg: null,
      rating_count: null,
      courseId: null,
      topicId: null,
    });
  });

  it.each([
    ['an unknown status falls back to active', 'not-a-status', 'active'],
    ['a moderation status is preserved', 'removed_by_admin', 'removed_by_admin'],
    ['a sold listing stays sold', 'sold', 'sold'],
  ])('%s', (_name, status, expected) => {
    expect(mapRemoteListing({ ...baseRow, status: status as string }).status).toBe(expected);
  });

  it.each([
    ['NUMERIC arrives as a string', '4.5', 3, 4.5, 3],
    ['pre-migration nulls stay null', null, null, null, null],
    ['a non-numeric count is not invented', 4, undefined, 4, null],
  ])('rating: %s', (_name, avg, count, expectedAvg, expectedCount) => {
    const mapped = mapRemoteListing({
      ...baseRow,
      rating_avg: avg as RemoteListing['rating_avg'],
      rating_count: count as RemoteListing['rating_count'],
    });
    expect(mapped.rating_avg).toBe(expectedAvg);
    expect(mapped.rating_count).toBe(expectedCount);
  });

  it('prefers the embedded seller over the profiles relation', () => {
    const mapped = mapRemoteListing({
      ...baseRow,
      seller: { id: 's1', name: 'Ada', avatar_url: 'a.png' },
      profiles: { id: 's2', name: 'Other' },
    });
    expect(mapped.seller).toEqual({ id: 's1', name: 'Ada', avatarUrl: 'a.png' });
  });

  it('leaves owner-only rights fields undefined on a browse row', () => {
    const mapped = mapRemoteListing(baseRow);
    // Absent means "not told", never "clean" — the UI must not read a missing
    // rights_status as an approved listing.
    expect(mapped.rights_status).toBeUndefined();
    expect(mapped.appeal_status).toBeUndefined();
    expect(mapped.takedown_reason).toBeNull();
  });

  it('maps the snake_case academic columns onto the camelCase fields', () => {
    expect(mapRemoteListing({ ...baseRow, course_id: 'c1', topic_id: 't1' })).toMatchObject({
      courseId: 'c1',
      topicId: 't1',
    });
  });
});

describe('mapOfferOrder', () => {
  it.each([
    ['null', null, null],
    ['undefined (older API build)', undefined, null],
    ['a non-object', 'nope', null],
    ['a row missing its id', { status: 'paid' }, null],
    ['a row missing its status', { id: 'o1' }, null],
  ])('%s maps to null', (_name, input, expected) => {
    expect(mapOfferOrder(input)).toBe(expected);
  });

  it('keeps a paymentId only when it is a string', () => {
    expect(mapOfferOrder({ id: 'o1', status: 'paid', paymentId: 'p1' })).toEqual({
      id: 'o1',
      status: 'paid',
      paymentId: 'p1',
    });
    expect(mapOfferOrder({ id: 'o1', status: 'paid' })).toEqual({
      id: 'o1',
      status: 'paid',
      paymentId: null,
    });
  });
});

describe('mergeShopSummary', () => {
  const prev = { ...EMPTY_SHOP_SUMMARY, cartCount: 3, openInquiries: 2, activeListings: 7 };

  it('keeps the number already on screen when the server could not count it', () => {
    const merged = mergeShopSummary(prev, {
      cartCount: null,
      openInquiries: undefined,
      activeListings: 9,
    } as never);
    expect(merged.cartCount).toBe(3);
    expect(merged.openInquiries).toBe(2);
    expect(merged.activeListings).toBe(9);
  });

  it('takes a real zero as an answer', () => {
    const merged = mergeShopSummary(prev, { cartCount: 0 } as never);
    expect(merged.cartCount).toBe(0);
  });

  it('reads offersAwaitingMe into pendingOffersReceived', () => {
    expect(mergeShopSummary(prev, { offersAwaitingMe: 4 } as never).pendingOffersReceived).toBe(4);
  });
});

describe('order badge predicates', () => {
  it.each([
    ['paid is the seller’s', { status: 'paid' }, true, false],
    ['cash pending with no payment id is the seller’s', { status: 'pending_payment' }, true, false],
    [
      'pending with a payment id is the buyer’s to pay',
      { status: 'pending_payment', payment_id: 'p1' },
      false,
      true,
    ],
    ['awaiting_payment is the buyer’s', { status: 'awaiting_payment' }, false, true],
    ['completed needs nobody', { status: 'completed' }, false, false],
  ])('%s', (_name, order, needsSeller, awaitsBuyer) => {
    expect(orderNeedsSeller(order as { status: string; payment_id?: string | null })).toBe(needsSeller);
    expect(orderAwaitsBuyerPayment(order as { status: string; payment_id?: string | null })).toBe(
      awaitsBuyer,
    );
  });

  it('counts the same statuses the pill calls "action"', () => {
    expect([...BUYER_ACTION_ORDER_STATUSES].sort()).toEqual([
      'awaiting_payment',
      'pending_payment',
      'ready_for_pickup',
      'shipped',
    ]);
  });
});

describe('offerAwaitsUser', () => {
  const offer = {
    status: 'pending',
    buyer_id: 'b1',
    seller_id: 's1',
    expires_at: null as string | null,
  };

  it.each([
    ['a settled offer needs nobody', { ...offer, status: 'accepted' }, false],
    ['a lapsed offer needs nobody', { ...offer, expires_at: '2000-01-01T00:00:00.000Z' }, false],
    ['a live pending offer needs someone', offer, true],
  ])('%s', (_name, input, expected) => {
    // No userId: "someone has to answer this", before working out whose turn it
    // is (that branch is canRespondToOffer's, tested in shared).
    expect(offerAwaitsUser(input, undefined)).toBe(expected);
  });
});

describe('sumUnread', () => {
  it.each([
    ['dedupes the shared thread id', ['t1', 't1'], { t1: 2 }, 2],
    ['a thread missing from the map counts zero', ['t1', 't2'], { t1: 2 }, 2],
    ['no threads is zero', [], { t1: 5 }, 0],
  ])('%s', (_name, ids, counts, expected) => {
    expect(sumUnread(ids as string[], counts as Record<string, number>)).toBe(expected);
  });
});

describe('buildBrowseScopeQuery', () => {
  it('sends nothing at all for the All tab', () => {
    expect(
      buildBrowseScopeQuery({ activeTab: 'all', categoryFilter: undefined, taxonomyNodeId: null }),
    ).toEqual({});
  });

  it('sends the department’s categories plus custom ones', () => {
    const query = buildBrowseScopeQuery({
      activeTab: 'electronics',
      categoryFilter: undefined,
      taxonomyNodeId: null,
    });
    expect(query.includeCustom).toBe(true);
    expect(Array.isArray(query.categories)).toBe(true);
  });

  it('lets an explicit chip outrank a drilled-in node', () => {
    expect(
      buildBrowseScopeQuery({
        activeTab: 'electronics',
        categoryFilter: 'textbook_exchange',
        taxonomyNodeId: 'electronics.computers.laptops',
      }),
    ).toEqual({ category: 'textbook_exchange' });
  });

  it('narrows to the drilled-in node when no chip is set', () => {
    const query = buildBrowseScopeQuery({
      activeTab: 'electronics',
      categoryFilter: undefined,
      taxonomyNodeId: 'electronics.computers.laptops',
    });
    expect(query.taxonomyNodeId ?? query.taxonomyNodeIds ?? query.categories).toBeDefined();
  });

  it('falls back to the department when the node id is unknown', () => {
    const query = buildBrowseScopeQuery({
      activeTab: 'electronics',
      categoryFilter: undefined,
      taxonomyNodeId: 'not-a-node',
    });
    expect(query.includeCustom).toBe(true);
  });
});

describe('browse catalog', () => {
  it.each([
    ['all', 'All'],
    ['shops', 'Shops'],
    ['study-materials', 'Books & Study'],
    ['campus-essentials', 'Essentials'],
  ])('labels %s as %s', (tab, label) => {
    expect(marketplaceTabLabel(tab as never)).toBe(label);
  });

  it('gives the Shops tab no category chips', () => {
    expect(categoriesForTab('shops')).toEqual([]);
  });

  it('spans every department on the All tab', () => {
    expect(categoriesForTab('all').length).toBeGreaterThan(categoriesForTab('electronics').length);
  });

  it('names an unknown category after itself rather than dropping it', () => {
    expect(getCategoryInfo('nonsense')).toEqual({
      id: 'nonsense',
      name: 'nonsense',
      icon: 'help-circle',
    });
  });
});
