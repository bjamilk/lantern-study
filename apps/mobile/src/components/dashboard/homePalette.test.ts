/**
 * Home may not paint itself out of Tailwind's palette.
 *
 * The SF2 evidence (§5.2) found an `bg-amber-500` "Quick Test" banner on Home,
 * plus three more amber panels and two loose `#f59e0b` glyphs. A Tailwind
 * palette class is not a token: it is the same colour in light and dark, no
 * theme can move it, and nothing anywhere else in the app answers to it — so
 * the banner read as a warning about nothing and the two ambers beside it did
 * not match. They are gone, and this is the gate that keeps them gone.
 *
 * Scoped to the files Home and its Progress door actually draw. It is a source
 * scan rather than a render test on purpose: the defect is a literal in the
 * file, and a literal is exactly what a grep can prove absent.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const HOME_FILES = [
  '../../screens/dashboard/DashboardScreen.tsx',
  './HomeProgressCard.tsx',
  './HomeRecentActivities.tsx',
  './HomeRecentMaterials.tsx',
  './HomeQuickActions.tsx',
  './HomeStudySetsCard.tsx',
  './HomeUpcomingExam.tsx',
  './DashboardHeroCard.tsx',
  './DashboardInsights.tsx',
  './ActivityHeatmap.tsx',
];

/** Comments may NAME the retired colour; only code may not use it. */
function code(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function read(relative: string): string {
  return code(readFileSync(join(__dirname, relative), 'utf8'));
}

describe('Home paints from tokens, never from Tailwind amber', () => {
  it.each(HOME_FILES)('%s has no amber utility class', (file) => {
    // `bg-amber-500`, `text-amber-700`, `dark:bg-amber-950/30` — every shape
    // the retired banner and its three panels used.
    expect(read(file)).not.toMatch(/\bamber-\d{2,3}\b/);
  });

  it.each(HOME_FILES)('%s has no raw amber hex', (file) => {
    // #F59E0B is Tailwind amber-500, the banner's own fill. #f97316 is the
    // orange the streak flame used beside it.
    expect(read(file)).not.toMatch(/#(f59e0b|f97316)/i);
  });

  it('actually detects the pattern it is meant to guard (self-check)', () => {
    // A lint whose matcher is wrong passes on everything, including the defect.
    expect(code('const x = "bg-amber-500";')).toMatch(/\bamber-\d{2,3}\b/);
    expect(code('color="#F59E0B"')).toMatch(/#(f59e0b|f97316)/i);
    // …and a comment naming the retired colour is not a violation.
    expect(code('// the old #f59e0b banner')).not.toMatch(/#(f59e0b|f97316)/i);
  });
});
