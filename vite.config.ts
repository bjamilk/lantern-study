import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { buildContentSecurityPolicy } from './scripts/buildContentSecurityPolicy.mjs';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, process.cwd(), '');

    const securityHeaders = {
      'Content-Security-Policy': buildContentSecurityPolicy(env),
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
    };

    return {
      server: {
        port: 5173,
        host: '0.0.0.0',
        headers: securityHeaders,
        // Same-origin API proxy for laptop + phone (LAN) access during local Vite.
        proxy: {
          '/__lantern_api': {
            target: env.LANTERN_API_PROXY_TARGET || 'https://lantern-study-api.onrender.com',
            changeOrigin: true,
            secure: true,
            rewrite: (p) => p.replace(/^\/__lantern_api/, ''),
          },
        },
      },
      preview: {
        headers: securityHeaders,
      },
      plugins: [react()],
      optimizeDeps: {
        include: ['matter-js'],
        exclude: ['react-native'],
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
          'react-native': path.resolve(__dirname, 'apps/web/src/stubs/react-native.ts'),
          'react': path.resolve(__dirname, 'node_modules/react'),
          'react-dom': path.resolve(__dirname, 'node_modules/react-dom'),
          'react/jsx-runtime': path.resolve(__dirname, 'node_modules/react/jsx-runtime.js'),
          'react/jsx-dev-runtime': path.resolve(__dirname, 'node_modules/react/jsx-dev-runtime.js'),
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
