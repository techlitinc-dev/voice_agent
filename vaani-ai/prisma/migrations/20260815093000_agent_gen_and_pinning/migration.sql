-- Add LLM generation controls (temperature/maxTokens) and version pinning to Agent.

ALTER TABLE "Agent" ADD COLUMN "temperature" DOUBLE PRECISION NOT NULL DEFAULT 0.7;
ALTER TABLE "Agent" ADD COLUMN "maxTokens" INTEGER NOT NULL DEFAULT 300;
ALTER TABLE "Agent" ADD COLUMN "pinnedVersionId" TEXT;

-- FK to AgentVersion for pinning (AGENT-33).
ALTER TABLE "Agent" ADD CONSTRAINT "Agent_pinnedVersionId_fkey"
  FOREIGN KEY ("pinnedVersionId") REFERENCES "AgentVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Agent_pinnedVersionId_idx" ON "Agent"("pinnedVersionId");
