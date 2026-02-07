type LogLevel = "debug" | "info" | "warn" | "error";

const levelRank: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const configuredLevel = (process.env.LOG_LEVEL ?? "info") as LogLevel;
const minLevel = levelRank[configuredLevel] ?? levelRank.info;

export function log(
  level: LogLevel,
  message: string,
  meta?: Record<string, unknown>,
) {
  if (levelRank[level] < minLevel) return;
  const payload = {
    level,
    message,
    ts: new Date().toISOString(),
    ...meta,
  };
  if (level === "error") {
    console.error(JSON.stringify(payload));
  } else if (level === "warn") {
    console.warn(JSON.stringify(payload));
  } else {
    console.log(JSON.stringify(payload));
  }
}

export function logInfo(message: string, meta?: Record<string, unknown>) {
  log("info", message, meta);
}

export function logWarn(message: string, meta?: Record<string, unknown>) {
  log("warn", message, meta);
}

export function logError(message: string, meta?: Record<string, unknown>) {
  log("error", message, meta);
}
