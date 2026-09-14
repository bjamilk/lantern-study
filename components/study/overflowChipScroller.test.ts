import { describe, expect, it } from 'vitest';
import { overflowChipDirections } from './overflowChipScroller';

describe('overflowChipDirections', () => {
  it('hides both arrows when every chip fits', () => {
    expect(overflowChipDirections(0, 400, 400)).toEqual({ left: false, right: false });
  });

  it('shows only right when the row starts overflowed', () => {
    expect(overflowChipDirections(0, 400, 720)).toEqual({ left: false, right: true });
  });

  it('shows both arrows in the middle of a long row', () => {
    expect(overflowChipDirections(120, 400, 720)).toEqual({ left: true, right: true });
  });

  it('shows only left at the end of the row', () => {
    expect(overflowChipDirections(320, 400, 720)).toEqual({ left: true, right: false });
  });
});
