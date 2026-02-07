import { revalidatePath } from "next/cache";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { assertRole } from "@/lib/rbac";
import { nextDeliveryNumber } from "@/lib/sequence";
import { IncidentCause, Role } from "@prisma/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  assertTenantModuleAccess,
  getTenantModuleAccess,
} from "@/lib/tenant-access";
import AccessDenied from "@/components/app/access-denied";
import { withTenant } from "@/lib/rls";

const incidentSchema = z.object({
  pickListItemId: z.string().min(1),
  newQty: z.string().min(1),
  cause: z.nativeEnum(IncidentCause),
  description: z.string().optional(),
});

const assignWarehouseSchema = z.object({
  pickListItemId: z.string().min(1),
  warehouseId: z.string().min(1),
});

async function assignPickListItemWarehouse(formData: FormData) {
  "use server";
  const session = await getServerSession(authOptions);
  if (!session?.user?.tenantId) {
    throw new Error("UNAUTHORIZED");
  }
  await withTenant(session.user.tenantId, async (db) => {
    await assertTenantModuleAccess(db, session.user.tenantId, "LOGISTICS");
    await assertTenantModuleAccess(db, session.user.tenantId, "INVENTORY");
    assertRole(session.user.role, [Role.ADMIN_TENANT, Role.DEPOSITO]);

    const parsed = assignWarehouseSchema.safeParse({
      pickListItemId: formData.get("pickListItemId"),
      warehouseId: formData.get("warehouseId"),
    });

    if (!parsed.success) {
      throw new Error("VALIDATION_ERROR");
    }

    const item = await db.pickListItem.findFirst({
      where: {
        id: parsed.data.pickListItemId,
        pickList: { tenantId: session.user.tenantId },
      },
      include: { pickList: true },
    });

    if (
      !item ||
      !["DRAFT", "FROZEN"].includes(item.pickList.status) ||
      item.pickList.stockCommittedAt
    ) {
      throw new Error("INVALID_STATUS");
    }

    const warehouse = await db.warehouse.findFirst({
      where: { id: parsed.data.warehouseId, tenantId: session.user.tenantId },
    });
    if (!warehouse) {
      throw new Error("WAREHOUSE_NOT_FOUND");
    }

    await db.pickListItem.update({
      where: { id: item.id },
      data: { warehouseId: warehouse.id },
    });

    await logAudit(db, {
      tenantId: session.user.tenantId,
      actorId: session.user.id,
      action: "picklist.item.warehouse.assign",
      entityType: "PickListItem",
      entityId: item.id,
      meta: { warehouseId: warehouse.id },
    });
  });

  revalidatePath("/logistics/picklists");
}

async function freezePickList(formData: FormData) {
  "use server";
  const session = await getServerSession(authOptions);
  if (!session?.user?.tenantId) {
    throw new Error("UNAUTHORIZED");
  }
  await withTenant(session.user.tenantId, async (db) => {
    await assertTenantModuleAccess(db, session.user.tenantId, "LOGISTICS");
    await assertTenantModuleAccess(db, session.user.tenantId, "INVENTORY");
    assertRole(session.user.role, [Role.ADMIN_TENANT, Role.DEPOSITO]);

    const pickListId = String(formData.get("pickListId") ?? "");
    if (!pickListId) throw new Error("VALIDATION_ERROR");

    const pickList = await db.pickList.findFirst({
      where: { id: pickListId, tenantId: session.user.tenantId },
      include: { items: true },
    });

    if (!pickList || pickList.status !== "DRAFT") {
      throw new Error("INVALID_STATUS");
    }

    for (const item of pickList.items) {
      if (!item.warehouseId) {
        throw new Error("WAREHOUSE_REQUIRED");
      }
    }

    for (const item of pickList.items) {
      const movements = await db.stockMovement.findMany({
        where: {
          tenantId: session.user.tenantId,
          warehouseId: item.warehouseId ?? undefined,
          productId: item.productId,
        },
        select: { type: true, quantity: true },
      });
      const onHand = movements.reduce((sum, movement) => {
        const sign = movement.type === "OUT" ? -1 : 1;
        return sum + sign * movement.quantity;
      }, 0);

      const reservedAgg = await db.pickListItem.aggregate({
        where: {
          productId: item.productId,
          warehouseId: item.warehouseId ?? undefined,
          pickList: {
            tenantId: session.user.tenantId,
            id: { not: pickList.id },
            status: { in: ["FROZEN", "PACKED"] },
            stockCommittedAt: null,
          },
        },
        _sum: { pickedQty: true },
      });
      const reserved = reservedAgg._sum.pickedQty ?? 0;
      const available = onHand - reserved;

      if (available < item.requestedQty) {
        throw new Error("INSUFFICIENT_STOCK");
      }
    }

    await db.pickList.update({
      where: { id: pickList.id },
      data: { status: "FROZEN", frozenAt: new Date() },
    });
    for (const item of pickList.items) {
      await db.pickListItem.update({
        where: { id: item.id },
        data: { pickedQty: item.requestedQty },
      });
    }

    await logAudit(db, {
      tenantId: session.user.tenantId,
      actorId: session.user.id,
      action: "picklist.freeze",
      entityType: "PickList",
      entityId: pickList.id,
    });
  });

  revalidatePath("/logistics/picklists");
}

