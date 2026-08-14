import { describe, expect, it } from "vitest";
import {
  hasPermission,
  isPermissionKey,
  PERMISSIONS,
  resolvePermissions,
  ROLE_PERMISSIONS,
} from "../src/lib/permissions";

describe("permission vocabulary", () => {
  it("contains the canonical domains", () => {
    for (const key of [
      "agents:read", "agents:write",
      "campaigns:read", "campaigns:write", "campaigns:launch",
      "contacts:read", "contacts:write", "contacts:import",
      "deals:read", "deals:write", "deals:delete", "deals:approve",
      "pipelines:write",
      "segments:read", "segments:write", "segments:delete",
      "calls:read", "recordings:read", "analytics:read",
      "billing:read", "billing:write",
      "users:read", "users:write",
      "apikeys:read", "apikeys:write",
      "live:listen", "live:whisper", "live:barge",
      "settings:read", "settings:write",
    ]) {
      expect(isPermissionKey(key), key).toBe(true);
    }
  });

  it("rejects unknown keys", () => {
    expect(isPermissionKey("admin:everything")).toBe(false);
    expect(isPermissionKey("agents")).toBe(false);
    expect(isPermissionKey("")).toBe(false);
  });
});

describe("role defaults (spec 3.2)", () => {
  it("OWNER gets every permission", () => {
    expect(new Set(ROLE_PERMISSIONS.OWNER)).toEqual(new Set(PERMISSIONS));
  });

  it("ADMIN manages agents/campaigns/users/numbers but not billing or api keys", () => {
    for (const key of ["agents:write", "campaigns:write", "users:write", "numbers:write"]) {
      expect(ROLE_PERMISSIONS.ADMIN).toContain(key);
    }
    expect(ROLE_PERMISSIONS.ADMIN).not.toContain("billing:write");
    expect(ROLE_PERMISSIONS.ADMIN).not.toContain("apikeys:write");
    expect(ROLE_PERMISSIONS.ADMIN).toContain("billing:read");
  });

  it("MANAGER gets campaigns/contacts/analytics/recordings but not users or billing", () => {
    for (const key of ["campaigns:launch", "contacts:import", "analytics:read", "recordings:read"]) {
      expect(ROLE_PERMISSIONS.MANAGER).toContain(key);
    }
    expect(ROLE_PERMISSIONS.MANAGER).not.toContain("users:write");
    expect(ROLE_PERMISSIONS.MANAGER).not.toContain("billing:read");
  });

  it("MANAGER and ADMIN can approve deals (deals:approve); AGENT cannot", () => {
    expect(ROLE_PERMISSIONS.OWNER).toContain("deals:approve");
    expect(ROLE_PERMISSIONS.ADMIN).toContain("deals:approve");
    expect(ROLE_PERMISSIONS.MANAGER).toContain("deals:approve");
    expect(ROLE_PERMISSIONS.AGENT).not.toContain("deals:approve");
    expect(ROLE_PERMISSIONS.VIEWER).not.toContain("deals:approve");
  });

  it("AGENT (supervisor) gets live listen/whisper/barge but not campaigns", () => {
    for (const key of ["live:listen", "live:whisper", "live:barge"]) {
      expect(ROLE_PERMISSIONS.AGENT).toContain(key);
    }
    expect(ROLE_PERMISSIONS.AGENT).not.toContain("campaigns:write");
  });

  it("VIEWER gets dashboards/reports + CRM read-only (guide crm/02 §8)", () => {
    expect(ROLE_PERMISSIONS.VIEWER).toEqual(["analytics:read", "deals:read", "segments:read"]);
  });
});

describe("grant/revoke overrides", () => {
  const base = { grantedPermissions: [] as string[], revokedPermissions: [] as string[] };

  it("grant adds a permission the role lacks", () => {
    const resolved = resolvePermissions({ role: "VIEWER", ...base, grantedPermissions: ["calls:read"] });
    expect(resolved.has("calls:read")).toBe(true);
    expect(resolved.has("analytics:read")).toBe(true);
  });

  it("revoke removes a permission the role has", () => {
    const resolved = resolvePermissions({ role: "ADMIN", ...base, revokedPermissions: ["users:write"] });
    expect(resolved.has("users:write")).toBe(false);
    expect(resolved.has("agents:write")).toBe(true);
  });

  it("revoke wins over grant for the same key", () => {
    const resolved = resolvePermissions({
      role: "MANAGER",
      grantedPermissions: ["billing:read"],
      revokedPermissions: ["billing:read"],
    });
    expect(resolved.has("billing:read")).toBe(false);
  });

  it("ignores garbage strings in the override arrays", () => {
    const resolved = resolvePermissions({
      role: "VIEWER",
      grantedPermissions: ["not-a-permission", "calls:read"],
      revokedPermissions: ["also-garbage"],
    });
    expect(resolved.has("calls:read")).toBe(true);
    // VIEWER baseline = analytics:read, deals:read, segments:read + granted calls:read
    expect(resolved.size).toBe(4);
  });

  it("hasPermission composes role + overrides", () => {
    expect(hasPermission({ role: "AGENT", ...base }, "live:barge")).toBe(true);
    expect(hasPermission({ role: "AGENT", ...base }, "campaigns:write")).toBe(false);
    expect(
      hasPermission({ role: "AGENT", grantedPermissions: ["campaigns:write"], revokedPermissions: [] }, "campaigns:write")
    ).toBe(true);
  });
});
