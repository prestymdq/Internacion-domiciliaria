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
          Selecciona un tenant para ver KPIs.
        </p>
      </div>
    );
  }

  const access = await getTenantModuleAccess(tenantId, "CLINIC");
  if (!access.allowed) {
    return <AccessDenied reason={access.reason ?? "Sin acceso."} />;
  }

  const [
    patients,
    episodes,
    deliveries,
    incidents,
    visitsScheduled,
    visitsCompleted,
  ] = await Promise.all([
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
          Pulso operativo del dia y cumplimiento.
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        {[
          { label: "Pacientes activos", value: patients },
          { label: "Episodios activos", value: episodes },
          { label: "Visitas programadas", value: visitsScheduled },
          { label: "Visitas completadas", value: visitsCompleted },
          { label: "Entregas OK", value: deliveries },
          { label: "Incidentes", value: incidents },
        ].map((stat) => (
          <div
            key={stat.label}
            className="rounded-2xl border border-white/70 bg-white/70 p-4 shadow-[0_18px_45px_-35px_rgba(15,23,42,0.6)]"
          >
            <p className="text-sm text-muted-foreground">{stat.label}</p>
            <p className="text-2xl font-semibold">{stat.value}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
