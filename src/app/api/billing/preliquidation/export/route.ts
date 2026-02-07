import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getTenantModuleAccess } from "@/lib/tenant-access";
import { withTenant } from "@/lib/rls";
import { hasRole } from "@/lib/rbac";
import { Role } from "@prisma/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getServerSession(authOptions);
  const tenantId = session?.user?.tenantId;
  if (!tenantId) {
    return new Response("UNAUTHORIZED", { status: 401 });
  }
  if (
    !hasRole(session.user.role, [
      Role.ADMIN_TENANT,
      Role.FACTURACION,
      Role.AUDITOR,
    ])
  ) {
    return new Response("FORBIDDEN", { status: 403 });
  }

  const rows = await withTenant(tenantId, async (db) => {
    const access = await getTenantModuleAccess(db, tenantId, "BILLING");
    if (!access.allowed) {
      return null;
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

    return deliveries.map((delivery) => {
      const authorized = delivery.pickList.items.reduce(
        (sum, item) => sum + item.requestedQty,
        0,
      );
      const realized = delivery.pickList.items.reduce(
        (sum, item) => sum + item.pickedQty,
        0,
      );
      const evidenced = delivery.evidence.length > 0;

      return [
        delivery.deliveryNumber,
        `${delivery.approvedOrder.patient.lastName}, ${delivery.approvedOrder.patient.firstName}`,
        delivery.status,
        delivery.deliveredAt ? delivery.deliveredAt.toISOString() : "",
        authorized,
        realized,
        evidenced ? "SI" : "NO",
        delivery.evidence.length,
      ];
    });
  });

  if (!rows) {
    return new Response("FORBIDDEN", { status: 403 });
  }

  const header = [
    "Entrega",
    "Paciente",
    "Estado",
    "FechaEntrega",
    "Autorizado",
    "Realizado",
    "Evidenciado",
    "Evidencias",
  ];

  const csv = [header, ...rows]
    .map((row) =>
      row
        .map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`)
        .join(","),
    )
    .join("\n");

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": "attachment; filename=preliquidacion.csv",
    },
  });
}
