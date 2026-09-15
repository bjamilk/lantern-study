#!/usr/bin/env node
/**
 * Merge-provenance guard.
 *
 * GitHub offers no pre-receive hook outside Enterprise, so a push straight to
 * main cannot be rejected. What CAN be rejected is that commit reaching
 * production: this script asks GitHub whether the commit being deployed is
 * associated with a merged pull request, and fails the deploy when it is not.
 *
 * It is a tripwire, not a lock — the founder can always open a PR of one — but
 * it is the thing that keeps "everything in production went past CI and a PR"
 * true while the repo is on a plan without branch protection.
 *
 * Escape hatch: a commit whose message contains `[release]` is allowed through
 * without a PR. That exists for the mobile version-bump commits (bump
 * apps/mobile/app.config.ts + the feature registry, tag, ship the APK), which
 * are made directly on main by the release process and would otherwise wedge
 * the web deploy. Use it for nothing else; every use is visible in the deploy
 * log and in `git log --grep='\[release\]'`.
 *
 * Environment:
 *   GITHUB_REPOSITORY  owner/repo          (set by Actions)
 *   GITHUB_SHA         commit to check     (set by Actions)
 *   GH_TOKEN           token with repo read access
 * Overrides for local use: --repo, --sha.
 */

import { execFileSync } from 'node:child_process';

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const repo = arg('repo') || process.env.GITHUB_REPOSITORY;
const sha = arg('sha') || process.env.GITHUB_SHA;
const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;

function fail(message) {
  console.error(`::error::${message}`);
  process.exit(1);
}

if (!repo) fail('GITHUB_REPOSITORY is not set; cannot check merge provenance.');
if (!sha) fail('GITHUB_SHA is not set; cannot check merge provenance.');
if (!token) fail('GH_TOKEN/GITHUB_TOKEN is not set; the provenance check cannot query the API and will not pass by default.');

function gh(endpoint, jq) {
  return execFileSync('gh', ['api', endpoint, '--jq', jq], {
    encoding: 'utf8',
    env: { ...process.env, GH_TOKEN: token },
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

let message = '';
try {
  message = gh(`repos/${repo}/commits/${sha}`, '.commit.message');
} catch (err) {
  fail(`Could not read commit ${sha} from the GitHub API: ${String(err.stderr || err.message).trim()}`);
}

const firstLine = message.split('\n')[0];
console.log(`commit ${sha.slice(0, 8)}: ${firstLine}`);

if (/\[release\]/i.test(message)) {
  console.log('Escape hatch: commit message carries [release]. Allowed without a pull request.');
  console.log('This is reserved for mobile version-bump commits — see docs/PIPELINE.md § The escape hatch.');
  process.exit(0);
}

let pulls = '[]';
try {
  pulls = gh(`repos/${repo}/commits/${sha}/pulls`, '[.[] | {number, state, merged_at, title}]');
} catch (err) {
  fail(`Could not list pull requests for ${sha}: ${String(err.stderr || err.message).trim()}`);
}

let parsed;
try {
  parsed = JSON.parse(pulls);
} catch {
  fail(`Unexpected response listing pull requests for ${sha}: ${pulls}`);
}

const merged = parsed.filter((p) => p.merged_at);

if (merged.length === 0) {
  fail(
    `Commit ${sha.slice(0, 8)} is not associated with a merged pull request, so it never faced review. ` +
      'Revert it and re-land through a PR, or — for a mobile version bump only — include [release] in the commit message. ' +
      'See docs/PIPELINE.md § The escape hatch.',
  );
}

for (const p of merged) {
  console.log(`  via merged PR #${p.number} (${p.merged_at}): ${p.title}`);
}
console.log('Merge provenance OK.');
