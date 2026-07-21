#!/usr/bin/env node
/**
 * Phase 3 design-token sweep: replace hardcoded slate/indigo/gray Tailwind
 * classes with lantern-* semantic tokens (CSS variables).
 *
 * Usage: node scripts/migrate-design-tokens.mjs [--check]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const CHECK_ONLY = process.argv.includes('--check');

const TARGET_DIRS = [
  path.join(ROOT, 'components'),
  path.join(ROOT, 'apps', 'mobile', 'src'),
  path.join(ROOT, 'packages', 'shared', 'src'),
  ROOT,
].map((p) => p);

const TARGET_FILES = ['App.tsx', 'index.tsx'].map((f) => path.join(ROOT, f));

/** Ordered replacements — longest / most specific patterns first */
const REPLACEMENTS = [
  // Invalid Tailwind shades (silent no-ops)
  ['dark:bg-slate-750', 'dark:bg-lantern-surface-secondary'],
  ['bg-slate-750', 'bg-lantern-surface-secondary'],
  ['dark:bg-slate-650', 'dark:bg-lantern-background-secondary'],
  ['bg-slate-650', 'bg-lantern-background-secondary'],
  ['dark:bg-slate-350', 'dark:bg-lantern-border'],
  ['bg-slate-350', 'bg-lantern-border'],

  // Paired light/dark backgrounds
  ['bg-slate-50 dark:bg-slate-950', 'bg-lantern-background'],
  ['bg-slate-50 dark:bg-slate-900', 'bg-lantern-background'],
  ['bg-slate-100 dark:bg-slate-950', 'bg-lantern-background'],
  ['bg-slate-100 dark:bg-slate-900', 'bg-lantern-background'],
  ['bg-slate-100 dark:bg-slate-800', 'bg-lantern-background-secondary'],
  ['bg-slate-50 dark:bg-slate-800', 'bg-lantern-background-secondary'],
  ['bg-white dark:bg-slate-900', 'bg-lantern-surface'],
  ['bg-white dark:bg-slate-800', 'bg-lantern-surface'],
  ['bg-slate-200 dark:bg-slate-700', 'bg-lantern-background-secondary'],
  ['bg-slate-200 dark:bg-slate-600', 'bg-lantern-border'],
  ['bg-slate-300 dark:bg-slate-600', 'bg-lantern-border'],
  ['bg-slate-800 dark:bg-slate-900', 'bg-lantern-surface'],
  ['bg-slate-900 dark:bg-slate-950', 'bg-lantern-background'],
  ['dark:bg-slate-900/50', 'dark:bg-lantern-background-secondary/50'],
  ['dark:bg-slate-900/40', 'dark:bg-lantern-background-secondary/40'],
  ['dark:bg-slate-900/30', 'dark:bg-lantern-background-secondary/30'],
  ['dark:bg-slate-800/50', 'dark:bg-lantern-surface-secondary/50'],
  ['dark:bg-slate-700/50', 'dark:bg-lantern-surface-secondary/50'],
  ['bg-slate-900/50', 'bg-lantern-background/50'],

  // Paired text
  ['text-slate-900 dark:text-slate-100', 'text-lantern-text'],
  ['text-slate-900 dark:text-slate-50', 'text-lantern-text'],
  ['text-slate-800 dark:text-slate-200', 'text-lantern-text'],
  ['text-slate-800 dark:text-slate-100', 'text-lantern-text'],
  ['text-slate-700 dark:text-slate-300', 'text-lantern-text'],
  ['text-slate-700 dark:text-slate-200', 'text-lantern-text'],
  ['text-slate-600 dark:text-slate-400', 'text-lantern-text-secondary'],
  ['text-slate-600 dark:text-slate-300', 'text-lantern-text-secondary'],
  ['text-slate-500 dark:text-slate-500', 'text-lantern-text-tertiary'],
  ['text-slate-500 dark:text-slate-400', 'text-lantern-text-secondary'],
  ['text-slate-400 dark:text-slate-500', 'text-lantern-text-tertiary'],
  ['text-slate-400 dark:text-slate-600', 'text-lantern-text-tertiary'],
  ['text-slate-300 dark:text-slate-600', 'text-lantern-text-tertiary'],
  ['text-slate-300 dark:text-slate-500', 'text-lantern-text-tertiary'],

  // Paired borders / rings
  ['border-slate-300 dark:border-slate-600', 'border-lantern-border'],
  ['border-slate-200 dark:border-slate-700', 'border-lantern-border'],
  ['border-slate-200 dark:border-slate-600', 'border-lantern-border'],
  ['border-slate-100 dark:border-slate-700', 'border-lantern-border'],
  ['ring-slate-200/60 dark:ring-slate-700/60', 'ring-lantern-border/60'],
  ['ring-slate-200 dark:ring-slate-700', 'ring-lantern-border'],
  ['ring-1 ring-slate-200 dark:ring-slate-700', 'ring-1 ring-lantern-border'],
  ['divide-slate-200 dark:divide-slate-700', 'divide-lantern-border'],

  // Indigo brand pairs
  ['text-indigo-700 dark:text-indigo-300', 'text-lantern-primary'],
  ['text-indigo-600 dark:text-indigo-400', 'text-lantern-primary'],
  ['text-indigo-600 dark:text-indigo-300', 'text-lantern-primary'],
  ['text-indigo-500 dark:text-indigo-400', 'text-lantern-primary'],
  ['bg-indigo-600 hover:bg-indigo-700', 'bg-lantern-primary hover:bg-lantern-primary-dark'],
  ['bg-blue-600 hover:bg-blue-700', 'bg-lantern-primary hover:bg-lantern-primary-dark'],
  ['bg-purple-600 hover:bg-purple-700', 'bg-lantern-primary hover:bg-lantern-primary-dark'],
  ['bg-blue-600', 'bg-lantern-primary'],
  ['bg-purple-600', 'bg-lantern-primary'],
  ['bg-indigo-600 dark:bg-indigo-500', 'bg-lantern-primary'],
  ['bg-indigo-700 hover:bg-indigo-800', 'bg-lantern-primary-dark hover:bg-lantern-primary-dark'],
  ['hover:bg-indigo-700 dark:hover:bg-indigo-600', 'hover:bg-lantern-primary-dark'],
  ['hover:bg-indigo-50 dark:hover:bg-slate-700', 'hover:bg-lantern-primary-background'],
  ['hover:bg-indigo-50 dark:hover:bg-indigo-900/20', 'hover:bg-lantern-primary-background'],
  ['bg-indigo-50 dark:bg-indigo-900/30', 'bg-lantern-primary-background'],
  ['bg-indigo-50 dark:bg-indigo-950/40', 'bg-lantern-primary-background'],
  ['bg-indigo-50 dark:bg-indigo-900/20', 'bg-lantern-primary-background'],
  ['hover:text-indigo-600 dark:hover:text-indigo-400', 'hover:text-lantern-primary'],
  ['hover:text-indigo-700 dark:hover:text-indigo-300', 'hover:text-lantern-primary'],
  ['border-indigo-600 dark:border-indigo-400', 'border-lantern-primary'],
  ['border-indigo-500 dark:border-indigo-400', 'border-lantern-primary'],
  ['ring-indigo-300/60', 'ring-lantern-primary/30'],
  ['hover:ring-indigo-300/60', 'hover:ring-lantern-primary/30'],

  // Gray pairs
  ['text-gray-900 dark:text-gray-100', 'text-lantern-text'],
  ['text-gray-800 dark:text-gray-200', 'text-lantern-text'],
  ['text-gray-700 dark:text-gray-300', 'text-lantern-text'],
  ['text-gray-600 dark:text-gray-400', 'text-lantern-text-secondary'],
  ['text-gray-500 dark:text-gray-400', 'text-lantern-text-secondary'],
  ['text-gray-400 dark:text-gray-500', 'text-lantern-text-tertiary'],
  ['bg-gray-50 dark:bg-gray-900', 'bg-lantern-background'],
  ['bg-gray-100 dark:bg-gray-800', 'bg-lantern-background-secondary'],
  ['bg-gray-50 dark:bg-gray-800', 'bg-lantern-background-secondary'],
  ['border-gray-300 dark:border-gray-600', 'border-lantern-border'],
  ['border-gray-200 dark:border-gray-700', 'border-lantern-border'],

  // Hover / focus singles with dark variants
  ['hover:bg-slate-100 dark:hover:bg-slate-700', 'hover:bg-lantern-background-secondary'],
  ['hover:bg-slate-100 dark:hover:bg-slate-800', 'hover:bg-lantern-background-secondary'],
  ['hover:bg-slate-50 dark:hover:bg-slate-800', 'hover:bg-lantern-background-secondary'],
  ['hover:bg-slate-200 dark:hover:bg-slate-600', 'hover:bg-lantern-border'],
  ['hover:text-slate-800 dark:hover:text-slate-200', 'hover:text-lantern-text'],
  ['hover:text-slate-700 dark:hover:text-slate-300', 'hover:text-lantern-text'],
  ['hover:border-slate-300 dark:hover:border-slate-600', 'hover:border-lantern-border'],

  // Unpaired slate backgrounds
  ['bg-slate-950', 'bg-lantern-background'],
  ['bg-slate-900', 'bg-lantern-background'],
  ['bg-slate-800', 'bg-lantern-surface'],
  ['bg-slate-700', 'bg-lantern-surface-secondary'],
  ['bg-slate-600', 'bg-lantern-border'],
  ['bg-slate-500', 'bg-lantern-border'],
  ['bg-slate-400', 'bg-lantern-border'],
  ['bg-slate-300', 'bg-lantern-border'],
  ['bg-slate-200', 'bg-lantern-background-secondary'],
  ['bg-slate-100', 'bg-lantern-background-secondary'],
  ['bg-slate-50', 'bg-lantern-background'],

  // Unpaired slate text
  ['text-slate-950', 'text-lantern-text'],
  ['text-slate-900', 'text-lantern-text'],
  ['text-slate-800', 'text-lantern-text'],
  ['text-slate-700', 'text-lantern-text'],
  ['text-slate-600', 'text-lantern-text-secondary'],
  ['text-slate-500', 'text-lantern-text-secondary'],
  ['text-slate-400', 'text-lantern-text-tertiary'],
  ['text-slate-300', 'text-lantern-text-tertiary'],

  // Unpaired slate borders
  ['border-slate-900', 'border-lantern-border'],
  ['border-slate-800', 'border-lantern-border'],
  ['border-slate-700', 'border-lantern-border'],
  ['border-slate-600', 'border-lantern-border'],
  ['border-slate-500', 'border-lantern-border'],
  ['border-slate-400', 'border-lantern-border'],
  ['border-slate-300', 'border-lantern-border'],
  ['border-slate-200', 'border-lantern-border'],
  ['border-slate-100', 'border-lantern-border'],

  // Unpaired indigo
  ['bg-indigo-900', 'bg-lantern-primary-dark'],
  ['bg-indigo-800', 'bg-lantern-primary-dark'],
  ['bg-indigo-700', 'bg-lantern-primary-dark'],
  ['bg-indigo-600', 'bg-lantern-primary'],
  ['bg-indigo-500', 'bg-lantern-primary'],
  ['bg-indigo-100', 'bg-lantern-primary-background'],
  ['bg-indigo-50', 'bg-lantern-primary-background'],
  ['text-indigo-900', 'text-lantern-primary-dark'],
  ['text-indigo-800', 'text-lantern-primary-dark'],
  ['text-indigo-700', 'text-lantern-primary'],
  ['text-indigo-600', 'text-lantern-primary'],
  ['text-indigo-500', 'text-lantern-primary'],
  ['text-indigo-400', 'text-lantern-primary-light'],
  ['border-indigo-600', 'border-lantern-primary'],
  ['border-indigo-500', 'border-lantern-primary'],
  ['border-indigo-400', 'border-lantern-primary'],
  ['hover:bg-indigo-800', 'hover:bg-lantern-primary-dark'],
  ['hover:bg-indigo-700', 'hover:bg-lantern-primary-dark'],
  ['hover:bg-indigo-600', 'hover:bg-lantern-primary'],
  ['hover:bg-indigo-50', 'hover:bg-lantern-primary-background'],
  ['hover:text-indigo-800', 'hover:text-lantern-primary-dark'],
  ['hover:text-indigo-700', 'hover:text-lantern-primary'],
  ['hover:text-indigo-600', 'hover:text-lantern-primary'],
  ['focus:ring-indigo-500', 'focus:ring-lantern-primary'],
  ['focus:ring-indigo-600', 'focus:ring-lantern-primary'],
  ['focus:border-indigo-500', 'focus:border-lantern-primary'],
  ['focus:border-indigo-600', 'focus:border-lantern-primary'],
  ['ring-indigo-600', 'ring-lantern-primary'],
  ['ring-indigo-500', 'ring-lantern-primary'],
  ['border-t-indigo-600', 'border-t-lantern-primary'],
  ['border-indigo-200', 'border-lantern-primary/30'],
  ['border-indigo-100', 'border-lantern-primary/20'],

  // Unpaired gray
  ['bg-gray-950', 'bg-lantern-background'],
  ['bg-gray-900', 'bg-lantern-background'],
  ['bg-gray-800', 'bg-lantern-surface'],
  ['bg-gray-700', 'bg-lantern-surface-secondary'],
  ['bg-gray-600', 'bg-lantern-border'],
  ['bg-gray-500', 'bg-lantern-border'],
  ['bg-gray-400', 'bg-lantern-border'],
  ['bg-gray-300', 'bg-lantern-border'],
  ['bg-gray-200', 'bg-lantern-background-secondary'],
  ['bg-gray-100', 'bg-lantern-background-secondary'],
  ['bg-gray-50', 'bg-lantern-background'],
  ['text-gray-950', 'text-lantern-text'],
  ['text-gray-900', 'text-lantern-text'],
  ['text-gray-800', 'text-lantern-text'],
  ['text-gray-700', 'text-lantern-text'],
  ['text-gray-600', 'text-lantern-text-secondary'],
  ['text-gray-500', 'text-lantern-text-secondary'],
  ['text-gray-400', 'text-lantern-text-tertiary'],
  ['text-gray-300', 'text-lantern-text-tertiary'],
  ['border-gray-900', 'border-lantern-border'],
  ['border-gray-800', 'border-lantern-border'],
  ['border-gray-700', 'border-lantern-border'],
  ['border-gray-600', 'border-lantern-border'],
  ['border-gray-500', 'border-lantern-border'],
  ['border-gray-400', 'border-lantern-border'],
  ['border-gray-300', 'border-lantern-border'],
  ['border-gray-200', 'border-lantern-border'],
  ['border-gray-100', 'border-lantern-border'],
  ['hover:bg-gray-100', 'hover:bg-lantern-background-secondary'],
  ['hover:bg-gray-50', 'hover:bg-lantern-background-secondary'],
  ['hover:text-gray-900', 'hover:text-lantern-text'],
  ['hover:text-gray-700', 'hover:text-lantern-text'],
  ['hover:text-gray-600', 'hover:text-lantern-text-secondary'],
  ['focus:ring-blue-500', 'focus:ring-lantern-primary'],
  ['focus:ring-blue-600', 'focus:ring-lantern-primary'],
  ['focus:border-blue-500', 'focus:border-lantern-primary'],
  ['text-blue-600', 'text-lantern-primary'],
  ['text-blue-500', 'text-lantern-primary'],

  // bg-white standalone (after pairs)
  ['bg-white', 'bg-lantern-surface'],

  // Dark: prefixed leftovers (tokens handle dark mode)
  ['dark:bg-slate-950', 'dark:bg-lantern-background'],
  ['dark:bg-slate-900', 'dark:bg-lantern-background'],
  ['dark:bg-slate-800', 'dark:bg-lantern-surface'],
  ['dark:bg-slate-700', 'dark:bg-lantern-surface-secondary'],
  ['dark:bg-slate-600', 'dark:bg-lantern-border'],
  ['dark:text-slate-100', 'dark:text-lantern-text'],
  ['dark:text-slate-200', 'dark:text-lantern-text'],
  ['dark:text-slate-300', 'dark:text-lantern-text-secondary'],
  ['dark:text-slate-400', 'dark:text-lantern-text-secondary'],
  ['dark:text-slate-500', 'dark:text-lantern-text-tertiary'],
  ['dark:text-slate-600', 'dark:text-lantern-text-tertiary'],
  ['dark:border-slate-700', 'dark:border-lantern-border'],
  ['dark:border-slate-600', 'dark:border-lantern-border'],
  ['dark:hover:bg-slate-700', 'dark:hover:bg-lantern-surface-secondary'],
  ['dark:hover:bg-slate-800', 'dark:hover:bg-lantern-surface-secondary'],
  ['dark:hover:text-indigo-400', 'dark:hover:text-lantern-primary'],
  ['dark:text-indigo-400', 'dark:text-lantern-primary'],
  ['dark:bg-indigo-900/30', 'dark:bg-lantern-primary-background'],
  ['dark:bg-indigo-950/40', 'dark:bg-lantern-primary-background'],
  ['dark:bg-gray-900', 'dark:bg-lantern-background'],
  ['dark:bg-gray-800', 'dark:bg-lantern-surface'],
  ['dark:text-gray-100', 'dark:text-lantern-text'],
  ['dark:text-gray-300', 'dark:text-lantern-text-secondary'],
  ['dark:text-gray-400', 'dark:text-lantern-text-secondary'],
  ['dark:border-gray-700', 'dark:border-lantern-border'],
  ['dark:border-gray-600', 'dark:border-lantern-border'],

  // Pass 2 — leftovers from first sweep
  ['placeholder-slate-500 dark:placeholder-slate-400', 'placeholder:text-lantern-text-tertiary'],
  ['placeholder-slate-400', 'placeholder:text-lantern-text-tertiary'],
  ['placeholder-slate-500', 'placeholder:text-lantern-text-tertiary'],
  ['dark:text-indigo-300', 'dark:text-lantern-primary-light'],
  ['dark:text-indigo-200', 'dark:text-lantern-primary-light'],
  ['dark:text-indigo-100', 'dark:text-lantern-primary-light'],
  ['dark:bg-indigo-950/30', 'dark:bg-lantern-primary-background'],
  ['dark:bg-indigo-950/40', 'dark:bg-lantern-primary-background'],
  ['dark:border-indigo-900/40', 'dark:border-lantern-primary/30'],
  ['dark:border-indigo-900', 'dark:border-lantern-primary/30'],
  ['dark:border-indigo-800', 'dark:border-lantern-primary/30'],
  ['dark:hover:border-indigo-800', 'dark:hover:border-lantern-primary/30'],
  ['ring-indigo-200 dark:ring-indigo-700/50', 'ring-lantern-primary/20 dark:ring-lantern-primary/30'],
  ['ring-indigo-200 dark:ring-indigo-700', 'ring-lantern-primary/20 dark:ring-lantern-primary/30'],
  ['focus-visible:ring-indigo-400', 'focus-visible:ring-lantern-primary'],
  ['disabled:bg-indigo-300', 'disabled:bg-lantern-primary/50'],
  ['disabled:bg-indigo-400', 'disabled:bg-lantern-primary/50'],
  ['hover:border-indigo-300', 'hover:border-lantern-primary/30'],
  ['dark:hover:text-slate-200', 'dark:hover:text-lantern-text'],
  ['text-slate-100', 'text-lantern-text'],
  ['text-slate-200', 'text-lantern-text-secondary'],
  ['dark:text-gray-200', 'dark:text-lantern-text'],
  ['dark:hover:text-gray-200', 'dark:hover:text-lantern-text'],
  ['divide-gray-200 dark:divide-gray-700', 'divide-lantern-border'],
  ['divide-y divide-gray-200 dark:divide-gray-700', 'divide-y divide-lantern-border'],
  ['dark:ring-slate-700', 'dark:ring-lantern-border'],
  ['ring-white dark:ring-slate-700', 'ring-lantern-surface dark:ring-lantern-border'],
  ['dark:ring-offset-slate-900', 'dark:ring-offset-lantern-background'],
  ['dark:focus:ring-offset-gray-800', 'dark:focus:ring-offset-lantern-surface'],
  ['hover:ring-slate-300 dark:hover:ring-slate-600', 'hover:ring-lantern-border'],
  ['text-indigo-300', 'text-lantern-primary-light'],
  ['text-indigo-200', 'text-lantern-primary-light'],
  ['text-indigo-100', 'text-lantern-primary-light'],
  ['border-indigo-300', 'border-lantern-primary/30'],
  ['border-blue-300 dark:border-blue-600', 'border-lantern-primary/30'],
  ['border-blue-300', 'border-lantern-primary/30'],
  ['dark:border-blue-600', 'dark:border-lantern-primary/30'],
  ['from-indigo-600', 'from-lantern-primary'],
  ['to-indigo-600', 'to-lantern-primary'],
  ['via-indigo-500', 'via-lantern-primary'],
  ['bg-indigo-950/30', 'bg-lantern-primary-background'],
  ['dark:bg-indigo-900/20', 'dark:bg-lantern-primary-background'],
  ['dark:hover:bg-indigo-900/20', 'dark:hover:bg-lantern-primary-background'],
  ['isDark ? \'text-gray-100\'', 'isDark ? \'text-lantern-text\''],
  ['isDark ? \'bg-lantern-background text-slate-100\'', 'isDark ? \'bg-lantern-background text-lantern-text\''],
  ['isDark ? \'border-lantern-border bg-lantern-surface hover:border-lantern-primary\' : \'border-lantern-border bg-lantern-surface hover:border-indigo-300\'', 'isDark ? \'border-lantern-border bg-lantern-surface hover:border-lantern-primary\' : \'border-lantern-border bg-lantern-surface hover:border-lantern-primary/30\''],

  // Pass 3 — placeholders, focus rings, gradients, conditional grays
  ['placeholder-gray-500 dark:placeholder-gray-400', 'placeholder:text-lantern-text-tertiary'],
  ['placeholder-gray-400 dark:placeholder-gray-500', 'placeholder:text-lantern-text-tertiary'],
  ['placeholder-gray-400', 'placeholder:text-lantern-text-tertiary'],
  ['placeholder-gray-500', 'placeholder:text-lantern-text-tertiary'],
  ['focus:ring-indigo-400', 'focus:ring-lantern-primary'],
  ['dark:focus:ring-indigo-400', 'dark:focus:ring-lantern-primary'],
  ['dark:ring-indigo-400', 'dark:ring-lantern-primary'],
  ['ring-indigo-400', 'ring-lantern-primary'],
  ['ring-2 ring-indigo-400', 'ring-2 ring-lantern-primary'],
  ['dark:focus:ring-offset-slate-800', 'dark:focus:ring-offset-lantern-surface'],
  ['dark:ring-slate-800', 'dark:ring-lantern-border'],
  ['ring-white dark:ring-slate-800', 'ring-lantern-surface dark:ring-lantern-border'],
  ['divide-gray-200 dark:divide-slate-700', 'divide-lantern-border'],
  ['divide-y divide-gray-200 dark:divide-slate-700', 'divide-y divide-lantern-border'],
  ['text-gray-200', 'text-lantern-text'],
  ['text-gray-100', 'text-lantern-text'],
  ['dark:hover:text-gray-100', 'dark:hover:text-lantern-text'],
  ['focus:ring-gray-400', 'focus:ring-lantern-border'],
  ['dark:focus:ring-gray-500', 'dark:focus:ring-lantern-border'],
  ['via-indigo-700', 'via-lantern-primary-dark'],
  ['from-indigo-50', 'from-lantern-primary-background'],
  ['from-indigo-400', 'from-lantern-primary-light'],
  ['dark:from-indigo-900/20', 'dark:from-lantern-primary-background'],
  ['ring-indigo-200/60 dark:ring-indigo-700/40', 'ring-lantern-primary/20 dark:ring-lantern-primary/30'],
  ['hover:ring-indigo-300', 'hover:ring-lantern-primary/30'],
  ['dark:bg-indigo-950', 'dark:bg-lantern-primary-background'],
  ['border-indigo-800/50', 'border-lantern-primary/30'],
  ['dark:border-indigo-700', 'dark:border-lantern-primary/30'],
  ['to-slate-100 dark:to-slate-900', 'to-lantern-background'],
  ['dark:to-slate-900', 'dark:to-lantern-background'],
  ['from-blue-50 to-slate-100 dark:from-blue-950/30 dark:to-slate-900', 'from-lantern-primary-background to-lantern-background dark:from-lantern-primary-background dark:to-lantern-background'],
  ['from-purple-50 to-slate-100 dark:from-purple-950/30 dark:to-slate-900', 'from-lantern-primary-background to-lantern-background dark:from-lantern-primary-background dark:to-lantern-background'],
  ['isDark ? \'text-gray-200\'', 'isDark ? \'text-lantern-text\''],
  ['isDark ? \'bg-lantern-surface border-lantern-border text-gray-100\'', 'isDark ? \'bg-lantern-surface border-lantern-border text-lantern-text\''],
  ['isDark ? \'bg-lantern-surface-secondary border-lantern-border text-gray-100\'', 'isDark ? \'bg-lantern-surface-secondary border-lantern-border text-lantern-text\''],
  ['isDark ? \'bg-lantern-surface-secondary text-gray-100\'', 'isDark ? \'bg-lantern-surface-secondary text-lantern-text\''],
  ['? \'border-lantern-border text-gray-200\'', '? \'border-lantern-border text-lantern-text-secondary\''],
];

