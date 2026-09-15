/**
 * Vite + Vitest config for the web app (`@lantern/web`).
 *
 * The package lives in apps/web but the app's source does NOT: `root` is the
 * REPO ROOT, so App.tsx, components/, hooks/, stores/, services/ and index.html
 * are the real inputs and every path in this file that is "relative to root" is
 * relative to the repo root, not to apps/web.
 *
 * Exports: the default Vite config factory (receives `mode`; currently unused
 * beyond the signature).
 * Touches: dev-server port/proxy (`/__lantern_api` → Render API), the
 * react-native → `apps/web/src/stubs/react-native.ts` alias that lets shared
 * cross-platform modules import from 'react-native' in a browser build, build
 * output at apps/web/dist, and the vitest `include` list.
 *
 * Gotchas:
 *  - Build/deploy gate: `npm run build` for this package is `tsc && vite build`.
 *    A strict-tsc failure fails the whole build, and deploying apps/web/dist
 *    afterwards ships the PREVIOUS dist while reporting success — always check
 *    the build printed `✓ built in …` with fresh index-*.js hashes.
 *  - Root `npx tsc --noEmit` is a false gate for this app (thousands of
 *    pre-existing errors from other workspaces); this build is the real one.
 *  - Turbo hashes this package's inputs; the root sources above are only seen
 *    because apps/web/turbo.json lists them explicitly. See docs/web-build.md.
 */
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Root directory where actual web app source lives
const rootDir = path.resolve(__dirname, '../..');

/**
 * `lantern-study-web@<version>+<commit>` — the web twin of the `/health`
 * commit marker (apps/api-server/src/routes/health.ts), which reads
 * RENDER_GIT_COMMIT / GIT_COMMIT / SOURCE_VERSION. Web builds run on
 * Cloudflare Pages (CF_PAGES_COMMIT_SHA) or a laptop (git), so all four are
 * tried before falling back to 'unknown'.
 *
 * Without this every web Sentry event arrived with NO release, so a report
 * could not be told apart from a stale bundle the service worker was still
 * serving — and web deploys here are manual/CI-raced.
 */
function resolveWebRelease(): string {
  const version = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8')
  ).version as string;
  let commit =
    process.env.CF_PAGES_COMMIT_SHA ||
    process.env.RENDER_GIT_COMMIT ||
    process.env.GIT_COMMIT ||
    process.env.SOURCE_VERSION ||
    '';
  if (!commit) {
    try {
      commit = execSync('git rev-parse HEAD', { cwd: rootDir, stdio: ['ignore', 'pipe', 'ignore'] })
        .toString()
        .trim();
    } catch {
      commit = '';
    }
  }
  return `lantern-study-web@${version}+${commit.slice(0, 7) || 'unknown'}`;
}

/**
 * Self-host pdf.js standard fonts and CMaps.
 *
 * FIXED (SW) [Sentry WEB-1P / WEB-1N]: NotePdfViewer pointed pdf.js at
 * `unpkg.com/pdfjs-dist@<v>/standard_fonts/`, which font-src blocks — every
 * PDF with a non-embedded base-14 font rendered with the wrong glyphs and
 * filed a CSP violation. Serving them from our own origin fixes the rendering
 * AND removes a third-party CDN from the note-reading path (unpkg going down
 * or being MITM'd would otherwise change what a student reads). 2.4 MB of
 * static files, copied at build time rather than committed.
 */
function pdfjsAssets() {
  const from = path.join(rootDir, 'node_modules/pdfjs-dist');
  const dirs = ['standard_fonts', 'cmaps'];
  return {
    name: 'lantern-pdfjs-assets',
    // Dev: serve them straight out of node_modules at the same URL the build
    // emits, so /notes/<id> behaves identically in dev and production.
    configureServer(server: any) {
      server.middlewares.use((req: any, res: any, next: any) => {
        const match = /^\/pdfjs\/(standard_fonts|cmaps)\/([\w.-]+)$/.exec((req.url || '').split('?')[0]);
        if (!match) return next();
        const file = path.join(from, match[1], match[2]);
        if (!fs.existsSync(file)) return next();
        res.setHeader('Content-Type', 'application/octet-stream');
        fs.createReadStream(file).pipe(res);
      });
    },
    closeBundle() {
      // vitest fires closeBundle too; copying 2.4 MB on every test run is not
      // what this plugin is for.
      if (process.env.VITEST) return;
      for (const dir of dirs) {
        const src = path.join(from, dir);
        if (!fs.existsSync(src)) {
          console.warn(`[pdfjs-assets] ${src} missing — PDFs will fall back to blank glyphs`);
          continue;
        }
        const dest = path.join(rootDir, 'apps/web/dist/pdfjs', dir);
        fs.mkdirSync(dest, { recursive: true });
        for (const entry of fs.readdirSync(src)) {
          fs.copyFileSync(path.join(src, entry), path.join(dest, entry));
        }
      }
      console.log('[pdfjs-assets] copied standard_fonts + cmaps into dist/pdfjs');
    },
  };
}