async function packPickList(formData: FormData) {
  "use server";
  const session = await getServerSession(authOptions);
  if (!session?.user?.tenantId) {
    throw new Error("UNAUTHORIZED");
  }
  await withTenant(session.user.tenantId, async (db) => {
    await assertTenantModuleAccess(db, session.user.tenantId, "LOGISTICS");
    assertRole(session.user.role, [Role.ADMIN_TENANT, Role.DEPOSITO]);

    const pickListId = String(formData.get("pickListId") ?? "");
    if (!pickListId) throw new Error("VALIDATION_ERROR");

    const pickList = await db.pickList.findFirst({
      where: { id: pickListId, tenantId: session.user.tenantId },
    });
    if (!pickList) {
      throw new Error("PICKLIST_NOT_FOUND");
    }
    if (pickList.status !== "FROZEN") {
      throw new Error("INVALID_STATUS");
    }

    const updated = await db.pickList.update({
      where: { id: pickList.id },
      data: { status: "PACKED", packedAt: new Date() },
    });

    await logAudit(db, {
      tenantId: session.user.tenantId,
      actorId: session.user.id,
      action: "picklist.pack",
      entityType: "PickList",
      entityId: updated.id,
    });
  });

  revalidatePath("/logistics/picklists");
}

async function reportIncident(formData: FormData) {
  "use server";
  const session = await getServerSession(authOptions);
  if (!session?.user?.tenantId) {
    throw new Error("UNAUTHORIZED");
  }
  await withTenant(session.user.tenantId, async (db) => {
    await assertTenantModuleAccess(db, session.user.tenantId, "LOGISTICS");
    assertRole(session.user.role, [
      Role.ADMIN_TENANT,
      Role.DEPOSITO,
      Role.COORDINACION,
    ]);

    const parsed = incidentSchema.safeParse({
      pickListItemId: formData.get("pickListItemId"),
      newQty: formData.get("newQty"),
      cause: formData.get("cause"),
      description: formData.get("description"),
    });

    if (!parsed.success) {
      throw new Error("VALIDATION_ERROR");
    }

    const item = await db.pickListItem.findFirst({
      where: {
        id: parsed.data.pickListItemId,
        pickList: { tenantId: session.user.tenantId },
      },
      include: { pickList: true },
    });

    if (!item) {
      throw new Error("NOT_FOUND");
    }

    if (item.pickList.status !== "FROZEN") {
      throw new Error("PICKLIST_NOT_FROZEN");
    }

    const newQty = Number(parsed.data.newQty);
    if (!Number.isFinite(newQty) || newQty < 0) {
      throw new Error("INVALID_QUANTITY");
    }

    if (newQty >= item.requestedQty) {
      throw new Error("INCIDENT_REQUIRED_ONLY_FOR_REDUCTION");
    }

    const incident = await db.incident.create({
      data: {
        tenantId: session.user.tenantId,
        cause: parsed.data.cause,
        description: parsed.data.description ?? null,
        createdById: session.user.id,
      },
    });

    await db.pickListItem.update({
      where: { id: item.id },
      data: {
        pickedQty: newQty,
        incidentId: incident.id,
      },
    });

    await logAudit(db, {
      tenantId: session.user.tenantId,
      actorId: session.user.id,
      action: "picklist.item.reduce",
      entityType: "PickListItem",
      entityId: item.id,
      meta: {
        from: item.requestedQty,
        to: newQty,
        cause: parsed.data.cause,
      },
    });
  });

  revalidatePath("/logistics/picklists");
}

