import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, process.cwd(), '');
    const supabaseUrl = env.VITE_SUPABASE_URL || 'http://127.0.0.1:55421';
    const apiUrl = env.VITE_API_URL || 'http://localhost:3001';

    const securityHeaders = {
      'Content-Security-Policy': [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline'",
        "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
        `connect-src 'self' ${supabaseUrl} ${apiUrl} https://*.supabase.co wss://*.supabase.co https://unpkg.com`,
        "img-src 'self' data: blob: https:",
        "font-src 'self' data: https://cdn.jsdelivr.net",
        "frame-ancestors 'none'",
        "base-uri 'self'",
        "form-action 'self'",
      ].join('; '),
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
    };

    return {
      server: {
        port: 5173,
        host: '0.0.0.0',
        headers: securityHeaders,
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
