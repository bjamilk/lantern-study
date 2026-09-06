import { focusedInputAfterBlur, measurableFocusTarget, type MeasurableInput } from './focusedInputTracker';

const input = (): MeasurableInput => ({ measureInWindow: () => {} });

describe('measurableFocusTarget', () => {
  it('keeps a host instance that can be measured', () => {
    const node = input();
    expect(measurableFocusTarget(node)).toBe(node);
  });

  it('ignores the legacy renderer numeric node handle', () => {
    // The old architecture delivers `event.target` as a node handle, which has
    // no measureInWindow. Reveal is skipped rather than crashed.
    expect(measurableFocusTarget(17)).toBeNull();
  });

  it('ignores a released or empty event target instead of throwing', () => {
    expect(measurableFocusTarget(null)).toBeNull();
    expect(measurableFocusTarget(undefined)).toBeNull();
  });

  it('ignores a bubbled focus from something that is not a measurable view', () => {
    expect(measurableFocusTarget({})).toBeNull();
    expect(measurableFocusTarget({ measureInWindow: 'nope' })).toBeNull();
    expect(measurableFocusTarget('input')).toBeNull();
  });
});

describe('focusedInputAfterBlur', () => {
  it('clears the slot when the tracked input is the one that blurred', () => {
    const node = input();
    expect(focusedInputAfterBlur(node, node)).toBeNull();
  });

  it('keeps the new field when blur(A) arrives after focus(B)', () => {
    const a = input();
    const b = input();
    expect(focusedInputAfterBlur(b, a)).toBe(b);
  });

  it('keeps the tracked input when the blur target is unusable', () => {
    const node = input();
    expect(focusedInputAfterBlur(node, null)).toBe(node);
    expect(focusedInputAfterBlur(node, 17)).toBe(node);
  });

  it('stays empty when nothing was tracked', () => {
    expect(focusedInputAfterBlur(null, input())).toBeNull();
    expect(focusedInputAfterBlur(null, null)).toBeNull();
  });
});
