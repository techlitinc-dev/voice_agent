import { describe, expect, it } from "vitest";
import { requiresApproval } from "../src/lib/crm";

const BASE = {
  thresholdPaise: 500_000, // ₹5,000
  approvalRequiredStages: ["Negotiation", "Won"],
};

describe("requiresApproval (Approval Workflows §3.7)", () => {
  it("false when approvals are disabled (threshold null)", () => {
    expect(requiresApproval({ ...BASE, thresholdPaise: null, valuePaise: 10_000_000, stageName: "Won", canApprove: false })).toBe(false);
  });

  it("false below the threshold", () => {
    expect(requiresApproval({ ...BASE, valuePaise: 499_999, stageName: "Won", canApprove: false })).toBe(false);
  });

  it("true at/above the threshold into a required stage", () => {
    expect(requiresApproval({ ...BASE, valuePaise: 500_000, stageName: "Won", canApprove: false })).toBe(true);
    expect(requiresApproval({ ...BASE, valuePaise: 900_000, stageName: "Negotiation", canApprove: false })).toBe(true);
  });

  it("false when the target stage is not approval-required", () => {
    expect(requiresApproval({ ...BASE, valuePaise: 10_000_000, stageName: "Qualified", canApprove: false })).toBe(false);
  });

  it("false when the actor can approve (deals:approve) — no self-approval needed", () => {
    expect(requiresApproval({ ...BASE, valuePaise: 10_000_000, stageName: "Won", canApprove: true })).toBe(false);
  });

  it("empty required stages disables the guard even with a threshold", () => {
    expect(requiresApproval({ ...BASE, approvalRequiredStages: [], valuePaise: 10_000_000, stageName: "Won", canApprove: false })).toBe(false);
  });
});
