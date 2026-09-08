import { budgetSpendStatus } from './budgetOverviewPlanner';

describe('budgetSpendStatus', () => {
  it('reports no budget when the cap is zero, even with spending', () => {
    expect(budgetSpendStatus(0, 100)).toEqual({ kind: 'none' });
  });

  it('reports no budget when the cap is missing', () => {
    expect(budgetSpendStatus(null, 100)).toEqual({ kind: 'none' });
    expect(budgetSpendStatus(undefined, 0)).toEqual({ kind: 'none' });
  });

  it('never returns a negative "left" amount', () => {
    // The old bug: 0 cap, ₦100 spent → "-100 left". A zero cap is no budget.
    const status = budgetSpendStatus(0, 100);
    expect(status.kind).toBe('none');
  });

  it('reports what is left while under the cap', () => {
    expect(budgetSpendStatus(1000, 400)).toEqual({ kind: 'left', amount: 600 });
  });

  it('treats spending exactly at the cap as zero left, not over', () => {
    expect(budgetSpendStatus(1000, 1000)).toEqual({ kind: 'left', amount: 0 });
  });

  it('reports the overspend once past the cap', () => {
    expect(budgetSpendStatus(1000, 1500)).toEqual({ kind: 'over', amount: 500 });
  });
});
