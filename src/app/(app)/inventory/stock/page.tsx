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
  batchId: z.string().optional(),
  referenceType: z.string().optional(),
  referenceId: z.string().optional(),
});

const batchSchema = z.object({
  productId: z.string().min(1),
  code: z.string().min(1),
  expiryDate: z.string().optional(),
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
      batchId: formData.get("batchId"),
      referenceType: formData.get("referenceType"),
      referenceId: formData.get("referenceId"),
    });

    if (!parsed.success) {
      throw new Error("VALIDATION_ERROR");
    }

    const quantity = Number(parsed.data.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new Error("INVALID_QUANTITY");
    }

    const movement = await db.stockMovement.create({
      data: {
        tenantId: session.user.tenantId,
        warehouseId: parsed.data.warehouseId,
        productId: parsed.data.productId,
        batchId: parsed.data.batchId || null,
        type: parsed.data.type,
        quantity,
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

async function createBatch(formData: FormData) {
  "use server";
  const session = await getServerSession(authOptions);
  if (!session?.user?.tenantId) {
    throw new Error("UNAUTHORIZED");
  }
  await withTenant(session.user.tenantId, async (db) => {
    await assertTenantModuleAccess(db, session.user.tenantId, "INVENTORY");
    assertRole(session.user.role, [Role.ADMIN_TENANT, Role.DEPOSITO]);

    const parsed = batchSchema.safeParse({
      productId: formData.get("productId"),
      code: formData.get("code"),
      expiryDate: formData.get("expiryDate"),
    });

    if (!parsed.success) {
      throw new Error("VALIDATION_ERROR");
    }

    const batch = await db.batch.create({
      data: {
        tenantId: session.user.tenantId,
        productId: parsed.data.productId,
        code: parsed.data.code.trim(),
        expiryDate: parsed.data.expiryDate
          ? new Date(parsed.data.expiryDate)
          : null,
      },
    });

    await logAudit(db, {
      tenantId: session.user.tenantId,
      actorId: session.user.id,
      action: "batch.create",
      entityType: "Batch",
      entityId: batch.id,
      meta: { code: batch.code },
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
    const batches = await db.batch.findMany({
      where: { tenantId },
      include: { product: true },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    const alertBatches = await db.batch.findMany({
      where: { tenantId, expiryDate: { not: null } },
      include: { product: true },
    });
    const movements = await db.stockMovement.findMany({
      where: { tenantId },
      include: { product: true, warehouse: true, batch: true },
      orderBy: { createdAt: "desc" },
      take: 30,
    });

    const rawMovements = await db.stockMovement.findMany({
      where: { tenantId },
      select: { productId: true, warehouseId: true, type: true, quantity: true },
    });

    const stockByProduct = new Map<string, number>();
    for (const movement of rawMovements) {
      const sign = movement.type === "OUT" ? -1 : 1;
      const delta = sign * movement.quantity;
      stockByProduct.set(
        movement.productId,
        (stockByProduct.get(movement.productId) ?? 0) + delta,
      );
    }

    const reservedItems = await db.pickListItem.findMany({
      where: {
        pickList: {
          tenantId,
          status: { in: ["FROZEN", "PACKED"] },
          stockCommittedAt: null,
        },
      },
      select: { productId: true, warehouseId: true, pickedQty: true },
    });

    const reservedByProduct = new Map<string, number>();
    for (const item of reservedItems) {
      if (!item.warehouseId) {
        continue;
      }
      reservedByProduct.set(
        item.productId,
        (reservedByProduct.get(item.productId) ?? 0) + item.pickedQty,
      );
    }

    const lowStock = products
      .filter((product) => product.reorderPoint !== null)
      .map((product) => {
        const onHand = stockByProduct.get(product.id) ?? 0;
        const reserved = reservedByProduct.get(product.id) ?? 0;
        const available = onHand - reserved;
        return {
          product,
          onHand,
          reserved,
          available,
          reorderPoint: product.reorderPoint ?? 0,
        };
      })
      .filter((row) => row.available <= row.reorderPoint);

    const today = new Date();
    const soon = new Date();
    soon.setDate(today.getDate() + 30);
    const expiringSoon = alertBatches.filter(
      (batch) =>
        batch.expiryDate &&
        batch.expiryDate >= today &&
        batch.expiryDate <= soon,
    );
    const expired = alertBatches.filter(
      (batch) => batch.expiryDate && batch.expiryDate < today,
    );

    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">Movimientos de stock</h1>
          <p className="text-sm text-muted-foreground">
            Entradas, salidas, ajustes y alertas de reposicion.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-lg border p-4">
            <h2 className="text-lg font-semibold">Alertas de stock</h2>
            {lowStock.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">
                Sin alertas de reposicion.
              </p>
            ) : (
              <ul className="mt-2 space-y-2 text-sm text-muted-foreground">
                {lowStock.map((row) => (
                  <li key={row.product.id}>
                    {row.product.name}: disponible {row.available} (min{" "}
                    {row.reorderPoint}, reservado {row.reserved})
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="rounded-lg border p-4">
            <h2 className="text-lg font-semibold">Vencimientos</h2>
            <p className="text-sm text-muted-foreground">
              {expired.length} vencidos, {expiringSoon.length} por vencer.
            </p>
            <div className="mt-2 space-y-2 text-xs text-muted-foreground">
              {expired.map((batch) => (
                <div key={batch.id}>
                  {batch.product.name} - {batch.code} (vencio{" "}
                  {batch.expiryDate?.toLocaleDateString("es-AR")})
                </div>
              ))}
              {expiringSoon.map((batch) => (
                <div key={batch.id}>
                  {batch.product.name} - {batch.code} (vence{" "}
                  {batch.expiryDate?.toLocaleDateString("es-AR")})
                </div>
              ))}
              {expired.length === 0 && expiringSoon.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Sin lotes con vencimiento cercano.
                </p>
              ) : null}
            </div>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <form action={createBatch} className="rounded-lg border p-4">
            <h2 className="text-lg font-semibold">Crear lote</h2>
            <div className="mt-3 grid gap-2">
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
              <Input name="code" placeholder="Codigo de lote" required />
              <Input name="expiryDate" type="date" placeholder="Vencimiento" />
              <Button type="submit">Crear lote</Button>
            </div>
          </form>

          <form action={createMovement} className="rounded-lg border p-4">
            <h2 className="text-lg font-semibold">Movimiento</h2>
            <div className="mt-3 grid gap-2">
              <select
                name="warehouseId"
                className="h-10 rounded-md border bg-background px-3 text-sm"
                required
              >
                <option value="">Deposito...</option>
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
                name="batchId"
                className="h-10 rounded-md border bg-background px-3 text-sm"
              >
                <option value="">Lote...</option>
                {batches.map((batch) => (
                  <option key={batch.id} value={batch.id}>
                    {batch.product.name} - {batch.code}
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
              <Input
                name="quantity"
                type="number"
                min="1"
                placeholder="Cantidad"
                required
              />
              <Input name="referenceType" placeholder="Referencia tipo" />
              <Input name="referenceId" placeholder="Referencia ID" />
              <Button type="submit">Crear movimiento</Button>
            </div>
          </form>
        </div>

        <div className="overflow-hidden rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left">
              <tr>
                <th className="px-3 py-2">Fecha</th>
                <th className="px-3 py-2">Deposito</th>
                <th className="px-3 py-2">Producto</th>
                <th className="px-3 py-2">Lote</th>
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
                  <td className="px-3 py-2">
                    {movement.batch ? movement.batch.code : "-"}
                  </td>
                  <td className="px-3 py-2">{movement.type}</td>
                  <td className="px-3 py-2">{movement.quantity}</td>
                </tr>
              ))}
              {movements.length === 0 ? (
                <tr>
                  <td
                    className="px-3 py-4 text-sm text-muted-foreground"
                    colSpan={6}
                  >
                    Sin movimientos aun.
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
