/**
 * Usage: npx tsx scripts/make-test-session.ts <email> [role]
 *   npx tsx scripts/make-test-session.ts viewer@test.dev VIEWER
 * Prints:  vaani_session=<token>.<jwt>   (last line)
 * TEST ONLY — never run against production data.
 */
import "../src/lib/db"; // importing the Prisma client first loads .env into process.env
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { SignJWT } from "jose";
import { db } from "../src/lib/db";
import type { Role } from "@prisma/client";

async function main() {
  const [email, role = "VIEWER"] = process.argv.slice(2);
  if (!email) throw new Error("usage: tsx scripts/make-test-session.ts <email> [role]");

  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error("SESSION_SECRET missing in .env");

  const user = await db.user.upsert({
    where: { email },
    update: {},
    create: {
      email,
      fullName: "Test User",
      passwordHash: await bcrypt.hash("test1234", 10),
    },
  });

  const workspace = await db.workspace.findUnique({ where: { slug: "demo-clinic" } });
  if (!workspace) throw new Error("demo-clinic workspace not found — run the guide 02 seed first");

  await db.membership.upsert({
    where: { userId_workspaceId: { userId: user.id, workspaceId: workspace.id } },
    update: { role: role as Role, grantedPermissions: [], revokedPermissions: [] },
    create: { userId: user.id, workspaceId: workspace.id, role: role as Role },
  });

  const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1h test session
  const session = await db.session.create({
    data: {
      token: randomUUID(),
      userId: user.id,
      activeWorkspaceId: workspace.id,
      deviceName: "test-script",
      expiresAt,
    },
  });

  const jwt = await new SignJWT({ sessionId: session.id, userId: user.id })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime(expiresAt)
    .sign(new TextEncoder().encode(secret));

  console.log(`userId=${user.id} sessionId=${session.id} role=${role}`);
  console.log(`vaani_session=${session.token}.${jwt}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
