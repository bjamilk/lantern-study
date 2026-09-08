/**
 * The Usage & limits panel, on the first paint — before the detail fetch lands.
 *
 * Static render only (no effects, no fetch), which is exactly the cold-start
 * frame the finding is about: the badge's shared figures start at the honest
 * unknown (limit 0), and the panel must NOT turn that into a number nobody
 * sent. `buildAIUsageView` reads a 0 as "AI uses are not available on this
 * account"; the panel routes it through `aiUsageCounterCopy`, so an
 * un-answered screen says it is checking rather than revoking the allowance —
 * and never prints the old "20 of 20" seed.
 */
import { describe, expect, it, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  AI_USAGE_UNKNOWN,
  AI_USAGE_CHECKING_LABEL,
} from '@lantern/shared/utils/aiUsage';

let latest = AI_USAGE_UNKNOWN;
vi.mock('../../services/ai', () => ({
  getLatestAIUsage: () => latest,
  fetchAIUsageDetail: vi.fn(async () => {
    throw new Error('not called under static render');
  }),
}));

const { default: UsageLimitsSection } = await import('./UsageLimitsSection');

function render() {
  return renderToStaticMarkup(React.createElement(UsageLimitsSection));
}

describe('UsageLimitsSection first paint', () => {
  it('says it is checking, not "not available" and not "20 of 20", when nothing is known', () => {
    latest = AI_USAGE_UNKNOWN;
    const html = render();
    expect(html).toContain(AI_USAGE_CHECKING_LABEL);
    expect(html).not.toContain('not available on this account');
    expect(html).not.toContain('20 of 20');
    // No false midnight reset claim while the reset time is unknown.
    expect(html).not.toContain('midnight');
  });

  it('repeats real cached figures rather than "checking" when the badge holds them', () => {
    latest = { used: 17, limit: 100, remaining: 83, resetsAt: '' };
    const html = render();
    expect(html).toContain('83 of 100 AI uses left today');
    expect(html).not.toContain(AI_USAGE_CHECKING_LABEL);
  });

  // "You cannot afford this" is a claim about a balance. With no figures the
  // view's `remaining` is the honest unknown (0), which marks every price
  // unaffordable — a shortfall nobody measured, drawn in the error colour.
  it('does not price the list as unaffordable before the server has answered', () => {
    latest = AI_USAGE_UNKNOWN;
    expect(render()).not.toContain('text-lantern-error');
  });

  it('still flags a real shortfall once the figures are known', () => {
    latest = { used: 99, limit: 100, remaining: 1, resetsAt: '' };
    // Deep smart notes (3) and note OCR (2) are out of reach at 1 left.
    expect(render()).toContain('text-lantern-error');
  });
});
