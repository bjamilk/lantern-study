/**
 * The API server's Winston logger and its redaction layer.
 *
 * Exports the `logger` instance, the `stream` adapter morgan writes through,
 * the `logError` / `logWarn` / `logInfo` / `logDebug` / `logPerformance`
 * wrappers, and `logRequest` (a development-only request tracer mounted in
 * server.ts). Imported across services, middleware and routes.
 *
 * Every path runs metadata through `redactForLog` from utils/safeError before
 * it reaches a transport, so a caller can log an object without first checking
 * what is inside it.
 *
 * Transports: console always; two rotating-free file transports
 * (`logs/error.log`, `logs/all.log`, created on boot) only outside production,
 * where the platform captures stdout instead.
 */
import winston from 'winston';
import path from 'path';
import { redactForLog } from './safeError';

const levels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  debug: 4,
};

const colors = {
  error: 'red',
  warn: 'yellow',
  info: 'green',
  http: 'magenta',
  debug: 'white',
};

winston.addColors(colors);

// --- Redaction ---
// A Winston format, so redaction happens inside the pipeline and covers calls
// that reach `logger.*` directly, not only the wrappers at the bottom of this
// file. It splits off the fields Winston owns (message, level, timestamp,
// stack) and passes only the caller's metadata to `redactForLog`.
//
// `redactForLog` (utils/safeError.ts) walks up to 4 levels deep and:
//   - replaces values under a sensitive key name — password, token,
//     access_token, refresh_token, authorization, secret, apiKey, api_key,
//     the provider keys, service_role_key, base64Data, audioBase64 — with
//     "[REDACTED]";
//   - truncates any string over 500 characters, which is what keeps a 35 MB
//     base64 upload body out of the log files;
//   - keeps only the first 20 elements of an array, and returns "[truncated]"
//     past depth 4.
// It matches on KEY NAME, not on value shape: a credential logged under an
// unlisted key name is written out in full.
const redactMeta = winston.format((info) => {
  const { message, level, timestamp, stack, ...rest } = info;
  const redactedRest = redactForLog(rest);
  return {
    message,
    level,
    timestamp,
    stack,
    ...(typeof redactedRest === 'object' && redactedRest !== null && !Array.isArray(redactedRest)
      ? (redactedRest as Record<string, unknown>)
      : {}),
  } as winston.Logform.TransformableInfo;
});

const consoleFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss:ms' }),
  redactMeta(),
  winston.format.printf((info) => `${info.timestamp} ${info.level}: ${info.message}`)
);

const fileFormat = winston.format.combine(
  winston.format.timestamp(),
  redactMeta(),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

// --- Transports ---
// File transports are development-only: in production the platform collects
// stdout, and writing to a container filesystem would grow unbounded.
const transports: winston.transport[] = [
  new winston.transports.Console({
    format: consoleFormat,
  }),
];

if (process.env.NODE_ENV !== 'production') {
  transports.push(
    new winston.transports.File({
      filename: path.join(process.cwd(), 'logs', 'error.log'),
      level: 'error',
      format: fileFormat,
    }),
    new winston.transports.File({
      filename: path.join(process.cwd(), 'logs', 'all.log'),
      format: fileFormat,
    })
  );
}

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  levels,
  transports,
});

import fs from 'fs';
if (process.env.NODE_ENV !== 'production') {
  const logsDir = path.join(process.cwd(), 'logs');
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }
}

// --- morgan adapter ---
// server.ts hands morgan this object; its formatted lines land at the `http`
// level, which `LOG_LEVEL=info` suppresses in production.
export const stream = {
  write: (message: string) => {
    logger.http(message.trim());
  },
};

// --- Wrappers ---
// These redact a second time, on top of the `redactMeta` format. The double
// pass is harmless (redaction is idempotent) and keeps the wrappers safe if the
// format is ever reordered out of a transport.
function sanitizeMeta(meta?: unknown) {
  return meta ? redactForLog(meta) : undefined;
}

export const logError = (message: string, meta?: unknown) => {
  logger.error(message, sanitizeMeta(meta));
};

export const logWarn = (message: string, meta?: unknown) => {
  logger.warn(message, sanitizeMeta(meta));
};

export const logInfo = (message: string, meta?: unknown) => {
  logger.info(message, sanitizeMeta(meta));
};

export const logDebug = (message: string, meta?: unknown) => {
  logger.debug(message, sanitizeMeta(meta));
};

export const logPerformance = (operation: string, startTime: number, meta?: unknown) => {
  const duration = Date.now() - startTime;
  logger.info(`Performance: ${operation} took ${duration}ms`, {
    operation,
    duration,
    ...(typeof sanitizeMeta(meta) === 'object' ? (sanitizeMeta(meta) as object) : {}),
  });
};

// Development-only request tracer. server.ts mounts it alongside morgan when
// NODE_ENV is not production; mounting it in production would double every HTTP
// log line. It logs the raw URL, so query strings are not redacted here.
export const logRequest = (req: any, res: any, next: any) => {
  const start = Date.now();
  const { method, url, ip } = req;

  logger.http(`Started ${method} ${url} from ${ip}`);

  res.on('finish', () => {
    const duration = Date.now() - start;
    const { statusCode } = res;
    logger.http(`Completed ${method} ${url} with ${statusCode} in ${duration}ms`);
  });

  next();
};
