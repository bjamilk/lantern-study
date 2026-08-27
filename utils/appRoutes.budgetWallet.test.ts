import { describe, expect, it } from 'vitest';
import { AppMode } from '../types';
import {
  buildAppPath,
  isBudgetTabParam,
  parseAppRoute,
} from './appRoutes';

describe('budget Study wallet routes', () => {
  it('treats wallet as a Budget tab param', () => {
    expect(isBudgetTabParam('wallet')).toBe(true);
    expect(isBudgetTabParam('overview')).toBe(true);
    expect(isBudgetTabParam('insights')).toBe(false);
  });

  it('maps /budget/wallet onto the Budget tracker wallet tab', () => {
    expect(parseAppRoute('/budget/wallet')).toEqual({
      mode: AppMode.BUDGET_TRACKER,
      params: { budgetTab: 'wallet' },
    });
  });

  it('redirects legacy /wallet to /budget/wallet', () => {
    expect(parseAppRoute('/wallet')).toEqual({
      mode: AppMode.BUDGET_TRACKER,
      params: { budgetTab: 'wallet' },
      redirect: '/budget/wallet',
    });
  });

  it('keeps bare /budget on the tracker without a wallet tab', () => {
    expect(parseAppRoute('/budget')).toEqual({
      mode: AppMode.BUDGET_TRACKER,
      params: {},
    });
  });

  it('emits /budget/wallet only when the wallet tab is selected', () => {
    expect(buildAppPath(AppMode.BUDGET_TRACKER)).toBe('/budget');
    expect(buildAppPath(AppMode.BUDGET_TRACKER, { budgetTab: 'wallet' })).toBe('/budget/wallet');
    expect(buildAppPath(AppMode.BUDGET_TRACKER, { budgetTab: 'goals' })).toBe('/budget');
  });
});
