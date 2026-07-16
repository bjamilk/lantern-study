/**
 * EAS Build pre-install: slim the monorepo install to mobile + shared only.
 * Full-repo `npm ci` OOMs (SIGKILL) on default EAS workers.
 */
const fs = require('fs');
const path = require('path');

if (!process.env.EAS_BUILD) {
  process.exit(0);
}

const root = path.join(__dirname, '..');
const pkgPath = path.join(root, 'package.json');
const slimLockPath = path.join(__dirname, 'package-lock.eas-mobile.json');
const lockPath = path.join(root, 'package-lock.json');

const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
pkg.workspaces = ['apps/mobile', 'packages/*'];
// Drop root web-only deps so install stays light even if lockfile drifts.
pkg.dependencies = {};
pkg.devDependencies = { typescript: pkg.devDependencies?.typescript || '~5.8.2' };
fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);

if (!fs.existsSync(slimLockPath)) {
  console.error('[eas-prepare-mobile-install] Missing scripts/package-lock.eas-mobile.json');
  process.exit(1);
}
fs.copyFileSync(slimLockPath, lockPath);
console.log('[eas-prepare-mobile-install] Using mobile+shared workspaces and slim lockfile');
