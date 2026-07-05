import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  buildContentSecurityPolicy,
  loadWebBuildEnv,
} from '../../../scripts/buildContentSecurityPolicy.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const headersPath = path.resolve(rootDir, 'dist/_headers');

if (!fs.existsSync(headersPath)) {
  console.warn('[inject-csp-headers] dist/_headers not found, skipping');
  process.exit(0);
}

const env = loadWebBuildEnv(rootDir, fs, path);
const csp = buildContentSecurityPolicy(env);
let content = fs.readFileSync(headersPath, 'utf8');

if (content.includes('__CONTENT_SECURITY_POLICY__')) {
  content = content.replaceAll('__CONTENT_SECURITY_POLICY__', csp);
} else {
  content = content.replace(
    /Content-Security-Policy:[^\n]*/g,
    `Content-Security-Policy: ${csp}`,
  );
}

fs.writeFileSync(headersPath, content);
console.log('[inject-csp-headers] Updated dist/_headers CSP');
console.log(`[inject-csp-headers] connect-src includes API: ${env.VITE_API_URL || '(default localhost)'}`);
