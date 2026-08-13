/**
 * Report access control (docs/analytics/04 §6).
 * - Only OWNER and ADMIN can create/schedule reports.
 * - MANAGER/AGENT/VIEWER can view reports shared with the workspace.
 * - A report is either "shared" (workspace-visible) or "private" (creator only).
 */
import type { Role } from "@prisma/client";

export type ReportVisibility = "shared" | "private";

export function canCreateReport(role: Role): boolean {
  return role === "OWNER" || role === "ADMIN";
}

export function canViewReport(role: Role, visibility: ReportVisibility, createdByUserId: string | null, userId: string): boolean {
  if (visibility === "private") {
    return createdByUserId !== null && createdByUserId === userId;
  }
  // shared reports are visible to every workspace member (MANAGER/AGENT/VIEWER included)
  return true;
}
