import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/**
 * Read-replica routing (scalability doc §2.4).
 *
 * When DATABASE_REPLICA_URL is set, read-only query methods (findMany,
 * findUnique, findFirst, aggregate, groupBy, count) are proxied to a SECOND
 * PrismaClient bound to the replica; writes and everything else go to the
 * primary. Without the env var, everything uses the primary (MVP tier).
 */

const READ_METHODS = new Set([
  "findMany",
  "findUnique",
  "findFirst",
  "findFirstOrThrow",
  "findUniqueOrThrow",
  "aggregate",
  "groupBy",
  "count",
]);

function buildPrimary(): PrismaClient {
  return (
    globalForPrisma.prisma ??
    new PrismaClient({
      log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
    })
  );
}

const primary = buildPrimary();

let replica: PrismaClient | null = null;
if (process.env.DATABASE_REPLICA_URL) {
  replica = new PrismaClient({
    datasources: { db: { url: process.env.DATABASE_REPLICA_URL } },
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
}

export const db = new Proxy(primary, {
  get(target, prop, receiver) {
    if (replica && typeof prop === "string" && READ_METHODS.has(prop)) {
      return (replica as unknown as Record<string, unknown>)[prop];
    }
    return Reflect.get(target, prop, receiver);
  },
}) as PrismaClient;

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = primary;
