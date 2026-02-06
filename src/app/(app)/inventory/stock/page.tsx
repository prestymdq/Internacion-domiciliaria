import { revalidatePath } from "next/cache";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { assertRole } from "@/lib/rbac";
import { Role } from "@prisma/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  assertTenantModuleAccess,
  getTenantModuleAccess,
} from "@/lib/tenant-access";
import AccessDenied from "@/components/app/access-denied";
import { withTenant } from "@/lib/rls";

const movementSchema = z.object({
  warehouseId: z.string().min(1),
  productId: z.string().min(1),
  type: z.enum(["IN", "OUT", "ADJUSTMENT"]),
  quantity: z.string().min(1),
  referenceType: z.string().optional(),
  referenceId: z.string().optional(),
});

async function createMovement(formData: FormData) {
  "use server";
  const session = await getServerSession(authOptions);
  if (!session?.user?.tenantId) {
    throw new Error("UNAUTHORIZED");
  }
  await withTenant(session.user.tenantId, async (db) => {
    await assertTenantModuleAccess(db, session.user.tenantId, "INVENTORY");
    assertRole(session.user.role, [Role.ADMIN_TENANT, Role.DEPOSITO]);

    const parsed = movementSchema.safeParse({
      warehouseId: formData.get("warehouseId"),
      productId: formData.get("productId"),
      type: formData.get("type"),
      quantity: formData.get("quantity"),
      referenceType: formData.get("referenceType"),
      referenceId: formData.get("referenceId"),
    });

    if (!parsed.success) {
      throw new Error("VALIDATION_ERROR");
    }

    const movement = await db.stockMovement.create({
      data: {
        tenantId: session.user.tenantId,
        warehouseId: parsed.data.warehouseId,
        productId: parsed.data.productId,
        type: parsed.data.type,
        quantity: Number(parsed.data.quantity),
        referenceType: parsed.data.referenceType ?? null,
        referenceId: parsed.data.referenceId ?? null,
        createdById: session.user.id,
      },
    });

    await logAudit(db, {
      tenantId: session.user.tenantId,
      actorId: session.user.id,
      action: "stock.movement.create",
      entityType: "StockMovement",
      entityId: movement.id,
      meta: {
        type: movement.type,
        quantity: movement.quantity,
      },
    });
  });

  revalidatePath("/inventory/stock");
}

export default async function StockPage() {
  const session = await getServerSession(authOptions);
  const tenantId = session?.user?.tenantId;

  if (!tenantId) {
    return <p className="text-sm text-muted-foreground">Sin tenant.</p>;
  }

  return withTenant(tenantId, async (db) => {
    const access = await getTenantModuleAccess(db, tenantId, "INVENTORY");
    if (!access.allowed) {
      return <AccessDenied reason={access.reason ?? "Sin acceso."} />;
    }

    const products = await db.product.findMany({
      where: { tenantId },
      orderBy: { name: "asc" },
    });
    const warehouses = await db.warehouse.findMany({
      where: { tenantId },
      orderBy: { name: "asc" },
    });
    const movements = await db.stockMovement.findMany({
      where: { tenantId },
      include: { product: true, warehouse: true },
      orderBy: { createdAt: "desc" },
      take: 30,
    });

    return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Movimientos de stock</h1>
        <p className="text-sm text-muted-foreground">
          Entradas, salidas y ajustes.
        </p>
      </div>

      <form action={createMovement} className="grid gap-3 md:grid-cols-6">
        <select
          name="warehouseId"
          className="h-10 rounded-md border bg-background px-3 text-sm"
          required
        >
          <option value="">Depósito...</option>
          {warehouses.map((warehouse) => (
            <option key={warehouse.id} value={warehouse.id}>
              {warehouse.name}
            </option>
          ))}
        </select>
        <select
          name="productId"
          className="h-10 rounded-md border bg-background px-3 text-sm"
          required
        >
          <option value="">Producto...</option>
          {products.map((product) => (
            <option key={product.id} value={product.id}>
              {product.name}
            </option>
          ))}
        </select>
        <select
          name="type"
          className="h-10 rounded-md border bg-background px-3 text-sm"
          required
        >
          <option value="IN">IN</option>
          <option value="OUT">OUT</option>
          <option value="ADJUSTMENT">ADJUSTMENT</option>
        </select>
        <Input name="quantity" type="number" min="1" placeholder="Cantidad" />
        <Input name="referenceType" placeholder="Referencia tipo" />
        <Input name="referenceId" placeholder="Referencia ID" />
        <Button type="submit" className="md:col-span-6">
          Crear movimiento
        </Button>
      </form>

      <div className="overflow-hidden rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left">
            <tr>
              <th className="px-3 py-2">Fecha</th>
              <th className="px-3 py-2">Depósito</th>
              <th className="px-3 py-2">Producto</th>
              <th className="px-3 py-2">Tipo</th>
              <th className="px-3 py-2">Cantidad</th>
            </tr>
          </thead>
          <tbody>
            {movements.map((movement) => (
              <tr key={movement.id} className="border-t">
                <td className="px-3 py-2">
                  {movement.createdAt.toLocaleString("es-AR")}
                </td>
                <td className="px-3 py-2">{movement.warehouse.name}</td>
                <td className="px-3 py-2">{movement.product.name}</td>
                <td className="px-3 py-2">{movement.type}</td>
                <td className="px-3 py-2">{movement.quantity}</td>
              </tr>
            ))}
            {movements.length === 0 ? (
              <tr>
                <td
                  className="px-3 py-4 text-sm text-muted-foreground"
                  colSpan={5}
                >
                  Sin movimientos aún.
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