function walkDir(dir, files = []) {
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      walkDir(full, files);
    } else if (/\.(tsx|ts|jsx|js)$/.test(entry.name)) {
      files.push(full);
    }
  }
  return files;
}

function collectFiles() {
  const files = new Set();
  for (const dir of TARGET_DIRS) {
    if (dir === ROOT) continue;
    walkDir(dir).forEach((f) => files.add(f));
  }
  TARGET_FILES.forEach((f) => {
    if (fs.existsSync(f)) files.add(f);
  });
  return [...files];
}

function migrateContent(content) {
  let next = content;
  let total = 0;
  for (const [from, to] of REPLACEMENTS) {
    const pattern = new RegExp(from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
    const matches = next.match(pattern);
    if (!matches?.length) continue;
    next = next.replace(pattern, to);
    total += matches.length;
  }
  return { content: next, replacements: total };
}

const FORBIDDEN_PATTERNS = [
  { label: 'background0 corruption', regex: /lantern-background0|background0/ },
  { label: 'broken translate token', regex: /translate-lantern-/ },
];

function scanForbiddenPatterns(files) {
  const hits = [];
  for (const file of files) {
    const content = fs.readFileSync(file, 'utf8');
    for (const { label, regex } of FORBIDDEN_PATTERNS) {
      if (regex.test(content)) {
        hits.push({ file: path.relative(ROOT, file), label });
      }
    }
  }
  return hits;
}

function main() {
  const files = collectFiles();
  let changedFiles = 0;
  let totalReplacements = 0;
  const remaining = [];

  for (const file of files) {
    const original = fs.readFileSync(file, 'utf8');
    if (!/(?:^|[^a-zA-Z])(slate|indigo|gray)-/.test(original)) continue;

    const { content, replacements } = migrateContent(original);
    if (replacements === 0) {
      if (/(?:^|[^a-zA-Z])(slate|indigo|gray)-/.test(original)) {
        remaining.push(path.relative(ROOT, file));
      }
      continue;
    }

    changedFiles += 1;
    totalReplacements += replacements;

    if (!CHECK_ONLY) {
      fs.writeFileSync(file, content, 'utf8');
    }

    const stillHas = /(?:^|[^a-zA-Z])(slate|indigo|gray)-/.test(content);
    if (stillHas) remaining.push(path.relative(ROOT, file));
  }

  console.log(
    CHECK_ONLY
      ? `[check] Would update ${changedFiles} files (${totalReplacements} replacements)`
      : `Updated ${changedFiles} files (${totalReplacements} replacements)`
  );

  if (remaining.length > 0) {
    console.log(`\n${remaining.length} files still contain slate/indigo/gray classes:`);
    remaining.slice(0, 40).forEach((f) => console.log(`  - ${f}`));
    if (remaining.length > 40) console.log(`  ... and ${remaining.length - 40} more`);
  }

  const forbidden = scanForbiddenPatterns(files);
  if (forbidden.length > 0) {
    console.error(`\nForbidden token patterns detected (${forbidden.length}):`);
    forbidden.slice(0, 20).forEach((hit) => console.error(`  - ${hit.file}: ${hit.label}`));
    if (CHECK_ONLY) process.exit(1);
  }
}

main();
