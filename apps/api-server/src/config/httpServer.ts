import type { Server } from 'http';
import { logger } from '../utils/logger';

function parseIntEnv(name: string, fallback: number): number {
  const n = parseInt(process.env[name] || '', 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/**
 * Tune Node HTTP server for reverse-proxy deployments (Render, etc.).
 * keepAliveTimeout should exceed the proxy idle timeout so Node doesn't
 * close sockets the proxy still considers open.
 */
export function configureHttpServer(server: Server): void {
  // Render / common proxies often use ~60s idle; keep Node slightly higher.
  const keepAliveTimeout = parseIntEnv('HTTP_KEEP_ALIVE_TIMEOUT_MS', 65_000);
  const headersTimeout = parseIntEnv('HTTP_HEADERS_TIMEOUT_MS', keepAliveTimeout + 1_000);
  const requestTimeout = parseIntEnv('HTTP_REQUEST_TIMEOUT_MS', 0);
  const maxConnections = parseIntEnv('HTTP_MAX_CONNECTIONS', 512);

  server.keepAliveTimeout = keepAliveTimeout;
  server.headersTimeout = Math.max(headersTimeout, keepAliveTimeout + 1_000);

  if (maxConnections > 0) {
    server.maxConnections = maxConnections;
  }

  // Node 18+: per-request socket timeout (0 = disabled; route middleware still applies).
  if (requestTimeout > 0 && 'requestTimeout' in server) {
    (server as Server & { requestTimeout: number }).requestTimeout = requestTimeout;
  }

  logger.info('HTTP server tuned', {
    keepAliveTimeout,
    headersTimeout: server.headersTimeout,
    maxConnections: maxConnections || 'unlimited',
    requestTimeout: requestTimeout || 'disabled',
  });
}
