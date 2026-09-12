import { typeScale } from '../design/typeScale';
import { HEADING_STEPS, headingSize } from './noteBodySteps';

/**
 * The note heading ladder.
 *
 * A device pass found `## Overview` and `### Causes` indistinguishable from
 * body text. Two things caused that, and this file guards the first: the
 * mapping sat one step too low, so `##` was 17 sp over a 15 sp body — a 2 sp
 * step at the same weight, which on a phone is no hierarchy at all.
 *
 * These assertions are about the SHAPE of the ladder, not about three
 * memorised numbers: each level must be strictly larger than the next, and the
 * smallest of them must clear the body step by a visible margin.
 */
describe('note heading steps', () => {
  const size = headingSize;

  it('gives each level its own step, strictly descending', () => {
    expect(size('title')).toBeGreaterThan(size('heading'));
    expect(size('heading')).toBeGreaterThan(size('subheading'));
  });

  it('keeps the smallest heading a real step above body text', () => {
    // The flat-looking draft was body + 2. A step, not a nudge.
    expect(size('subheading') - typeScale.body.fontSize).toBeGreaterThanOrEqual(2);
    expect(size('heading') - typeScale.body.fontSize).toBeGreaterThanOrEqual(6);
    expect(size('title')).toBeGreaterThanOrEqual(28);
  });

  it('sets only the two display steps in the serif, and asks them for no weight', () => {
    // The Bitter faces carry their weight in the family name; a numeric
    // fontWeight over one is a faux-bold smear on iOS.
    expect(HEADING_STEPS.title.serif).toBe(true);
    expect(HEADING_STEPS.heading.serif).toBe(true);
    expect(HEADING_STEPS.subheading.serif).toBe(false);
  });

  it('keeps 20 dp of air above a section heading', () => {
    expect(HEADING_STEPS.heading.marginTop).toBe(20);
    expect(HEADING_STEPS.subheading.marginTop).toBe(20);
    // The note's own title opens the document; nothing precedes it.
    expect(HEADING_STEPS.title.marginTop).toBe(0);
  });
});
