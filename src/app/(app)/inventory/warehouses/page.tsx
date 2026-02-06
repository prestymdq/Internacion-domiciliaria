import { revalidatePath } from "next/cache";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { assertRole } from "@/lib/rbac";
import { Role } from "@prisma/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { assertTenantModuleAccess, getTenantModuleAccess } from "@/lib/tenant-access";
import AccessDenied from "@/components/app/access-denied";

const warehouseSchema = z.object({
  name: z.string().min(1),
  location: z.string().optional(),
});

async function createWarehouse(formData: FormData) {
  "use server";
  const session = await getServerSession(authOptions);
  if (!session?.user?.tenantId) {
    throw new Error("UNAUTHORIZED");
  }
  await assertTenantModuleAccess(session.user.tenantId, "INVENTORY");
  assertRole(session.user.role, [Role.ADMIN_TENANT, Role.DEPOSITO]);

  const parsed = warehouseSchema.safeParse({
    name: formData.get("name"),
    location: formData.get("location"),
  });

  if (!parsed.success) {
    throw new Error("VALIDATION_ERROR");
  }

  const warehouse = await prisma.warehouse.create({
    data: {
      tenantId: session.user.tenantId,
      name: parsed.data.name,
      location: parsed.data.location ?? null,
    },
  });

  await logAudit({
    tenantId: session.user.tenantId,
    actorId: session.user.id,
    action: "warehouse.create",
    entityType: "Warehouse",
    entityId: warehouse.id,
  });

  revalidatePath("/inventory/warehouses");
}

export default async function WarehousesPage() {
  const session = await getServerSession(authOptions);
  const tenantId = session?.user?.tenantId;

  if (!tenantId) {
    return <p className="text-sm text-muted-foreground">Sin tenant.</p>;
  }

  const access = await getTenantModuleAccess(tenantId, "INVENTORY");
  if (!access.allowed) {
    return <AccessDenied reason={access.reason ?? "Sin acceso."} />;
  }

  const warehouses = await prisma.warehouse.findMany({
    where: { tenantId },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Depósitos</h1>
        <p className="text-sm text-muted-foreground">
          Gestión de depósitos y ubicaciones.
        </p>
      </div>

      <form action={createWarehouse} className="grid gap-3 md:grid-cols-3">
        <Input name="name" placeholder="Nombre" required />
        <Input name="location" placeholder="Ubicación" />
        <Button type="submit" className="md:col-span-3">
          Crear depósito
        </Button>
      </form>

      <div className="overflow-hidden rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left">
            <tr>
              <th className="px-3 py-2">Nombre</th>
              <th className="px-3 py-2">Ubicación</th>
            </tr>
          </thead>
          <tbody>
            {warehouses.map((warehouse) => (
              <tr key={warehouse.id} className="border-t">
                <td className="px-3 py-2">{warehouse.name}</td>
                <td className="px-3 py-2">{warehouse.location ?? "-"}</td>
              </tr>
            ))}
            {warehouses.length === 0 ? (
              <tr>
                <td
                  className="px-3 py-4 text-sm text-muted-foreground"
                  colSpan={2}
                >
                  Sin depósitos aún.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
