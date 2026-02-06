import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getTenantModuleAccess } from "@/lib/tenant-access";
import AccessDenied from "@/components/app/access-denied";
import { withTenant } from "@/lib/rls";

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

  return withTenant(tenantId, async (db) => {
    const access = await getTenantModuleAccess(db, tenantId, "CLINIC");
    if (!access.allowed) {
      return <AccessDenied reason={access.reason ?? "Sin acceso."} />;
    }

    const patients = await db.patient.count({ where: { tenantId } });
    const episodes = await db.episode.count({
      where: { tenantId, status: "ACTIVE" },
    });
    const deliveries = await db.delivery.count({
      where: { tenantId, status: "DELIVERED" },
    });
    const incidents = await db.incident.count({ where: { tenantId } });
    const visitsScheduled = await db.visit.count({
      where: { tenantId, status: "SCHEDULED" },
    });
    const visitsCompleted = await db.visit.count({
      where: { tenantId, status: "COMPLETED" },
    });

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
  });
}
