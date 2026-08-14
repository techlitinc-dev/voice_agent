-- Voice cloning & brand voices (docs/new-features/03)
-- Adds the CustomVoice model (cloned provider voice per workspace), an optional
-- customVoiceId on Agent (overrides the stock Sarvam voiceId when set), and the
-- Workspace.customVoices back-relation.

-- CreateTable
CREATE TABLE "CustomVoice" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'elevenlabs',
    "language" TEXT NOT NULL DEFAULT 'hi',
    "sampleKey" TEXT,
    "previewKey" TEXT,
    "clonedVoiceId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomVoice_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "Agent" ADD COLUMN     "customVoiceId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "CustomVoice_workspaceId_name_key" ON "CustomVoice"("workspaceId", "name");

-- CreateIndex
CREATE INDEX "CustomVoice_workspaceId_idx" ON "CustomVoice"("workspaceId");

-- AddForeignKey
ALTER TABLE "CustomVoice" ADD CONSTRAINT "CustomVoice_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Agent" ADD CONSTRAINT "Agent_customVoiceId_fkey" FOREIGN KEY ("customVoiceId") REFERENCES "CustomVoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;
