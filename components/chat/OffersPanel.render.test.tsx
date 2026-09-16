/**
 * Render smoke test for the marketplace Offers tab (lane M8b, step 1).
 *
 * The panel is 470 lines of money UI that only a buyer or a seller in a live
 * negotiation ever sees, and which no test has ever mounted. What is worth
 * pinning is not its markup but its four exclusive states and who they belong
 * to, because every one of them is a turn-based judgement:
 *
 *  - no offer yet → the buyer is invited to make one, the seller is told to
 *    wait. Offering to a seller would be nonsense; offering after the deal is
 *    done would be worse.
 *  - an offer pending on YOUR turn → Accept / Decline / Counter.
 *  - an offer pending on THEIR turn → Withdraw, and nothing else.
 *  - a live order → the deal bar disappears entirely, so the order bar is the
 *    only thing on screen that can propose an action.
 *
 * Static markup (`renderToStaticMarkup`): no effect runs, so nothing here
 * fetches or charges anything. `chatPanel` is a stub, because the conversation
 * has its own tests and this file is asking what wraps it.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { OffersPanel, type OffersPanelProps } from './OffersPanel';

const noop = () => {};

const currentUser = { id: 'buyer-1', name: 'Ada Ogundele', username: 'ada' } as never;

const inquiry = {
  id: 'inq-1',
  buyer_id: 'buyer-1',
  seller_id: 'seller-1',
  listing_id: 'lst-1',
  status: 'negotiating',
  listing: { id: 'lst-1', title: 'Organic Chemistry, 8th ed.', price: 12000, category: 'books' },
} as never;

const offer = (overrides: Record<string, unknown> = {}) =>
  ({
    id: 'off-1',
    listing_id: 'lst-1',
    buyer_id: 'buyer-1',
    seller_id: 'seller-1',
    amount: 9000,
    status: 'pending',
    proposed_by: 'buyer',
    created_at: '2026-09-15T10:00:00.000Z',
    ...overrides,
  }) as never;

const baseProps: OffersPanelProps = {
  inquiry,
  activeOffer: null,
  offerHistory: [],
  activeOrder: null,
  currentUser,
  activeTab: 'offers',
  setActiveTab: noop,
  offerError: '',
  offerLoading: false,
  showCounterInput: false,
  setShowCounterInput: noop,
  counterValue: '',
  setCounterValue: noop,
  setShowMakeOfferModal: noop,
  orderActionLoading: false,
  setOrderActionLoading: noop,
  setActiveOrder: noop,
  handleRespond: noop,
  chatPanel: <div data-testid="chat-panel" />,
};

const render = (props: Partial<OffersPanelProps> = {}) =>
  renderToStaticMarkup(<OffersPanel {...baseProps} {...props} />);

describe('OffersPanel', () => {
  it('shows the listing and both tabs', () => {
    const html = render();
    expect(html).toContain('Organic Chemistry, 8th ed.');
    expect(html).toContain('Chat');
    expect(html).toContain('Offers');
  });

  it('wraps the conversation it was given, rather than rebuilding one', () => {
    const html = render({ activeTab: 'chat' });
    expect(html).toContain('data-testid="chat-panel"');
  });

  it('invites the BUYER to make the first offer when there is none', () => {
    const html = render();
    expect(html).toContain('There are no active offers in negotiation.');
    expect(html).toContain('Make an Offer');
  });

  it('does not invite the SELLER to make an offer on their own listing', () => {
    const html = render({ currentUser: { id: 'seller-1' } as never });
    expect(html).toContain('There are no active offers in negotiation.');
    expect(html).not.toContain('Make an Offer');
    // The deal bar tells the seller whose turn it is instead.
    expect(html).toContain('Waiting for the buyer to make an offer.');
  });

  it('offers Accept / Decline / Counter to the side whose turn it is', () => {
    // The buyer proposed, so the SELLER is the one who can respond.
    const html = render({
      currentUser: { id: 'seller-1' } as never,
      activeOffer: offer(),
    });
    expect(html).toContain('Accept Offer');
    expect(html).toContain('Decline Offer');
    expect(html).toContain('Counter Offer');
  });

  it('offers only Withdraw to the side waiting for a response', () => {
    const html = render({ activeOffer: offer() });
    expect(html).toContain('Withdraw Offer');
    expect(html).not.toContain('Accept Offer');
    // The deal bar says the same thing in one line, without an action.
    expect(html).toContain('Waiting for a response');
  });

  it('hides the deal bar once an order exists, and shows the order bar', () => {
    const html = render({
      activeOffer: offer({ status: 'accepted' }),
      activeOrder: { id: 'ord-1', status: 'pending_payment', amount: 9000 } as never,
    });
    // The deal bar's own line is gone — the order bar owns these states.
    expect(html).not.toContain('Paystack-protected · you pay the listed price');
    expect(html).toContain('Order: pending payment');
    // The buyer, and only the buyer, is asked to pay.
    expect(html).toContain('Pay now');
  });

  it('renders the negotiation history oldest-first, with who said what', () => {
    const html = render({
      offerHistory: [
        offer({ id: 'off-1', amount: 9000, status: 'countered', proposed_by: 'buyer' }),
        offer({ id: 'off-2', amount: 10500, status: 'pending', proposed_by: 'seller' }),
      ],
    });
    expect(html).toContain('You offered ₦9,000 (countered)');
    expect(html).toContain('Seller countered ₦10,500 (pending)');
    expect(html.indexOf('9,000')).toBeLessThan(html.indexOf('10,500'));
  });

  it('says nothing is left to negotiate once the deal is closed', () => {
    const html = render({ inquiry: { ...(inquiry as object), status: 'purchased' } as never });
    expect(html).toContain('This listing has been purchased or the inquiry is closed.');
    expect(html).not.toContain('Make an Offer');
  });
});
