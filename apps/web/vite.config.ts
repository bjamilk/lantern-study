import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Root directory where actual web app source lives
const rootDir = path.resolve(__dirname, '../..');

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
      plugins: [
        react({ fastRefresh: false }),
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
      // actually import from vitest so `npm test -w @lantern/web` is meaningful.
      // Paths are relative to `root` above, which is the repo root.
      test: {
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
        ],
      },
    };
});
