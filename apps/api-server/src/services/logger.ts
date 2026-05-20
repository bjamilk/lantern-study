import { Request, Response, NextFunction } from 'express';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: string;
  requestId?: string;
  userId?: string;
  path?: string;
  method?: string;
  statusCode?: number;
  duration?: number;
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
  metadata?: Record<string, any>;
}

class Logger {
  private isDevelopment = process.env.NODE_ENV !== 'production';
  private redactedFields = ['password', 'token', 'authorization', 'cookie', 'secret', 'apiKey'];

  private formatLog(entry: LogEntry): string {
    if (this.isDevelopment) {
      // Pretty print for development
      const color = this.getColor(entry.level);
      const reset = '\x1b[0m';
      const dim = '\x1b[2m';
      const time = new Date().toLocaleTimeString();
      
      let output = `${dim}${time}${reset} ${color}[${entry.level.toUpperCase().padEnd(5)}]${reset} ${entry.message}`;
      
      if (entry.requestId) {
        output += ` ${dim}(${entry.requestId.substring(0, 8)})${reset}`;
      }
      
      if (entry.duration !== undefined) {
        const durationColor = entry.duration > 1000 ? '\x1b[33m' : '\x1b[32m';
        output += ` ${durationColor}${entry.duration}ms${reset}`;
      }
      
      if (entry.statusCode) {
        const statusColor = entry.statusCode >= 500 ? '\x1b[31m' : 
                           entry.statusCode >= 400 ? '\x1b[33m' : '\x1b[32m';
        output += ` ${statusColor}${entry.statusCode}${reset}`;
      }
      
      if (entry.error) {
        output += `\n  ${color}${entry.error.name}: ${entry.error.message}${reset}`;
        if (entry.error.stack && this.isDevelopment) {
          const stackLines = entry.error.stack.split('\n').slice(1, 4);
          output += `\n${dim}${stackLines.join('\n')}${reset}`;
        }
      }
      
      return output;
    }
    
    // JSON for production (structured logging for log aggregators)
    return JSON.stringify(this.redactSensitiveData(entry));
  }

  private redactSensitiveData(obj: any): any {
    if (typeof obj !== 'object' || obj === null) return obj;
    
    const result: any = Array.isArray(obj) ? [] : {};
    
    for (const [key, value] of Object.entries(obj)) {
      if (this.redactedFields.some(field => key.toLowerCase().includes(field))) {
        result[key] = '[REDACTED]';
      } else if (typeof value === 'object') {
        result[key] = this.redactSensitiveData(value);
      } else {
        result[key] = value;
      }
    }
    
    return result;
  }

  private getColor(level: LogLevel): string {
    switch (level) {
      case 'debug': return '\x1b[36m'; // Cyan
      case 'info': return '\x1b[32m';  // Green
      case 'warn': return '\x1b[33m';  // Yellow
      case 'error': return '\x1b[31m'; // Red
      default: return '\x1b[0m';
    }
  }

  private log(level: LogLevel, message: string, metadata?: Record<string, any>) {
    const entry: LogEntry = {
      level,
      message,
      timestamp: new Date().toISOString(),
      ...metadata,
    };

    const output = this.formatLog(entry);

    switch (level) {
      case 'error':
        console.error(output);
        break;
      case 'warn':
        console.warn(output);
        break;
      case 'debug':
        if (this.isDevelopment || process.env.LOG_LEVEL === 'debug') {
          console.log(output);
        }
        break;
      default:
        console.log(output);
    }
  }

  debug(message: string, metadata?: Record<string, any>) {
    this.log('debug', message, metadata);
  }

  info(message: string, metadata?: Record<string, any>) {
    this.log('info', message, metadata);
  }

  warn(message: string, metadata?: Record<string, any>) {
    this.log('warn', message, metadata);
  }

  error(message: string, error?: Error | null, metadata?: Record<string, any>) {
    this.log('error', message, {
      ...metadata,
      error: error ? {
        name: error.name,
        message: error.message,
        stack: error.stack,
      } : undefined,
    });
  }

  // Request logging middleware
  requestLogger() {
    return (req: any, res: Response, next: NextFunction) => {
      const startTime = Date.now();

      // Skip health check logs to reduce noise
      if (req.path === '/health' || req.path === '/ready' || req.path === '/metrics') {
        return next();
      }

      res.on('finish', () => {
        const duration = Date.now() - startTime;

        const logData = {
          requestId: req.requestId,
          userId: req.user?.userId || req.user?.id,
          path: req.path,
          method: req.method,
          statusCode: res.statusCode,
          duration,
          userAgent: req.headers['user-agent']?.substring(0, 50),
          ip: req.ip,
        };

        if (res.statusCode >= 500) {
          this.error(`${req.method} ${req.path}`, null, logData);
        } else if (res.statusCode >= 400) {
          this.warn(`${req.method} ${req.path}`, logData);
        } else if (duration > 1000) {
          this.warn(`SLOW ${req.method} ${req.path}`, logData);
        } else {
          this.info(`${req.method} ${req.path}`, logData);
        }
      });

      next();
    };
  }

  // Child logger with context
  child(context: Record<string, any>) {
    const parent = this;
    return {
      debug: (message: string, metadata?: Record<string, any>) => 
        parent.debug(message, { ...context, ...metadata }),
      info: (message: string, metadata?: Record<string, any>) => 
        parent.info(message, { ...context, ...metadata }),
      warn: (message: string, metadata?: Record<string, any>) => 
        parent.warn(message, { ...context, ...metadata }),
      error: (message: string, error?: Error | null, metadata?: Record<string, any>) => 
        parent.error(message, error, { ...context, ...metadata }),
    };
  }
}

export const logger = new Logger();
export default logger;
