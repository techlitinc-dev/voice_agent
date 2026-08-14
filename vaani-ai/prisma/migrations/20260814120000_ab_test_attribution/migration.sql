-- Voice A/B testing attribution (docs/new-features/05 §3.8)
-- Adds Call.agentVersionId so each call records which published AgentVersion
-- (main vs A/B variant) served it, enabling conversion tracking.

-- AlterTable
ALTER TABLE "Call" ADD COLUMN     "agentVersionId" TEXT;

-- AddForeignKey
ALTER TABLE "Call" ADD CONSTRAINT "Call_agentVersionId_fkey" FOREIGN KEY ("agentVersionId") REFERENCES "AgentVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;
