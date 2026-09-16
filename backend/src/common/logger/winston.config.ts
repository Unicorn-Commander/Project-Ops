import * as winston from 'winston';

export const createLogger = () => {
  const { combine, timestamp, printf, colorize, errors } = winston.format;

  const logFormat = printf(({ level, message, timestamp, stack, context }) => {
    return `${timestamp} [${context || 'Application'}] ${level}: ${stack || message}`;
  });

  return {
    transports: [
      new winston.transports.Console({
        // Pin the stdout level so per-request info/warn (e.g. auth-gate
        // decisions) always surface in `docker logs`, independent of any
        // env-driven default.
        level: 'info',
        format: combine(
          colorize(),
          timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
          errors({ stack: true }),
          logFormat,
        ),
      }),
      new winston.transports.File({
        filename: 'logs/error.log',
        level: 'error',
        format: combine(timestamp(), errors({ stack: true }), winston.format.json()),
      }),
      new winston.transports.File({
        filename: 'logs/combined.log',
        format: combine(timestamp(), winston.format.json()),
      }),
    ],
  };
};
