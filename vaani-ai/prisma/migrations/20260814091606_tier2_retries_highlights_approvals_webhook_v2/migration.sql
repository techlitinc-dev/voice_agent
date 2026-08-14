-- Tier-2 roadmap features (docs/new-features/05 §3.5–3.7, §3.9)
--  * §3.5 Smart Retries v2: Contact.optimalCallWindows + lastRetryAnalysisAt
--  * §3.6 Call Highlights Reel: Call.highlightsKey
--  * §3.7 Approval Workflows: ApprovalRequest model, Workspace approval
--    settings, ActivityType APPROVAL_* values
--  * §3.9 Webhook v2: WebhookDelivery.attemptLog
-- NOTE: "transcriptTsv" is intentionally NOT touched — it is an unmanaged
-- tsvector column created by migration 20260805104041_call_transcript_fts
-- (raw SQL, absent from schema.prisma) and must remain for full-text search.

-- CreateEnum (Approval Workflows)
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterTable (Smart Retries v2)
ALTER TABLE "Contact" ADD COLUMN     "optimalCallWindows" JSONB,
ADD COLUMN     "lastRetryAnalysisAt" TIMESTAMP(3);

-- AlterTable (Call Highlights Reel)
ALTER TABLE "Call" ADD COLUMN     "highlightsKey" TEXT;

-- AlterTable (Approval Workflows: workspace settings)
ALTER TABLE "Workspace" ADD COLUMN     "approvalThresholdPaise" INTEGER,
ADD COLUMN     "approvalRequiredStages" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable (Webhook v2: per-attempt history)
ALTER TABLE "WebhookDelivery" ADD COLUMN     "attemptLog" JSONB;

-- CreateTable (Approval Workflows)
CREATE TABLE "ApprovalRequest" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "requestedByUserId" TEXT NOT NULL,
    "requestedStageId" TEXT NOT NULL,
    "fromStageId" TEXT NOT NULL,
    "valuePaise" INTEGER NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "approvedByUserId" TEXT,
    "decidedAt" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApprovalRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ApprovalRequest_workspaceId_status_createdAt_idx" ON "ApprovalRequest"("workspaceId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "ApprovalRequest_dealId_idx" ON "ApprovalRequest"("dealId");

-- AddForeignKey
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
