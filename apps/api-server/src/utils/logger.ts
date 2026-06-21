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

export const stream = {
  write: (message: string) => {
    logger.http(message.trim());
  },
};

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
