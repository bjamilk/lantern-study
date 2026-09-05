import { resolveCampusRedirect, resolveMeRedirect } from './legacyTabs';

const AT = 1_700_000_000_000;

describe('resolveCampusRedirect', () => {
  it('sends a bare navigate("MarketTab") to the Campus Shop segment', () => {
    expect(resolveCampusRedirect(undefined, 'shop', AT)).toEqual({
      tab: 'CampusTab',
      params: { screen: 'Campus', params: { segment: 'shop', at: AT } },
    });
  });

  it('sends a bare navigate("JobsTab") to the Campus Jobs segment', () => {
    expect(resolveCampusRedirect(undefined, 'jobs', AT)).toEqual({
      tab: 'CampusTab',
      params: { screen: 'Campus', params: { segment: 'jobs', at: AT } },
    });
  });

  it('turns the two retired HOME routes into segments, not screens', () => {
    // MarketplaceHome and JobsHome became segments of Campus; six screens
    // still call navigate('MarketplaceHome') and one calls navigate('JobsHome').
    expect(resolveCampusRedirect({ screen: 'MarketplaceHome' }, 'jobs', AT).params).toEqual({
      screen: 'Campus',
      params: { segment: 'shop', at: AT },
    });
    expect(resolveCampusRedirect({ screen: 'JobsHome' }, 'shop', AT).params).toEqual({
      screen: 'Campus',
      params: { segment: 'jobs', at: AT },
    });
  });

  it('passes every other Shop/Jobs route straight through to CampusStack', () => {
    expect(
      resolveCampusRedirect({ screen: 'ListingDetail', params: { listingId: 'abc' } }, 'shop', AT)
    ).toEqual({
      tab: 'CampusTab',
      params: { screen: 'ListingDetail', params: { listingId: 'abc' }, initial: false },
    });
  });

  it('puts Campus beneath a deep-linked detail screen so Back returns to the segment', () => {
    const redirect = resolveCampusRedirect({ screen: 'JobDetail', params: { jobId: 'j1' } }, 'jobs', AT);
    expect(redirect.params.initial).toBe(false);
  });

  it('omits an empty params key rather than sending params: undefined', () => {
    const redirect = resolveCampusRedirect({ screen: 'Cart' }, 'shop', AT);
    expect(redirect.params).toEqual({ screen: 'Cart', initial: false });
    expect('params' in redirect.params).toBe(false);
  });

  it('always lands on the Campus tab', () => {
    expect(resolveCampusRedirect({ screen: 'Orders' }, 'shop', AT).tab).toBe('CampusTab');
    expect(resolveCampusRedirect(undefined, 'jobs', AT).tab).toBe('CampusTab');
  });
});

describe('resolveMeRedirect', () => {
  it('sends a bare navigate("BudgetTab") to Budget inside Me', () => {
    expect(resolveMeRedirect(undefined)).toEqual({
      tab: 'MeTab',
      params: { screen: 'BudgetHome', initial: false },
    });
  });

  it('passes a nested budget route through with its params', () => {
    expect(resolveMeRedirect({ screen: 'BudgetHome', params: { tab: 'wallet' } })).toEqual({
      tab: 'MeTab',
      params: { screen: 'BudgetHome', params: { tab: 'wallet' }, initial: false },
    });
  });

  it('keeps Me beneath the pushed screen so Back returns to Me', () => {
    expect(resolveMeRedirect({ screen: 'SavingsGoals' }).params.initial).toBe(false);
  });
});
