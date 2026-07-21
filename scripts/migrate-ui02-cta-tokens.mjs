#!/usr/bin/env node
/**
 * UI-02: Replace raw blue/purple CTA Tailwind classes with lantern semantic tokens.
 * Skips GameScreen (intentional multi-color answer identities).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const COMPONENTS = path.join(ROOT, 'components');
const SKIP = new Set(['GameScreen.tsx']);

const REPLACEMENTS = [
  // Primary CTA fills
  ['bg-blue-600 hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600', 'bg-lantern-primary hover:bg-lantern-primary-dark'],
  ['bg-blue-600 hover:bg-blue-700', 'bg-lantern-primary hover:bg-lantern-primary-dark'],
  ['bg-purple-600 hover:bg-purple-700 dark:bg-purple-500 dark:hover:bg-purple-600', 'bg-lantern-primary hover:bg-lantern-primary-dark'],
  ['bg-purple-600 hover:bg-purple-700', 'bg-lantern-primary hover:bg-lantern-primary-dark'],
  ['bg-purple-500 hover:bg-purple-600', 'bg-lantern-primary hover:bg-lantern-primary-dark'],
  ['bg-blue-600', 'bg-lantern-primary'],
  ['bg-blue-400', 'bg-lantern-primary-light'],
  ['bg-purple-600', 'bg-lantern-primary'],
  ['bg-purple-500', 'bg-lantern-primary'],
  ['hover:bg-blue-700', 'hover:bg-lantern-primary-dark'],
  ['hover:bg-blue-500', 'hover:bg-lantern-primary'],
  ['hover:bg-purple-700', 'hover:bg-lantern-primary-dark'],
  ['hover:bg-purple-600', 'hover:bg-lantern-primary-dark'],
  ['dark:bg-blue-500', 'dark:bg-lantern-primary'],
  ['dark:hover:bg-blue-600', 'dark:hover:bg-lantern-primary-dark'],
  ['dark:bg-purple-500', 'dark:bg-lantern-primary'],
  ['dark:hover:bg-purple-600', 'dark:hover:bg-lantern-primary-dark'],
  ['focus:ring-blue-400', 'focus:ring-lantern-primary'],
  ['focus:ring-purple-400', 'focus:ring-lantern-primary'],
  ['dark:focus:ring-blue-400', 'dark:focus:ring-lantern-primary'],

  // Accent / link text used on CTAs and chrome
  ['text-purple-600 dark:text-purple-400', 'text-lantern-primary'],
  ['text-purple-600 dark:text-purple-300', 'text-lantern-primary'],
  ['text-purple-500 hover:text-purple-600', 'text-lantern-primary hover:text-lantern-primary-dark'],
  ['text-purple-600', 'text-lantern-primary'],
  ['text-purple-500', 'text-lantern-primary'],
  ['text-purple-400', 'text-lantern-primary-light'],
  ['hover:text-purple-600', 'hover:text-lantern-primary'],

  // Soft purple chip / secondary action surfaces
  ['text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-900/20 hover:bg-purple-100 dark:hover:bg-purple-900/40 border border-purple-200 dark:border-purple-700',
    'text-lantern-primary bg-lantern-primary-background hover:bg-lantern-primary-background border border-lantern-primary/30'],
  ['bg-purple-50 dark:bg-purple-900/20', 'bg-lantern-primary-background'],
  ['hover:bg-purple-100 dark:hover:bg-purple-900/40', 'hover:bg-lantern-primary-background'],
  ['hover:bg-purple-50 dark:hover:bg-purple-900/20', 'hover:bg-lantern-primary-background'],
  ['border-purple-200 dark:border-purple-700', 'border-lantern-primary/30'],
  ['border-purple-300 dark:border-purple-700', 'border-lantern-primary/40'],
  ['border-2 border-dashed border-purple-300 dark:border-purple-700', 'border-2 border-dashed border-lantern-primary/40'],
  ['bg-purple-100 text-purple-600 dark:bg-purple-900/40 dark:text-purple-400', 'bg-lantern-primary-background text-lantern-primary'],
];

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (/\.(tsx|ts|jsx|js)$/.test(name) && !SKIP.has(name)) out.push(full);
  }
  return out;
}

let changedFiles = 0;
let totalHits = 0;
for (const file of walk(COMPONENTS)) {
  let src = fs.readFileSync(file, 'utf8');
  let hits = 0;
  for (const [from, to] of REPLACEMENTS) {
    if (!src.includes(from)) continue;
    const parts = src.split(from);
    hits += parts.length - 1;
    src = parts.join(to);
  }
  if (hits > 0) {
    fs.writeFileSync(file, src);
    changedFiles += 1;
    totalHits += hits;
    console.log(`${path.relative(ROOT, file)}: ${hits}`);
  }
}

console.log(`\nUpdated ${changedFiles} files (${totalHits} replacements). Skipped GameScreen.tsx.`);
