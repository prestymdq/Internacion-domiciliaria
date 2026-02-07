import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getTenantModuleAccess } from "@/lib/tenant-access";
import { withTenant } from "@/lib/rls";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getServerSession(authOptions);
  const tenantId = session?.user?.tenantId;
  if (!tenantId) {
    return new Response("UNAUTHORIZED", { status: 401 });
  }

  const metrics = await withTenant(tenantId, async (db) => {
    const access = await getTenantModuleAccess(db, tenantId, "ANALYTICS");
    if (!access.allowed) {
      return null;
    }

    const [patients, episodes, visits, deliveries, invoices] =
      await Promise.all([
        db.patient.count({ where: { tenantId } }),
        db.episode.count({ where: { tenantId } }),
        db.visit.count({ where: { tenantId } }),
        db.delivery.count({ where: { tenantId } }),
        db.invoice.count({ where: { tenantId } }),
      ]);

    return {
      patients,
      episodes,
      visits,
      deliveries,
      invoices,
    };
  });

  if (!metrics) {
    return new Response("FORBIDDEN", { status: 403 });
  }

  return Response.json({
    ok: true,
    ts: new Date().toISOString(),
    metrics,
  });
}
