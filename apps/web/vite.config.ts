import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Root directory where actual web app source lives
const rootDir = path.resolve(__dirname, '../..');

export default defineConfig(() => {
    return {
      root: rootDir,
      server: {
        port: 5173,
        host: '0.0.0.0',
      },
      plugins: [
        react({ fastRefresh: false }),
        {
          name: 'favicon-fallback',
          configureServer(server) {
            server.middlewares.use((req, _res, next) => {
              if (req.url === '/favicon.ico') req.url = '/lantern-icon.png';
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
    };
});
