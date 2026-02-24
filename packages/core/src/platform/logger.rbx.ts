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
 * Format timestamp for display in Roblox
 */
function formatTimestamp(timestamp: number): string {
  // Roblox doesn't have Date constructor, use tick() based formatting
  const seconds = timestamp / 1000;
  const minutes = math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}:${string.format("%.3f", remainingSeconds)}`;
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
 * Convert data to string for Roblox output
 */
function dataToString(data: unknown): string {
  if (data === undefined) {
    return "";
  }
  if (typeIs(data, "string")) {
    return data;
  }
  if (typeIs(data, "number") || typeIs(data, "boolean")) {
    return tostring(data);
  }
  // For objects/tables, use a simple representation
  return "[object]";
}

/**
 * Get current timestamp in milliseconds (Roblox compatible)
 */
function getCurrentTimestamp(): number {
  return tick() * 1000; // Convert to milliseconds
}

/**
 * Roblox logger implementation
 */
class RobloxLogger implements Logger {
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

    const timestamp = getCurrentTimestamp();
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
    const child = new RobloxLogger(childCategory);
    child.level = this.level;
    return child;
  }

  private output(entry: LogEntry): void {
    const levelText = formatLevel(entry.level);
    const timestampText = formatTimestamp(entry.timestamp);
    const categoryText = entry.category ? `[${entry.category}]` : "";
    const dataText = entry.data !== undefined ? ` ${dataToString(entry.data)}` : "";

    // Format: [timestamp] LEVEL [category] message data
    const parts = [`[${timestampText}]`, levelText];

    if (categoryText) {
      parts.push(categoryText);
    }

    parts.push(entry.message);
    const logLine = parts.join(" ") + dataText;

    // Use appropriate Roblox output function based on level
    switch (entry.level) {
      case LogLevel.DEBUG:
      case LogLevel.INFO:
        print(logLine);
        break;
      case LogLevel.WARN:
        warn(logLine);
        break;
      case LogLevel.ERROR:
        error(logLine);
        break;
      default:
        print(logLine);
    }
  }
}

/**
 * Default logger instance
 */
export const logger: Logger = new RobloxLogger();

/**
 * Create a new logger instance
 */
export function createLogger(category?: string): Logger {
  return new RobloxLogger(category);
}
