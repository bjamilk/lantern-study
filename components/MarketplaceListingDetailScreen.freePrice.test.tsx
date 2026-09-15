import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

/**
 * The stray `0` on every free listing.
 *
 * The purchase card gated four blocks on `listing.price && listing.price > 0 &&
 * (<JSX/>)`. For a free listing `listing.price` is the NUMBER 0, so `&&`
 * short-circuits to `0` — and React renders a bare `0`, unlike `null`,
 * `undefined` or `false`. Four such chains meant four naked zeros floating in
 * the purchase card of every ₦0 listing on `/marketplace/listing/...`.
 *
 * Two halves, because the screen itself cannot be rendered in a unit test: it
 * loads `listing` from a fetch inside `useEffect`, so any server render shows
 * the loading state and never reaches the purchase card at all.
 *
 *  1. Render the two guard shapes and prove which one leaks a `0`.
 *  2. Scan the real marketplace sources so the leaking shape cannot come back.
 */

const here = dirname(fileURLToPath(import.meta.url));

describe('a ₦0 listing renders no stray zero', () => {
  const Card = ({ price, guard }: { price: number | null; guard: 'truthy' | 'numeric' }) => (
    <div>
      {guard === 'truthy'
        ? // The shipped bug, kept here as the thing being asserted against.
          ((price && price > 0 && <button>Buy now</button>) as React.ReactNode)
        : (price ?? 0) > 0 && <button>Buy now</button>}
    </div>
  );

  it('prints a bare 0 when the guard leans on numeric truthiness', () => {
    // If this ever stops being true, React changed and the scan below is moot.
    expect(renderToStaticMarkup(<Card price={0} guard="truthy" />)).toBe('<div>0</div>');
  });

  it('prints nothing for a free listing under the numeric guard', () => {
    const html = renderToStaticMarkup(<Card price={0} guard="numeric" />);
    expect(html).toBe('<div></div>');
    expect(html).not.toMatch(/>0</);
  });

  it('still shows the purchase action on a priced listing', () => {
    expect(renderToStaticMarkup(<Card price={2500} guard="numeric" />)).toContain('Buy now');
  });

  it('prints nothing when the price is absent rather than zero', () => {
    expect(renderToStaticMarkup(<Card price={null} guard="numeric" />)).toBe('<div></div>');
  });
});

describe('no marketplace component guards JSX on a truthy price', () => {
  // `price && <anything> > 0 &&` — a numeric truthiness test feeding straight
  // into another `&&`, which is the shape that renders `0`. A ternary
  // (`price && price > 0 ? a : b`) and a negation (`!(price && price > 0)`) both
  // end in something other than `&&`, so neither matches: both are safe.
  const leakyGuard = /\bprice\b\s*&&\s*[\w.?$]*\s*>\s*0\s*&&/;

  const files = readdirSync(here)
    .filter((f) => f.endsWith('.tsx') && !f.endsWith('.test.tsx'))
    .filter((f) => /market|listing|offer|cart|checkout|shop/i.test(f));

  it('has marketplace components to scan', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)('%s', (file) => {
    const offenders = readFileSync(join(here, file), 'utf8')
      .split('\n')
      // Join each line with the next few: the chains are often wrapped.
      .map((line, i, all) => ({ line: i + 1, text: all.slice(i, i + 4).join(' ') }))
      .filter((entry) => leakyGuard.test(entry.text))
      .map((entry) => `${file}:${entry.line}`);

    expect(offenders).toEqual([]);
  });
});