async function createDelivery(formData: FormData) {
  "use server";
  const session = await getServerSession(authOptions);
  if (!session?.user?.tenantId) {
    throw new Error("UNAUTHORIZED");
  }
  await withTenant(session.user.tenantId, async (db) => {
    await assertTenantModuleAccess(db, session.user.tenantId, "LOGISTICS");
    assertRole(session.user.role, [Role.ADMIN_TENANT, Role.LOGISTICA]);

    const pickListId = String(formData.get("pickListId") ?? "");
    if (!pickListId) throw new Error("VALIDATION_ERROR");

    const pickList = await db.pickList.findFirst({
      where: { id: pickListId, tenantId: session.user.tenantId },
      include: { approvedOrder: true, deliveries: true },
    });

    if (!pickList || pickList.status !== "PACKED") {
      throw new Error("INVALID_STATUS");
    }

    if (pickList.deliveries.length > 0) {
      return;
    }

    const deliveryNumber = await nextDeliveryNumber(
      db,
      session.user.tenantId,
    );

    const delivery = await db.delivery.create({
      data: {
        tenantId: session.user.tenantId,
        pickListId: pickList.id,
        approvedOrderId: pickList.approvedOrderId,
        status: "PACKED",
        deliveryNumber,
      },
    });

    await logAudit(db, {
      tenantId: session.user.tenantId,
      actorId: session.user.id,
      action: "delivery.create",
      entityType: "Delivery",
      entityId: delivery.id,
      meta: { deliveryNumber },
    });
  });

  revalidatePath("/logistics/picklists");
}

