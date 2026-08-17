import pino from "pino";

/**
 * Structured logger (observability doc §3). Ships JSON lines to stdout;
 * promtail tails stdout and forwards to Loki. Pino redacts known secret/PII
 * field names at the serializer level — values never hit the log stream.
 *
 * `service` distinguishes web vs worker in Loki labels.
 */
export const SERVICE = process.env.LOG_SERVICE ?? "vaani-web";

const REDACT_PATHS = [
  "password", "*.password",
  "token", "*.token",
  "secret", "*.secret",
  "apiKey", "*.apiKey",
  "accessToken", "*.accessToken",
  "authorization", "*.authorization",
  "cookie", "*.cookie",
  "session", "*.session",
  "phone", "*.phone",
  "email", "*.email",
  "cvv", "*.cvv",
  "pan", "*.pan",
  "aadhaar", "*.aadhaar",
];

const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  redact: {
    paths: REDACT_PATHS,
    censor: "[REDACTED]",
  },
  base: {
    service: SERVICE,
    env: process.env.NODE_ENV,
  },
  formatters: {
    level(label) {
      return { level: label };
    },
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});

export type Logger = typeof logger;
export default logger;

/** Per-request context logger (observability doc §3.3 schema). */
export function requestLogger(
  req: Request,
  context?: { workspaceId?: string; userId?: string }
): Logger {
  return logger.child({
    requestId: crypto.randomUUID(),
    workspaceId: context?.workspaceId,
    userId: context?.userId,
    method: req.method,
    path: new URL(req.url).pathname,
  });
}

/** Convenience for the worker process: same redaction, service=vaani-worker. */
export function workerLogger(): Logger {
  return pino({
    level: process.env.LOG_LEVEL || "info",
    redact: {
      paths: REDACT_PATHS,
      censor: "[REDACTED]",
    },
    base: { service: "vaani-worker", env: process.env.NODE_ENV },
    formatters: { level(label) { return { level: label }; } },
    timestamp: pino.stdTimeFunctions.isoTime,
  });
}
