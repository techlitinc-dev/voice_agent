/**
 * Run the real post-call processor for one call, with optional deterministic hints
 * (skips the LLM so the test never depends on OPENROUTER_API_KEY).
 * Usage: npx tsx scripts/sim-postcall.ts <callId> [hintsJson]
 */
import { processCompletedCall } from "../src/lib/postcall";

async function main() {
  const [callId, hintsJson] = process.argv.slice(2);
  if (!callId) {
    console.error("usage: npx tsx scripts/sim-postcall.ts <callId> [hintsJson]");
    process.exit(1);
  }
  const hints = hintsJson ? JSON.parse(hintsJson) : {};
  await processCompletedCall(callId, hints);
  console.log("postcall done for", callId);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