export default async function PickListsPage() {
  const session = await getServerSession(authOptions);
  const tenantId = session?.user?.tenantId;

  if (!tenantId) {
    return <p className="text-sm text-muted-foreground">Sin tenant.</p>;
  }

  return withTenant(tenantId, async (db) => {
    const access = await getTenantModuleAccess(db, tenantId, "LOGISTICS");
    if (!access.allowed) {
      return <AccessDenied reason={access.reason ?? "Sin acceso."} />;
    }

    const warehouses = await db.warehouse.findMany({
      where: { tenantId },
      orderBy: { name: "asc" },
    });
    const pickLists = await db.pickList.findMany({
      where: { tenantId },
      include: {
        approvedOrder: { include: { patient: true } },
        items: { include: { product: true, incident: true, warehouse: true } },
        deliveries: true,
      },
      orderBy: { createdAt: "desc" },
    });

    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">Picklists</h1>
          <p className="text-sm text-muted-foreground">
            Congeladas con reserva de stock y control de incidentes.
          </p>
        </div>

        <div className="space-y-4">
          {pickLists.map((pickList) => (
            <div key={pickList.id} className="rounded-lg border p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-sm text-muted-foreground">
                    Paciente: {pickList.approvedOrder.patient.lastName},{" "}
                    {pickList.approvedOrder.patient.firstName}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Estado: {pickList.status}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {pickList.status === "DRAFT" ? (
                    <form action={freezePickList}>
                      <input type="hidden" name="pickListId" value={pickList.id} />
                      <Button size="sm" type="submit">
                        Congelar y reservar
                      </Button>
                    </form>
                  ) : null}
                  {pickList.status === "FROZEN" ? (
                    <form action={packPickList}>
                      <input type="hidden" name="pickListId" value={pickList.id} />
                      <Button size="sm" variant="secondary" type="submit">
                        Marcar packed
                      </Button>
                    </form>
                  ) : null}
                  {pickList.status === "PACKED" ? (
                    <form action={createDelivery}>
                      <input type="hidden" name="pickListId" value={pickList.id} />
                      <Button size="sm" variant="outline" type="submit">
                        {pickList.deliveries.length > 0
                          ? "Entrega creada"
                          : "Crear entrega"}
                      </Button>
                    </form>
                  ) : null}
                </div>
              </div>

              <div className="mt-3 overflow-hidden rounded-md border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40 text-left">
                    <tr>
                      <th className="px-3 py-2">Producto</th>
                      <th className="px-3 py-2">Deposito</th>
                      <th className="px-3 py-2">Req</th>
                      <th className="px-3 py-2">Pick</th>
                      <th className="px-3 py-2">Incidente</th>
                      <th className="px-3 py-2">Accion</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pickList.items.map((item) => (
                      <tr key={item.id} className="border-t">
                        <td className="px-3 py-2">{item.product.name}</td>
                        <td className="px-3 py-2">
                          {pickList.status === "DRAFT" ||
                          (pickList.status === "FROZEN" &&
                            !item.warehouseId) ? (
                            <form
                              action={assignPickListItemWarehouse}
                              className="flex items-center gap-2"
                            >
                              <input
                                type="hidden"
                                name="pickListItemId"
                                value={item.id}
                              />
                              <select
                                name="warehouseId"
                                className="h-8 rounded-md border bg-background px-2 text-xs"
                                required
                                defaultValue={item.warehouseId ?? ""}
                              >
                                <option value="">Deposito...</option>
                                {warehouses.map((warehouse) => (
                                  <option
                                    key={warehouse.id}
                                    value={warehouse.id}
                                  >
                                    {warehouse.name}
                                  </option>
                                ))}
                              </select>
                              <Button size="sm" variant="outline" type="submit">
                                Asignar
                              </Button>
                            </form>
                          ) : item.warehouse ? (
                            item.warehouse.name
                          ) : (
                            "Sin deposito"
                          )}
                        </td>
                        <td className="px-3 py-2">{item.requestedQty}</td>
                        <td className="px-3 py-2">{item.pickedQty}</td>
                        <td className="px-3 py-2">
                          {item.incident?.cause ?? "-"}
                        </td>
                        <td className="px-3 py-2">
                          {pickList.status === "FROZEN" ? (
                            <form
                              action={reportIncident}
                              className="flex flex-wrap gap-2"
                            >
                              <input
                                type="hidden"
                                name="pickListItemId"
                                value={item.id}
                              />
                              <Input
                                name="newQty"
                                type="number"
                                min="0"
                                placeholder="Nuevo qty"
                                className="h-8 w-24"
                              />
                              <select
                                name="cause"
                                className="h-8 rounded-md border bg-background px-2 text-xs"
                                required
                              >
                                <option value="SIN_STOCK">SIN_STOCK</option>
                                <option value="CAMBIO_INDICACION">
                                  CAMBIO_INDICACION
                                </option>
                                <option value="RECHAZO_DOMICILIO">
                                  RECHAZO_DOMICILIO
                                </option>
                                <option value="INCUMPLIMIENTO">
                                  INCUMPLIMIENTO
                                </option>
                              </select>
                              <Input
                                name="description"
                                placeholder="Detalle"
                                className="h-8 w-40"
                              />
                              <Button size="sm" variant="outline" type="submit">
                                Reducir con incidente
                              </Button>
                            </form>
                          ) : (
                            "-"
                          )}
                        </td>
                      </tr>
                    ))}
                    {pickList.items.length === 0 ? (
                      <tr>
                        <td
                          className="px-3 py-4 text-sm text-muted-foreground"
                          colSpan={6}
                        >
                          Sin items.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
          {pickLists.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin picklists aun.</p>
          ) : null}
        </div>
      </div>
    );
  });
}
