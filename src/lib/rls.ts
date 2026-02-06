import { Prisma } from "@prisma/client";
import { prisma } from "./db";

export type TenantDb = Prisma.TransactionClient;

async function setRlsContext(
  db: TenantDb,
  params: { tenantId: string; isSuperadmin: boolean },
) {
  await db.$executeRaw`
    SELECT set_config('app.tenant_id', ${params.tenantId}, true)
  `;
  await db.$executeRaw`
    SELECT set_config('app.is_superadmin', ${params.isSuperadmin ? "true" : "false"}, true)
  `;
}

export async function withTenant<T>(
  tenantId: string,
  fn: (db: TenantDb) => Promise<T>,
) {
  return prisma.$transaction(async (db) => {
    await setRlsContext(db, { tenantId, isSuperadmin: false });
    return fn(db);
  });
}

export async function withSuperadmin<T>(fn: (db: TenantDb) => Promise<T>) {
  return prisma.$transaction(async (db) => {
    await setRlsContext(db, { tenantId: "", isSuperadmin: true });
    return fn(db);
  });
}
