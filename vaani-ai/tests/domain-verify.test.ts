import { describe, expect, it } from "vitest";
import {
  expectedTxtValue,
  normalizeDomain,
  verifyDomainOwnership,
  type DnsResolver,
} from "@/lib/domain-verify";

const WS = "ckyz123abc";
const HOST = "app.vaani.ai";

function resolver(opts: { txt?: string[][]; cname?: string[]; txtThrows?: boolean; cnameThrows?: boolean }): DnsResolver {
  return {
    async resolveTxt() {
      if (opts.txtThrows ?? true) throw new Error("ENODATA");
      return opts.txt ?? [];
    },
    async resolveCname() {
      if (opts.cnameThrows ?? true) throw new Error("ENODATA");
      return opts.cname ?? [];
    },
  };
}

describe("expectedTxtValue", () => {
  it("is vaani-verification=<workspaceId>", () => {
    expect(expectedTxtValue(WS)).toBe(`vaani-verification=${WS}`);
  });
});

describe("normalizeDomain", () => {
  it("lowercases and strips protocol, path and trailing dot", () => {
    expect(normalizeDomain("https://App.Brand.com/")).toBe("app.brand.com");
    expect(normalizeDomain("calls.brand.com.")).toBe("calls.brand.com");
  });
  it("rejects garbage", () => {
    expect(normalizeDomain("not a domain")).toBeNull();
    expect(normalizeDomain("localhost")).toBeNull();
    expect(normalizeDomain("")).toBeNull();
    expect(normalizeDomain("-bad.com")).toBeNull();
  });
});

describe("verifyDomainOwnership", () => {
  it("succeeds via matching TXT record", async () => {
    const r = await verifyDomainOwnership({
      domain: "app.brand.com",
      workspaceId: WS,
      appHost: HOST,
      resolver: resolver({ txtThrows: false, txt: [[`vaani-verification=${WS}`]] }),
    });
    expect(r).toMatchObject({ ok: true, method: "txt" });
  });

  it("joins multi-chunk TXT records before comparing", async () => {
    const r = await verifyDomainOwnership({
      domain: "app.brand.com",
      workspaceId: WS,
      appHost: HOST,
      resolver: resolver({ txtThrows: false, txt: [["vaani-verification=", WS]] }),
    });
    expect(r.ok).toBe(true);
  });

  it("succeeds via CNAME to the app host (trailing dot tolerated)", async () => {
    const r = await verifyDomainOwnership({
      domain: "app.brand.com",
      workspaceId: WS,
      appHost: HOST,
      resolver: resolver({ cnameThrows: false, cname: ["app.vaani.ai."] }),
    });
    expect(r).toMatchObject({ ok: true, method: "cname" });
  });

  it("fails when CNAME points elsewhere, with an actionable error", async () => {
    const r = await verifyDomainOwnership({
      domain: "app.brand.com",
      workspaceId: WS,
      appHost: HOST,
      resolver: resolver({ cnameThrows: false, cname: ["someone-else.com"] }),
    });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("someone-else.com");
  });

  it("fails when no records exist, naming the TXT to add", async () => {
    const r = await verifyDomainOwnership({
      domain: "app.brand.com",
      workspaceId: WS,
      appHost: HOST,
      resolver: resolver({}),
    });
    expect(r.ok).toBe(false);
    expect(r.error).toContain(`vaani-verification=${WS}`);
  });

  it("a wrong workspace id never verifies (cross-tenant safety)", async () => {
    const r = await verifyDomainOwnership({
      domain: "app.brand.com",
      workspaceId: "other_ws",
      appHost: HOST,
      resolver: resolver({ txtThrows: false, txt: [[`vaani-verification=${WS}`]] }),
    });
    expect(r.ok).toBe(false);
  });
});
