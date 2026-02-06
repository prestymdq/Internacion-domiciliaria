import { Prisma } from "@prisma/client";

type AuditPayload = {
  tenantId?: string | null;
  actorId?: string | null;
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  meta?: Record<string, unknown>;
  ip?: string | null;
  userAgent?: string | null;
};

export async function logAudit(
  db: Prisma.TransactionClient,
  payload: AuditPayload,
) {
  await db.auditLog.create({
    data: {
      tenantId: payload.tenantId ?? null,
      actorId: payload.actorId ?? null,
      action: payload.action,
      entityType: payload.entityType ?? null,
      entityId: payload.entityId ?? null,
      meta: payload.meta ?? undefined,
      ip: payload.ip ?? null,
      userAgent: payload.userAgent ?? null,
    },
  });
}
