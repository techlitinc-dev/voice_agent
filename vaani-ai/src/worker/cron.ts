/**
 * node-cron schedules owned by guide 08. Registered once from the worker's main().
 * - Digests: DIGEST_CRON (default "5 * * * *" — hourly at :05; sendDueDigests
 *   decides per-digest whether it is due).
 * - Retention: RETENTION_CRON (default "30 3 * * *" — nightly 03:30 server time).
 * Invalid expressions fall back to the defaults (logged), never crash the worker.
 */
import cron from "node-cron";
import { sendDueDigests } from "./digest";
import { enforceRetention } from "./retention";

const DIGEST_CRON = process.env.DIGEST_CRON ?? "5 * * * *";
const RETENTION_CRON = process.env.RETENTION_CRON ?? "30 3 * * *";

export function startCronJobs(): void {
  const digestExpr = cron.validate(DIGEST_CRON) ? DIGEST_CRON : "5 * * * *";
  const retentionExpr = cron.validate(RETENTION_CRON) ? RETENTION_CRON : "30 3 * * *";
  if (digestExpr !== DIGEST_CRON) console.error(`[cron] invalid DIGEST_CRON "${DIGEST_CRON}" — using "5 * * * *"`);
  if (retentionExpr !== RETENTION_CRON) console.error(`[cron] invalid RETENTION_CRON "${RETENTION_CRON}" — using "30 3 * * *"`);

  cron.schedule(digestExpr, () => {
    sendDueDigests().catch((e) => console.error("[cron] digest error", e));
  });
  cron.schedule(retentionExpr, () => {
    enforceRetention().catch((e) => console.error("[cron] retention error", e));
  });
  console.log(new Date().toISOString(), `[cron] schedules registered: digests "${digestExpr}", retention "${retentionExpr}"`);
}
