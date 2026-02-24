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
 * ANSI color codes for console output
 */
const COLORS = {
  reset: "\x1b[0m",
  debug: "\x1b[36m", // cyan
  info: "\x1b[32m", // green
  warn: "\x1b[33m", // yellow
  error: "\x1b[31m", // red
  category: "\x1b[35m", // magenta
  timestamp: "\x1b[90m", // gray
} as const;

/**
 * Format timestamp for display
 */
function formatTimestamp(timestamp: number): string {
  return new Date(timestamp).toISOString();
}

/**
 * Format log level for display
 */
function formatLevel(level: LogLevel): string {
  const levelNames = {
    [LogLevel.DEBUG]: "DEBUG",
    [LogLevel.INFO]: "INFO ",
    [LogLevel.WARN]: "WARN ",
    [LogLevel.ERROR]: "ERROR",
  };
  return levelNames[level] || "UNKNOWN";
}

/**
 * Node.js console logger implementation
 */
class NodeLogger implements Logger {
  public level: LogLevel = LogLevel.INFO;
  public readonly category?: string;

  constructor(category?: string) {
    this.category = category;
  }

  isDebugEnabled(): boolean {
    return this.level <= LogLevel.DEBUG;
  }

  isInfoEnabled(): boolean {
    return this.level <= LogLevel.INFO;
  }

  isWarnEnabled(): boolean {
    return this.level <= LogLevel.WARN;
  }

  isErrorEnabled(): boolean {
    return this.level <= LogLevel.ERROR;
  }

  debug(message: string, data?: unknown): void {
    this.log(LogLevel.DEBUG, message, data);
  }

  info(message: string, data?: unknown): void {
    this.log(LogLevel.INFO, message, data);
  }

  warn(message: string, data?: unknown): void {
    this.log(LogLevel.WARN, message, data);
  }

  error(message: string, data?: unknown): void {
    this.log(LogLevel.ERROR, message, data);
  }

  log(level: LogLevel, message: string, data?: unknown): void {
    if (level < this.level) {
      return;
    }

    const timestamp = Date.now();
    const entry: LogEntry = {
      level,
      message,
      timestamp,
      category: this.category,
      data,
    };

    this.output(entry);
  }

  child(category: string): Logger {
    const childCategory = this.category ? `${this.category}:${category}` : category;
    const child = new NodeLogger(childCategory);
    child.level = this.level;
    return child;
  }

  private output(entry: LogEntry): void {
    const levelColor = this.getLevelColor(entry.level);
    const levelText = formatLevel(entry.level);
    const timestampText = formatTimestamp(entry.timestamp);
    const categoryText = entry.category ? `[${entry.category}]` : "";

    // Format: [timestamp] LEVEL [category] message
    const parts = [`${COLORS.timestamp}${timestampText}${COLORS.reset}`, `${levelColor}${levelText}${COLORS.reset}`];

    if (categoryText) {
      parts.push(`${COLORS.category}${categoryText}${COLORS.reset}`);
    }

    parts.push(entry.message);

    const logLine = parts.join(" ");

    // Use appropriate console method based on level
    switch (entry.level) {
      case LogLevel.DEBUG:
        console.debug(logLine, entry.data !== undefined ? entry.data : "");
        break;
      case LogLevel.INFO:
        console.info(logLine, entry.data !== undefined ? entry.data : "");
        break;
      case LogLevel.WARN:
        console.warn(logLine, entry.data !== undefined ? entry.data : "");
        break;
      case LogLevel.ERROR:
        console.error(logLine, entry.data !== undefined ? entry.data : "");
        break;
      default:
        console.log(logLine, entry.data !== undefined ? entry.data : "");
    }
  }

  private getLevelColor(level: LogLevel): string {
    switch (level) {
      case LogLevel.DEBUG:
        return COLORS.debug;
      case LogLevel.INFO:
        return COLORS.info;
      case LogLevel.WARN:
        return COLORS.warn;
      case LogLevel.ERROR:
        return COLORS.error;
      default:
        return COLORS.reset;
    }
  }
}

/**
 * Default logger instance
 */
export const logger: Logger = new NodeLogger();

/**
 * Create a new logger instance
 */
export function createLogger(category?: string): Logger {
  return new NodeLogger(category);
}
