import {
  AXIS_LABEL_WIDTH,
  axisLabel,
  axisLabelBox,
  axisLabelStride,
  buildAxisLabels,
  shouldShowAxisLabel,
} from './chartAxisLabels';

describe('axisLabel', () => {
  it('keeps the date from a timeline point key', () => {
    expect(axisLabel('Test 3 - 06/21', 'daily')).toBe('06/21');
    expect(axisLabel('Test 12 - 12/01', 'daily')).toBe('12/01');
  });

  it('pads a single-digit slash date', () => {
    expect(axisLabel('Test 1 - 6/7', 'daily')).toBe('06/07');
  });

  it('reduces a weekly bucket key to its week, not the old "6-W36"', () => {
    expect(axisLabel('2026-W36', 'weekly')).toBe('W36');
    expect(axisLabel('2026-W36', 'weekly')).not.toBe('6-W36');
    expect(axisLabel('2026-W05', 'weekly')).toBe('W05');
  });

  it('reads a week key even when the chart is in daily mode', () => {
    expect(axisLabel('2026-W36', 'daily')).toBe('W36');
  });

  it('falls back to the test number when a point has no date', () => {
    expect(axisLabel('Test 3', 'daily')).toBe('T3');
    expect(axisLabel('Test 12', 'daily')).toBe('T12');
  });

  it('handles an ISO date point key', () => {
    expect(axisLabel('2026-06-21', 'daily')).toBe('06/21');
  });

  it('returns unrecognised or empty keys without truncating them', () => {
    expect(axisLabel('Midterm', 'daily')).toBe('Midterm');
    expect(axisLabel('', 'daily')).toBe('');
    expect(axisLabel(7, 'daily')).toBe('7');
  });
});

describe('axisLabelStride', () => {
  it('labels every point when they all fit', () => {
    // 300dp / 44dp = 6 label slots, 5 points.
    expect(axisLabelStride(5, 300)).toBe(1);
  });

  it('thins labels as points outgrow the width', () => {
    expect(axisLabelStride(12, 300)).toBe(2);
    expect(axisLabelStride(40, 300)).toBe(7);
  });

  it('never returns a stride below 1', () => {
    expect(axisLabelStride(0, 300)).toBe(1);
    expect(axisLabelStride(1, 300)).toBe(1);
    expect(axisLabelStride(9, 0)).toBeGreaterThanOrEqual(1);
    expect(axisLabelStride(9, 300, 0)).toBeGreaterThanOrEqual(1);
  });

  it('keeps labelled points at least a label box apart', () => {
    const count = 23;
    const plotWidth = 280;
    const stride = axisLabelStride(count, plotWidth);
    const spacing = plotWidth / (count - 1);
    expect(stride * spacing).toBeGreaterThanOrEqual(AXIS_LABEL_WIDTH * 0.9);
  });
});

describe('shouldShowAxisLabel', () => {
  it('always labels the last point', () => {
    expect(shouldShowAxisLabel(10, 11, 3)).toBe(true);
  });

  it('steps backwards from the end', () => {
    const shown = [0, 1, 2, 3, 4, 5, 6].filter((i) => shouldShowAxisLabel(i, 7, 3));
    expect(shown).toEqual([0, 3, 6]);
  });

  it('labels every point at stride 1', () => {
    expect([0, 1, 2].every((i) => shouldShowAxisLabel(i, 3, 1))).toBe(true);
  });

  it('rejects out-of-range indices', () => {
    expect(shouldShowAxisLabel(-1, 5, 1)).toBe(false);
    expect(shouldShowAxisLabel(5, 5, 1)).toBe(false);
    expect(shouldShowAxisLabel(0, 0, 1)).toBe(false);
  });
});

describe('buildAxisLabels', () => {
  it('blanks the skipped points and formats the rest', () => {
    const xs = ['Test 1 - 06/01', 'Test 2 - 06/08', 'Test 3 - 06/15', 'Test 4 - 06/21'];
    // End-anchored: the most recent test is always labelled.
    expect(buildAxisLabels(xs, 'daily', 100)).toEqual(['', '06/08', '', '06/21']);
  });

  it('formats every weekly label when they fit', () => {
    expect(buildAxisLabels(['2026-W34', '2026-W35', '2026-W36'], 'weekly', 300)).toEqual([
      'W34',
      'W35',
      'W36',
    ]);
  });

  it('never emits a label longer than the box it is given', () => {
    const xs = Array.from({ length: 30 }, (_, i) => `Test ${i + 1} - 06/${String(i + 1).padStart(2, '0')}`);
    for (const label of buildAxisLabels(xs, 'daily', 280)) {
      expect(label.length).toBeLessThanOrEqual(5);
    }
  });
});

describe('axisLabelBox', () => {
  it('widens the box when the chart packs points tighter than a label', () => {
    const box = axisLabelBox(16);
    expect(box.width).toBe(AXIS_LABEL_WIDTH);
    expect(box.marginLeft).toBe(-14);
  });

  it('keeps the label centred on its point', () => {
    const spacing = 16;
    const box = axisLabelBox(spacing);
    // Box centre, measured from the container's left edge, lands on the point.
    expect(box.marginLeft + box.width / 2).toBeCloseTo(spacing / 2);
  });

  it('does not shrink a box that is already wide enough', () => {
    expect(axisLabelBox(80)).toEqual({ width: 80, marginLeft: 0 });
  });

  it('survives a degenerate spacing', () => {
    expect(axisLabelBox(0).width).toBe(AXIS_LABEL_WIDTH);
    expect(axisLabelBox(-5).width).toBe(AXIS_LABEL_WIDTH);
  });
});
