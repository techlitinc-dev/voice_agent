-- Hardening & Security (docs/production-readiness/01-hardening-and-security.md)
-- §1.6  failed-login lockout on User
-- §1.5  device binding fingerprint on Session

ALTER TABLE "User" ADD COLUMN "failedLoginAttempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN "lockedUntil" TIMESTAMP(3);

ALTER TABLE "Session" ADD COLUMN "deviceFingerprint" TEXT;