export default defineConfig(({ mode }) => {
    return {
      root: rootDir,
      server: {
        // PORT lets a launcher assign a free port when 5173 is taken;
        // nothing binds to 5173 specifically (the API proxy is same-origin).
        port: Number(process.env.PORT) || 5173,
        host: '0.0.0.0',
        // Same-origin proxy so phones on LAN (not localhost) can reach the API.
        // Prefer VITE_API_URL=/__lantern_api (relative) — never hardcode localhost:5173.
        proxy: {
          '/__lantern_api': {
            target: process.env.LANTERN_API_PROXY_TARGET || 'https://lantern-study-api.onrender.com',
            changeOrigin: true,
            secure: true,
            rewrite: (p) => p.replace(/^\/__lantern_api/, ''),
            // changeOrigin rewrites Host but leaves the browser's Origin header
            // as http://localhost:5173, which the production CORS list rejects —
            // and the rejection surfaced as a 500 on every POST/PUT while GETs
            // sailed through, which reads exactly like a broken API. Dropping
            // Origin makes this a server-to-server call, which isOriginAllowed
            // permits, so writes are testable locally.
            configure: (proxy) => {
              proxy.on('proxyReq', (proxyReq) => {
                proxyReq.removeHeader('origin');
              });
            },
          },
        },
      },
      define: {
        // Stamped into every Sentry event (services/sentry.ts).
        __APP_RELEASE__: JSON.stringify(resolveWebRelease()),
      },
      plugins: [
        react({ fastRefresh: false }),
        pdfjsAssets(),
        {
          name: 'favicon-fallback',
          configureServer(server) {
            server.middlewares.use((req, _res, next) => {
              if (req.url === '/favicon.ico') req.url = '/lantern-icon-v2.png';
              next();
            });
          },
        },
      ],
      optimizeDeps: {
        entries: [path.resolve(rootDir, 'index.html')],
        include: ['matter-js'],
        exclude: ['react-native'],
      },
      resolve: {
        alias: {
          '@': rootDir,
          '@shared': path.resolve(__dirname, '../../packages/shared/src'),
          'react-native': path.resolve(__dirname, 'src/stubs/react-native.ts'),
          'react': path.resolve(rootDir, 'node_modules/react'),
          'react-dom': path.resolve(rootDir, 'node_modules/react-dom'),
          'react/jsx-runtime': path.resolve(rootDir, 'node_modules/react/jsx-runtime.js'),
          'react/jsx-dev-runtime': path.resolve(rootDir, 'node_modules/react/jsx-dev-runtime.js'),
        },
        dedupe: ['react', 'react-dom', 'zustand', 'react/jsx-runtime', 'react/jsx-dev-runtime'],
      },
      build: {
        // Write into apps/web/dist (path is relative to `root`, the repo root).
        // Turbo's outputs: ["dist/**"] resolves relative to apps/web, so without
        // this the cache captured NOTHING and a warm cache hit "succeeded" while
        // restoring no artifacts — a stale-deploy trap.
        outDir: 'apps/web/dist',
        emptyOutDir: true,
        rollupOptions: {
          output: {
            manualChunks: {
              'vendor-react': ['react', 'react-dom'],
              'vendor-supabase': ['@supabase/supabase-js'],
            },
          },
        },
      },
      // Without an explicit include, vitest walks the whole monorepo and collects
      // the api-server's Jest suites too, which then fail with "describe is not
      // defined" because they rely on Jest globals. Scope it to the files that
      // this project owns so `npm test -w @lantern/web` is meaningful.
      // Paths are relative to `root` above, which is the repo root.
      test: {
        // packages/shared runs jest, so its suites use bare `describe`/`it`
        // rather than importing them from vitest. Injecting the globals lets
        // the same files pass under both runners.
        globals: true,
        include: [
          'apps/web/src/**/*.test.{ts,tsx}',
          'components/**/*.test.{ts,tsx}',
          // utils/ was omitted, so utils/xhrHeaders.test.ts had never run.
          'utils/**/*.test.{ts,tsx}',
          // stores/ was omitted, so the confirm store (whose stranded-promise
          // bug permanently disables buttons) had no suite that could run.
          'stores/**/*.test.{ts,tsx}',
          // services/ was omitted too, so the fetch layer — where the raw
          // server sentence leaked out of fetchNoteAttachmentPages — had no
          // suite that could run at all.
          'services/**/*.test.{ts,tsx}',
          'packages/shared/src/learning/**/*.test.ts',
        ],
      },
    };
});
