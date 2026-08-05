-- AlterTable
ALTER TABLE "Agent" ADD COLUMN     "conversationConfig" JSONB;

-- AlterTable
ALTER TABLE "AgentVersion" ADD COLUMN     "dograhWorkflowUuid" TEXT;
