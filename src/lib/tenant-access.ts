import { PlanTier, TenantStatus } from "@prisma/client";
import { prisma } from "./db";

export type ModuleKey =
  | "CLINIC"
  | "INVENTORY"
  | "LOGISTICS"
  | "PAYERS"
  | "AUTHORIZATIONS"
  | "ANALYTICS"
  | "BILLING";

const planMatrix: Record<PlanTier, ModuleKey[]> = {
  STARTER: ["CLINIC", "BILLING"],
  PRO: ["CLINIC", "INVENTORY", "LOGISTICS", "PAYERS", "AUTHORIZATIONS", "BILLING"],
  ENTERPRISE: [
    "CLINIC",
    "INVENTORY",
    "LOGISTICS",
    "PAYERS",
    "AUTHORIZATIONS",
    "ANALYTICS",
    "BILLING",
  ],
};

const defaultPastDueBlocks: ModuleKey[] = ["LOGISTICS", "INVENTORY"];

export async function getTenantModuleAccess(
  tenantId: string,
  moduleKey: ModuleKey,
) {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    include: { policy: true },
  });

  if (!tenant) {
    return { allowed: false, reason: "Tenant no encontrado." };
  }

  const allowedByPlan = planMatrix[tenant.plan].includes(moduleKey);
  if (!allowedByPlan) {
    return {
      allowed: false,
      reason: "Tu plan actual no incluye este módulo.",
    };
  }

  if (tenant.status === TenantStatus.DELETED) {
    return { allowed: false, reason: "Tenant eliminado." };
  }

  if (tenant.status === TenantStatus.SUSPENDED && moduleKey !== "BILLING") {
    return {
      allowed: false,
      reason: "Cuenta suspendida. Regularizá el pago para continuar.",
    };
  }

  if (tenant.status === TenantStatus.PAST_DUE && moduleKey !== "BILLING") {
    const blocked =
      (tenant.policy?.pastDueBlockedModules as ModuleKey[] | null) ??
      defaultPastDueBlocks;
    if (blocked.includes(moduleKey)) {
      return {
        allowed: false,
        reason: "Cuenta en mora. Este módulo está bloqueado.",
      };
    }
  }

  return { allowed: true, reason: null };
}

export async function assertTenantModuleAccess(
  tenantId: string,
  moduleKey: ModuleKey,
) {
  const access = await getTenantModuleAccess(tenantId, moduleKey);
  if (!access.allowed) {
    throw new Error(access.reason ?? "FORBIDDEN");
  }
}
