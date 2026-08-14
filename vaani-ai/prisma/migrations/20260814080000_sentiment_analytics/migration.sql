-- Sentiment & emotion analytics (docs/new-features/02)
-- Adds per-turn caller sentiment + per-call timeline/trend.
-- NOTE: "transcriptTsv" is intentionally NOT touched — it is an unmanaged
-- tsvector column created by migration 20260805104041_call_transcript_fts
-- (raw SQL, absent from schema.prisma) and must remain for full-text search.
-- This migration also catches up two pre-existing schema-drift columns on
-- SavedReport (createdByUserId, visibility) that were added to schema.prisma
-- without a migration.

-- AlterTable
ALTER TABLE "Call" ADD COLUMN     "sentimentTimeline" JSONB,
ADD COLUMN     "sentimentTrend" TEXT;

-- AlterTable
ALTER TABLE "TranscriptEntry" ADD COLUMN     "sentiment" TEXT,
ADD COLUMN     "sentimentScore" DOUBLE PRECISION;

-- AlterTable (catch-up drift)
ALTER TABLE "SavedReport" ADD COLUMN     "createdByUserId" TEXT,
ADD COLUMN     "visibility" TEXT NOT NULL DEFAULT 'shared';

-- AddForeignKey (catch-up drift)
ALTER TABLE "SavedReport" ADD CONSTRAINT "SavedReport_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
