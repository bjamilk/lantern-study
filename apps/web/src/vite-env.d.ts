/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_AUTH_COOKIE_MODE?: string;
  readonly VITE_SENTRY_DSN?: string;
  readonly VITE_SENTRY_RELEASE?: string;
  readonly VITE_SENTRY_TRACES_SAMPLE_RATE?: string;
  readonly VITE_API_URL?: string;
  readonly MODE: string;
  readonly PROD: boolean;
  readonly DEV: boolean;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
