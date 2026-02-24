/**
 * Log levels in order of severity (lowest to highest)
 */
export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

/**
 * Log entry structure
 */
export interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: number;
  category?: string;
  data?: unknown;
}

/**
 * Cross-platform logger interface
 * Platform-specific implementations provide the actual functionality
 */
export interface Logger {
  /**
   * Current minimum log level - messages below this level are ignored
   */
  level: LogLevel;

  /**
   * Optional category for this logger instance
   */
  readonly category?: string;

  isDebugEnabled(): boolean;
  isInfoEnabled(): boolean;
  isWarnEnabled(): boolean;
  isErrorEnabled(): boolean;

  /**
   * Log a debug message
   */
  debug(message: string, data?: unknown): void;

  /**
   * Log an info message
   */
  info(message: string, data?: unknown): void;

  /**
   * Log a warning message
   */
  warn(message: string, data?: unknown): void;

  /**
   * Log an error message
   */
  error(message: string, data?: unknown): void;

  /**
   * Log a message at the specified level
   */
  log(level: LogLevel, message: string, data?: unknown): void;

  /**
   * Create a child logger with a category
   */
  child(category: string): Logger;
}

/**
 * Default logger instance
 * Platform-specific implementations provide the actual instance
 */
export declare const logger: Logger;

/**
 * Create a new logger instance
 * Platform-specific implementations provide the actual factory
 */
export declare function createLogger(category?: string): Logger;
