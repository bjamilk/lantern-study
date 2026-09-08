import {
  ORDER_NOT_FOUND_BODY,
  ORDER_NOT_FOUND_TITLE,
  ORDERS_ROUTE,
  orderBackTarget,
  orderDetailView,
} from './orderDetailState';

const ORDERS_ROUTE_TARGET = 'orders';

describe('orderDetailView', () => {
  it('is loading while the fetch is in flight, whatever the order state', () => {
    expect(orderDetailView({ loading: true, hasOrder: false })).toBe('loading');
    expect(orderDetailView({ loading: true, hasOrder: true })).toBe('loading');
  });

  it('is missing once loading finishes with no order', () => {
    expect(orderDetailView({ loading: false, hasOrder: false })).toBe('missing');
  });

  it('is ready once loading finishes with an order', () => {
    expect(orderDetailView({ loading: false, hasOrder: true })).toBe('ready');
  });
});

describe('order not found copy', () => {
  it('explains what happened without leaking a raw network or vendor string', () => {
    expect(ORDER_NOT_FOUND_TITLE).toBe('Order not found');
    expect(ORDER_NOT_FOUND_BODY.length).toBeGreaterThan(0);
    expect(ORDER_NOT_FOUND_BODY).not.toMatch(/404|null|undefined|http|sql|supabase|postgres/i);
  });
});

describe('orderBackTarget', () => {
  it('pops the stack when there is one to pop', () => {
    expect(orderBackTarget({ canGoBack: true })).toBe('pop');
  });

  // The rule this file exists for: on a cold-start deep link the Order screen
  // is the ONLY route, `goBack()` is a no-op, and back must still mean
  // something. Remove the fallback (always return 'pop') and this fails.
  it('falls back to the Orders list when back would be a dead button', () => {
    expect(orderBackTarget({ canGoBack: false })).toBe(ORDERS_ROUTE_TARGET);
  });

  it('names a real route to fall back to', () => {
    expect(ORDERS_ROUTE).toBe('Orders');
  });
});
