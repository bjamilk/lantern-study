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
      plugins: [react()],
      resolve: {
        alias: {
          '@': rootDir,
          '@shared': path.resolve(__dirname, '../../packages/shared/src'),
        }
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
