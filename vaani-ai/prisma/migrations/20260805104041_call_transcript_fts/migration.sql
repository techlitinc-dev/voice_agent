ALTER TABLE "Call"
  ADD COLUMN IF NOT EXISTS "transcriptTsv" tsvector
  GENERATED ALWAYS AS (to_tsvector('english', coalesce("transcript", ''))) STORED;

CREATE INDEX IF NOT EXISTS "Call_transcriptTsv_gin"
  ON "Call" USING GIN ("transcriptTsv");
