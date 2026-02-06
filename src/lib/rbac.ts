import { Role } from "@prisma/client";

export const roleLabels: Record<Role, string> = {
  SUPERADMIN: "Superadmin",
  ADMIN_TENANT: "Admin",
  COORDINACION: "Coordinación",
  DEPOSITO: "Depósito",
  LOGISTICA: "Logística",
  PROFESIONAL: "Profesional",
  FACTURACION: "Facturación",
  AUDITOR: "Auditor",
};

export function isSuperAdmin(role?: string | null) {
  return role === Role.SUPERADMIN;
}

export function hasRole(role: string | null | undefined, allowed: Role[]) {
  if (!role) return false;
  if (role === Role.SUPERADMIN) return true;
  return allowed.includes(role as Role);
}

export function assertRole(role: string | null | undefined, allowed: Role[]) {
  if (!hasRole(role, allowed)) {
    throw new Error("FORBIDDEN");
  }
}
