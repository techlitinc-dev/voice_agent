import { describe, expect, it } from "vitest";
import { Writable } from "node:stream";
import pino from "pino";

/**
 * Verify the pino redact config (the same paths as src/lib/logger.ts) actually
 * scrubs secret/PII fields. Uses a fresh logger with a capture stream — the
 * shared logger in src/lib/logger.ts writes to stdout, which is fine to leave
 * alone in tests.
 */
function captureLogger() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      lines.push(String(chunk));
      cb();
    },
  });
  const logger = pino(
    {
      redact: {
        paths: [
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
        ],
        censor: "[REDACTED]",
      },
      formatters: {
        level(label) {
          return { level: label };
        },
      },
      timestamp: pino.stdTimeFunctions.isoTime,
    },
    stream
  );
  return { lines, logger };
}

describe("structured logger redaction (observability doc §3)", () => {
  it("redacts secret fields at the serializer level", async () => {
    const { lines, logger } = captureLogger();
    logger.info({
      message: "login attempt",
      password: "hunter2",
      token: "abc123",
      apiKey: "key-xyz",
      email: "a@b.co",
      phone: "+919876543210",
      userId: "cl_keep_me",
    });
    await new Promise((r) => setTimeout(r, 20));
    const line = lines[0];
    expect(line).toContain('"password":"[REDACTED]"');
    expect(line).toContain('"token":"[REDACTED]"');
    expect(line).toContain('"apiKey":"[REDACTED]"');
    expect(line).toContain('"email":"[REDACTED]"');
    expect(line).toContain('"phone":"[REDACTED]"');
    // non-secret fields survive
    expect(line).toContain('"userId":"cl_keep_me"');
    expect(line).toContain('"message":"login attempt"');
    // raw secrets never appear
    expect(line).not.toContain("hunter2");
    expect(line).not.toContain("abc123");
    expect(line).not.toContain("key-xyz");
  });

  it("emits JSON lines with level + time", async () => {
    const { lines, logger } = captureLogger();
    logger.warn({ message: "rate limit hit" });
    await new Promise((r) => setTimeout(r, 20));
    const parsed = JSON.parse(lines[0]);
    expect(parsed.level).toBe("warn");
    expect(typeof parsed.time).toBe("string");
  });
});
