import fs from 'fs';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';

const webDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const swPath = path.resolve(webDir, 'dist/sw.js');

if (!fs.existsSync(swPath)) {
  // Hard failure: shipping sw.js with the literal __BUILD_ID__ pins CACHE_NAME
  // forever, so the activate-handler purge never fires again and users stay on
  // a stale index.html across every future deploy.
  console.error('[inject-sw-build-id] FATAL: apps/web/dist/sw.js not found — build did not produce it');
  process.exit(1);
}

const buildId = `${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;
const content = fs.readFileSync(swPath, 'utf8').replace(/__BUILD_ID__/g, buildId);
fs.writeFileSync(swPath, content);
console.log(`[inject-sw-build-id] CACHE_NAME -> lantern-${buildId}`);
