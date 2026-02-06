import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getTenantModuleAccess } from "@/lib/tenant-access";
import AccessDenied from "@/components/app/access-denied";

export default async function DashboardPage() {
  const session = await getServerSession(authOptions);
  const tenantId = session?.user?.tenantId;

  if (!tenantId) {
    return (
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Seleccioná un tenant para ver KPIs.
        </p>
      </div>
    );
  }

  const access = await getTenantModuleAccess(tenantId, "CLINIC");
  if (!access.allowed) {
    return <AccessDenied reason={access.reason ?? "Sin acceso."} />;
  }

  const [patients, episodes, deliveries, incidents, visitsScheduled, visitsCompleted] = await Promise.all([
    prisma.patient.count({ where: { tenantId } }),
    prisma.episode.count({ where: { tenantId, status: "ACTIVE" } }),
    prisma.delivery.count({ where: { tenantId, status: "DELIVERED" } }),
    prisma.incident.count({ where: { tenantId } }),
    prisma.visit.count({ where: { tenantId, status: "SCHEDULED" } }),
    prisma.visit.count({ where: { tenantId, status: "COMPLETED" } }),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          KPIs operativos del día (MVP).
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-6">
        <div className="rounded-lg border bg-muted/30 p-4">
          <p className="text-sm text-muted-foreground">Pacientes activos</p>
          <p className="text-2xl font-semibold">{patients}</p>
        </div>
        <div className="rounded-lg border bg-muted/30 p-4">
          <p className="text-sm text-muted-foreground">Episodios activos</p>
          <p className="text-2xl font-semibold">{episodes}</p>
        </div>
        <div className="rounded-lg border bg-muted/30 p-4">
          <p className="text-sm text-muted-foreground">Visitas programadas</p>
          <p className="text-2xl font-semibold">{visitsScheduled}</p>
        </div>
        <div className="rounded-lg border bg-muted/30 p-4">
          <p className="text-sm text-muted-foreground">Visitas completadas</p>
          <p className="text-2xl font-semibold">{visitsCompleted}</p>
        </div>
        <div className="rounded-lg border bg-muted/30 p-4">
          <p className="text-sm text-muted-foreground">Entregas OK</p>
          <p className="text-2xl font-semibold">{deliveries}</p>
        </div>
        <div className="rounded-lg border bg-muted/30 p-4">
          <p className="text-sm text-muted-foreground">Incidentes</p>
          <p className="text-2xl font-semibold">{incidents}</p>
        </div>
      </div>
    </div>
  );
}
