/**
 * npm workspaces hoist react-native-reanimated/worklets to the monorepo root.
 * NativeWind's peer deps can pull worklets 0.7.x, which crashes Expo Go (native 0.5.1).
 * Keep Expo-compatible copies in apps/mobile/node_modules for Metro to pin.
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const mobileRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(mobileRoot, '../..');

function hasVersion(pkgPath, expected) {
  if (!fs.existsSync(pkgPath)) return false;
  return JSON.parse(fs.readFileSync(pkgPath, 'utf8')).version === expected;
}

const workletsPkg = path.join(mobileRoot, 'node_modules/react-native-worklets/package.json');
const reanimatedPkg = path.join(mobileRoot, 'node_modules/react-native-reanimated/package.json');

if (hasVersion(workletsPkg, '0.5.1') && hasVersion(reanimatedPkg, '4.1.7')) {
  process.exit(0);
}

console.log('[mobile] Installing Expo Go-compatible reanimated/worklets in apps/mobile/node_modules...');
execSync(
  'npm install react-native-worklets@0.5.1 react-native-reanimated@4.1.7 -w @lantern/mobile --no-audit --no-fund',
  { cwd: repoRoot, stdio: 'inherit' },
);
