/**
 * Accept the newest QUEUED transfer request for the demo workspace through the
 * exact lib function the server action uses, and prove the accept is atomic.
 * Usage: npx tsx scripts/sim-transfer-accept.ts
 */
import { acceptTransfer } from "../src/lib/transfers";
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  const u = await db.user.findUnique({ where: { email: "demo@vaani.ai" } });
  if (!u) throw new Error("demo user missing (guide 02 seed)");
  const w = await db.workspace.findUnique({ where: { slug: "demo-clinic" } });
  if (!w) throw new Error("demo workspace missing (guide 02 seed)");
  const req = await db.transferRequest.findFirst({
    where: { workspaceId: w.id, status: "QUEUED" },
    orderBy: { createdAt: "desc" },
  });
  if (!req) throw new Error("no QUEUED transfer request found");
  console.log("queue entry:", req.queue, req.reason);
  const r = await acceptTransfer(w.id, u.id, req.id);
  console.log("accept:", JSON.stringify(r));
  const again = await acceptTransfer(w.id, u.id, req.id);
  console.log("double-accept blocked:", JSON.stringify(again));
  await db.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
