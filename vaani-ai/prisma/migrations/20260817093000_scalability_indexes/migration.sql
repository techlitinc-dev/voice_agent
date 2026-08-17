-- Scalability & Performance (docs/production-readiness/03-scalability-and-performance.md) §2.1
-- Critical indexes for the highest-frequency query patterns.

CREATE INDEX "Call_workspaceId_status_createdAt_idx" ON "Call" ("workspaceId", "status", "createdAt");
CREATE INDEX "Call_agentId_createdAt_idx" ON "Call" ("agentId", "createdAt");

CREATE INDEX "Contact_workspaceId_dnc_idx" ON "Contact" ("workspaceId", "dnc");
CREATE INDEX "Contact_workspaceId_listId_idx" ON "Contact" ("workspaceId", "listId");

CREATE INDEX "CampaignContact_campaignId_status_nextAttemptAt_idx" ON "CampaignContact" ("campaignId", "status", "nextAttemptAt");
