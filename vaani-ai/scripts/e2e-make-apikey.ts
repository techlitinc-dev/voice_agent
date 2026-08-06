/**
 * E2E-only: create (or recreate) an isolated second workspace with a scoped API
 * key, for the cross-tenant isolation test. Prints the RAW key once (last line).
 * Usage: npx tsx scripts/e2e-make-apikey.ts
 */
import "../src/lib/db";
import { createHash, randomBytes } from "node:crypto";
import { db } from "../src/lib/db";

async function main() {
  const ws = await db.workspace.upsert({
    where: { slug: "e2e-tenant-b" },
    update: {},
    create: { name: "E2E Tenant B", slug: "e2e-tenant-b" },
  });
  const rawKey = `vaani_test_${randomBytes(24).toString("hex")}`;
  await db.apiKey.deleteMany({ where: { workspaceId: ws.id, name: "e2e-cross-tenant" } });
  await db.apiKey.create({
    data: {
      workspaceId: ws.id,
      name: "e2e-cross-tenant",
      keyPrefix: rawKey.slice(0, 8),
      keyHash: createHash("sha256").update(rawKey).digest("hex"),
      scopes: ["calls:read"],
    },
  });
  console.log(`workspace=${ws.slug}`);
  console.log(rawKey);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => db.$disconnect());
