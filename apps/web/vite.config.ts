import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Root directory where actual web app source lives
const rootDir = path.resolve(__dirname, '../..');

export default defineConfig(({ mode }) => {
    return {
      root: rootDir,
      server: {
        port: 5173,
        host: '0.0.0.0',
        // Same-origin proxy so phones on LAN (not localhost) can reach the API.
        // Prefer VITE_API_URL=/__lantern_api (relative) — never hardcode localhost:5173.
        proxy: {
          '/__lantern_api': {
            target: process.env.LANTERN_API_PROXY_TARGET || 'https://lantern-study-api.onrender.com',
            changeOrigin: true,
            secure: true,
            rewrite: (p) => p.replace(/^\/__lantern_api/, ''),
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
        ],
      },
    };
});
