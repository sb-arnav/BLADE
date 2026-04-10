// src/lib/logger.ts
// Ported from standard enterprise logger patterns for TypeScript
// Supports log levels, environment checks, and basic structured output.

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  NONE = 4,
}

export class Logger {
  private static level: LogLevel = import.meta.env?.DEV ? LogLevel.DEBUG : LogLevel.INFO;
  private static prefix = '[Blade]';

  public static setLevel(level: LogLevel) {
    this.level = level;
  }



  private static shouldLog(level: LogLevel): boolean {
    return level >= this.level;
  }

  static debug(message: string, data?: any) {
    if (!this.shouldLog(LogLevel.DEBUG)) return;
    // formatting omitted for now

    console.debug(`%c${this.prefix} [DEBUG] ${message}`, 'color: #818cf8', data ? JSON.stringify(data) : '');
  }

  static info(message: string, data?: any) {
    if (!this.shouldLog(LogLevel.INFO)) return;
    // formatting omitted for now

    console.info(`%c${this.prefix} [INFO] ${message}`, 'color: #10b981', data || '');
  }

  static warn(message: string, data?: any) {
    if (!this.shouldLog(LogLevel.WARN)) return;
    // formatting omitted for now

    console.warn(`%c${this.prefix} [WARN] ${message}`, 'color: #f59e0b', data || '');
  }

  static error(message: string, error?: any) {
    if (!this.shouldLog(LogLevel.ERROR)) return;
    // formatting omitted for now

    console.error(`%c${this.prefix} [ERROR] ${message}`, 'color: #ef4444; font-weight: bold', error || '');
    // In production, we could export this queue to Tauri's fs layer
  }
}
