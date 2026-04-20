/** Structured JSON logger outputting to stdout */

type LogLevel = "info" | "warn" | "error";

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  data?: Record<string, unknown>;
}

function write(level: LogLevel, message: string, data?: Record<string, unknown>): void {
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    message,
  };
  if (data !== undefined) {
    entry.data = data;
  }
  console.log(JSON.stringify(entry));
}

export const logger = {
  info(message: string, data?: Record<string, unknown>): void {
    write("info", message, data);
  },
  warn(message: string, data?: Record<string, unknown>): void {
    write("warn", message, data);
  },
  error(message: string, data?: Record<string, unknown>): void {
    write("error", message, data);
  },
};
