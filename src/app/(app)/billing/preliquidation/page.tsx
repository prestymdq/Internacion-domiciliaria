import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { getTenantModuleAccess } from "@/lib/tenant-access";
import AccessDenied from "@/components/app/access-denied";
import { withTenant } from "@/lib/rls";

export default async function PreLiquidationPage() {
  const session = await getServerSession(authOptions);
  const tenantId = session?.user?.tenantId;
  if (!tenantId) {
    return <p className="text-sm text-muted-foreground">Sin tenant.</p>;
  }

  return withTenant(tenantId, async (db) => {
    const access = await getTenantModuleAccess(db, tenantId, "BILLING");
    if (!access.allowed) {
      return <AccessDenied reason={access.reason ?? "Sin acceso."} />;
    }

    const deliveries = await db.delivery.findMany({
      where: { tenantId },
      include: {
        approvedOrder: { include: { patient: true } },
        pickList: { include: { items: true } },
        evidence: true,
      },
      orderBy: { createdAt: "desc" },
    });

    const rows = deliveries.map((delivery) => {
      const authorized = delivery.pickList.items.reduce(
        (sum, item) => sum + item.requestedQty,
        0,
      );
      const realized = delivery.pickList.items.reduce(
        (sum, item) => sum + item.pickedQty,
        0,
      );
      const evidenced = delivery.evidence.length > 0;

      return {
        deliveryNumber: delivery.deliveryNumber,
        patient: `${delivery.approvedOrder.patient.lastName}, ${delivery.approvedOrder.patient.firstName}`,
        status: delivery.status,
        deliveredAt: delivery.deliveredAt
          ? delivery.deliveredAt.toLocaleDateString("es-AR")
          : "-",
        authorized,
        realized,
        evidenced: evidenced ? "SI" : "NO",
        evidenceCount: delivery.evidence.length,
      };
    });

    return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">Pre-liquidación</h1>
          <p className="text-sm text-muted-foreground">
            Autorizado vs realizado vs evidenciado.
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href="/api/billing/preliquidation/export">Descargar CSV</Link>
        </Button>
      </div>

      <div className="overflow-hidden rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left">
            <tr>
              <th className="px-3 py-2">Entrega</th>
              <th className="px-3 py-2">Paciente</th>
              <th className="px-3 py-2">Estado</th>
              <th className="px-3 py-2">Fecha</th>
              <th className="px-3 py-2">Autorizado</th>
              <th className="px-3 py-2">Realizado</th>
              <th className="px-3 py-2">Evidencia</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.deliveryNumber} className="border-t">
                <td className="px-3 py-2">{row.deliveryNumber}</td>
                <td className="px-3 py-2">{row.patient}</td>
                <td className="px-3 py-2">{row.status}</td>
                <td className="px-3 py-2">{row.deliveredAt}</td>
                <td className="px-3 py-2">{row.authorized}</td>
                <td className="px-3 py-2">{row.realized}</td>
                <td className="px-3 py-2">
                  {row.evidenced} ({row.evidenceCount})
                </td>
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr>
                <td
                  className="px-3 py-4 text-sm text-muted-foreground"
                  colSpan={7}
                >
                  Sin entregas aún.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
    );
  });
}
