/**
 * EAS Build pre-install: slim the monorepo install to mobile + shared only.
 * Full-repo `npm ci` OOMs (SIGKILL) on default EAS workers.
 *
 * Must be wired on apps/mobile/package.json as `eas-build-pre-install`
 * (EAS runs the app package hook, not the monorepo root).
 */
const fs = require('fs');
const path = require('path');

if (!process.env.EAS_BUILD) {
  process.exit(0);
}

const root = path.join(__dirname, '..');
const pkgPath = path.join(root, 'package.json');
const mobilePkgPath = path.join(root, 'apps', 'mobile', 'package.json');
const slimLockPath = path.join(__dirname, 'package-lock.eas-mobile.json');
const lockPath = path.join(root, 'package-lock.json');

const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
pkg.workspaces = ['apps/mobile', 'packages/*'];
// Drop root web-only deps so install stays light even if lockfile drifts.
pkg.dependencies = {};
pkg.devDependencies = { typescript: pkg.devDependencies?.typescript || '~5.8.2' };
fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
console.log('[eas-prepare-mobile-install] Trimmed root package.json to mobile + packages.');

// Prevent mobile postinstall from re-entering native-deps work during EAS npm ci.
if (fs.existsSync(mobilePkgPath)) {
  const mobilePkg = JSON.parse(fs.readFileSync(mobilePkgPath, 'utf8'));
  if (mobilePkg.scripts?.postinstall) {
    delete mobilePkg.scripts.postinstall;
    fs.writeFileSync(mobilePkgPath, `${JSON.stringify(mobilePkg, null, 2)}\n`);
    console.log('[eas-prepare-mobile-install] Removed apps/mobile postinstall (prevents EAS install recursion).');
  }
}

if (!fs.existsSync(slimLockPath)) {
  console.error('[eas-prepare-mobile-install] Missing scripts/package-lock.eas-mobile.json');
  process.exit(1);
}
fs.copyFileSync(slimLockPath, lockPath);
const slimBytes = fs.statSync(slimLockPath).size;
console.log(`[eas-prepare-mobile-install] Installed slim package-lock.json (${slimBytes} bytes) for npm ci`);
console.log('[eas-prepare-mobile-install] Ready for EAS install phase.');
