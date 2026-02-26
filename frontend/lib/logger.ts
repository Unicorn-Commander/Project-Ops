/**
 * Logger utility for development and production environments
 *
 * Usage:
 *   import { logger } from '@/lib/logger';
 *   logger.log('Debug message');      // Only in development
 *   logger.error('Error message');    // Always shown
 *   logger.warn('Warning message');   // Only in development
 */

const isDevelopment = process.env.NODE_ENV === 'development';

export const logger = {
  /**
   * Log debug information (development only)
   */
  log: (...args: any[]) => {
    if (isDevelopment) {
      console.log(...args);
    }
  },

  /**
   * Log errors (always shown)
   */
  error: (...args: any[]) => {
    console.error(...args);
  },

  /**
   * Log warnings (development only)
   */
  warn: (...args: any[]) => {
    if (isDevelopment) {
      console.warn(...args);
    }
  },

  /**
   * Log info messages (development only)
   */
  info: (...args: any[]) => {
    if (isDevelopment) {
      console.info(...args);
    }
  },

  /**
   * Log debug messages (development only)
   */
  debug: (...args: any[]) => {
    if (isDevelopment) {
      console.debug(...args);
    }
  },
};
