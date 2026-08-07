/**
 * Security assertion (phase 5): the session cookie set by createSession must be
 * HttpOnly (JS cannot read it) and Secure on HTTPS requests. SameSite=Lax and
 * Path=/ are also asserted. This guards the cookie flags that phase 5's
 * sec-cookie-flags test verifies (deterministically, at the unit level).
 */
import { afterEach, describe, expect, it, vi } from "vitest";

// Mock next/headers BEFORE importing lib/auth. vi.hoisted avoids TDZ issues.
const { cookieMock, headersMock } = vi.hoisted(() => {
  const cookieMock = vi.fn();
  const headersMock = vi.fn(() => new Headers({ "user-agent": "vitest" }));
  return { cookieMock, headersMock };
});

vi.mock("next/headers", () => ({
  cookies: () => ({
    set: cookieMock,
    get: () => undefined,
    delete: () => undefined,
  }),
  headers: headersMock,
}));

// auth.ts uses React's cache() for getCurrentUser; not available in node env.
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, cache: (fn: unknown) => fn };
});

// SESSION_SECRET + SESSION_DAYS come from env; provide test values.
process.env.SESSION_SECRET = "x".repeat(64);
process.env.SESSION_DAYS = "7";

// Stub the DB layer used by createSession (db.session.create) — the cookie
// flags are what we assert, not the DB write.
vi.mock("@/lib/db", () => ({
  db: {
    session: {
      create: vi.fn().mockResolvedValue({
        id: "sess_test",
        token: "tok_test",
        expiresAt: new Date(Date.now() + 3600_000),
      }),
    },
  },
}));

import { createSession } from "@/lib/auth";

describe("session cookie flags (phase 5 sec-cookie-flags)", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("sets HttpOnly + SameSite=Lax + Path=/ on the session cookie", async () => {
    await createSession("user_test");
    expect(cookieMock).toHaveBeenCalledOnce();
    const [name, value, opts] = cookieMock.mock.calls[0];
    expect(name).toBe("vaani_session");
    expect(typeof value).toBe("string");
    expect(opts.httpOnly).toBe(true);
    expect(opts.sameSite).toBe("lax");
    expect(opts.path).toBe("/");
  });

  it("sets Secure=true when the request is HTTPS", async () => {
    // isSecureRequest() reads x-forwarded-proto; simulate an HTTPS request.
    headersMock.mockReturnValue(
      new Headers({ "user-agent": "vitest", "x-forwarded-proto": "https" })
    );
    await createSession("user_test");
    const [, , opts] = cookieMock.mock.calls[0];
    expect(opts.secure).toBe(true);
  });
});
