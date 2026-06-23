import fs from 'fs';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const swPath = path.resolve(rootDir, 'dist/sw.js');

if (!fs.existsSync(swPath)) {
  console.warn('[inject-sw-build-id] dist/sw.js not found, skipping');
  process.exit(0);
}

const buildId = `${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;
const content = fs.readFileSync(swPath, 'utf8').replace(/__BUILD_ID__/g, buildId);
fs.writeFileSync(swPath, content);
console.log(`[inject-sw-build-id] CACHE_NAME -> lantern-${buildId}`);
