-- Approval Workflows (docs/new-features/05 §3.7): the original Tier-2 migration
-- (20260814091606) created the ApprovalRequest table but forgot to extend the
-- ActivityType enum with APPROVAL_* values, even though schema.prisma lists them.
-- Without these the approval flow's APPROVAL_REQUESTED / APPROVAL_RESOLVED /
-- APPROVAL_REJECTED activity inserts fail. Add them now (idempotent).

ALTER TYPE "ActivityType" ADD VALUE IF NOT EXISTS 'APPROVAL_REQUESTED';
ALTER TYPE "ActivityType" ADD VALUE IF NOT EXISTS 'APPROVAL_RESOLVED';
ALTER TYPE "ActivityType" ADD VALUE IF NOT EXISTS 'APPROVAL_REJECTED';
