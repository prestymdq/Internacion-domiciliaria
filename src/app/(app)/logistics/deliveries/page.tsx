import { revalidatePath } from "next/cache";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { assertRole } from "@/lib/rbac";
import { Role } from "@prisma/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import {
  assertTenantModuleAccess,
  getTenantModuleAccess,
} from "@/lib/tenant-access";
import AccessDenied from "@/components/app/access-denied";
import { withTenant } from "@/lib/rls";
import { uploadEvidenceObject } from "@/lib/storage";

const transitSchema = z.object({
  deliveryId: z.string().min(1),
  carrierName: z.string().min(1),
  carrierDni: z.string().min(4),
});

const deliveredSchema = z.object({
  deliveryId: z.string().min(1),
  receiverName: z.string().min(1),
  receiverDni: z.string().min(4),
  receiverRelation: z.string().min(1),
});

async function uploadEvidence(formData: FormData) {
  "use server";
  const session = await getServerSession(authOptions);
  if (!session?.user?.tenantId) {
    throw new Error("UNAUTHORIZED");
  }
  await withTenant(session.user.tenantId, async (db) => {
    await assertTenantModuleAccess(db, session.user.tenantId, "LOGISTICS");
    assertRole(session.user.role, [
      Role.ADMIN_TENANT,
      Role.COORDINACION,
      Role.LOGISTICA,
      Role.DEPOSITO,
    ]);

    const deliveryId = String(formData.get("deliveryId") ?? "");
    const file = formData.get("file");
    if (
      !deliveryId ||
      !file ||
      typeof (file as Blob).arrayBuffer !== "function"
    ) {
      throw new Error("VALIDATION_ERROR");
    }

    const fileName =
      typeof (file as { name?: string }).name === "string"
        ? (file as { name: string }).name
        : "evidence.bin";
    const mimeType =
      (file as { type?: string }).type || "application/octet-stream";

    const delivery = await db.delivery.findFirst({
      where: { id: deliveryId, tenantId: session.user.tenantId },
    });
    if (!delivery) {
      throw new Error("NOT_FOUND");
    }

    const arrayBuffer = await (file as Blob).arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
    const key = `tenants/${session.user.tenantId}/deliveries/${delivery.deliveryNumber}/${Date.now()}-${safeName}`;

    let uploaded: { key: string; url: string | undefined };
    try {
      uploaded = await uploadEvidenceObject({
        key,
        body: buffer,
        contentType: mimeType,
      });
    } catch (error) {
      if (process.env.NODE_ENV === "production") {
        throw error;
      }
      uploaded = { key, url: undefined };
    }

    const created = await db.deliveryEvidence.create({
      data: {
        deliveryId: delivery.id,
        fileKey: uploaded.key,
        fileUrl: uploaded.url ?? null,
        fileName,
        mimeType,
        size: buffer.length,
        uploadedById: session.user.id,
      },
    });

    await logAudit(db, {
      tenantId: session.user.tenantId,
      actorId: session.user.id,
      action: "delivery.evidence.upload",
      entityType: "DeliveryEvidence",
      entityId: created.id,
      meta: { fileName: created.fileName },
    });
  });

  revalidatePath("/logistics/deliveries");
}

async function markInTransit(formData: FormData) {
  "use server";
  const session = await getServerSession(authOptions);
  if (!session?.user?.tenantId) {
    throw new Error("UNAUTHORIZED");
  }
  await withTenant(session.user.tenantId, async (db) => {
    await assertTenantModuleAccess(db, session.user.tenantId, "LOGISTICS");
    assertRole(session.user.role, [Role.ADMIN_TENANT, Role.LOGISTICA]);

    const parsed = transitSchema.safeParse({
      deliveryId: formData.get("deliveryId"),
      carrierName: formData.get("carrierName"),
      carrierDni: formData.get("carrierDni"),
    });

    if (!parsed.success) {
      throw new Error("VALIDATION_ERROR");
    }

    const delivery = await db.delivery.findFirst({
      where: { id: parsed.data.deliveryId, tenantId: session.user.tenantId },
    });

    if (!delivery || delivery.status !== "PACKED") {
      throw new Error("INVALID_STATUS");
    }

    const updated = await db.delivery.update({
      where: { id: delivery.id },
      data: {
        status: "IN_TRANSIT",
        inTransitAt: new Date(),
        carrierName: parsed.data.carrierName,
        carrierDni: parsed.data.carrierDni,
        carrierSignedAt: new Date(),
      },
    });

    await logAudit(db, {
      tenantId: session.user.tenantId,
      actorId: session.user.id,
      action: "delivery.in_transit",
      entityType: "Delivery",
      entityId: updated.id,
    });
  });

  revalidatePath("/logistics/deliveries");
}

async function markDelivered(formData: FormData) {
  "use server";
  const session = await getServerSession(authOptions);
  if (!session?.user?.tenantId) {
    throw new Error("UNAUTHORIZED");
  }
  await withTenant(session.user.tenantId, async (db) => {
    await assertTenantModuleAccess(db, session.user.tenantId, "LOGISTICS");
    await assertTenantModuleAccess(db, session.user.tenantId, "INVENTORY");
    assertRole(session.user.role, [Role.ADMIN_TENANT, Role.LOGISTICA]);

    const parsed = deliveredSchema.safeParse({
      deliveryId: formData.get("deliveryId"),
      receiverName: formData.get("receiverName"),
      receiverDni: formData.get("receiverDni"),
      receiverRelation: formData.get("receiverRelation"),
    });

    if (!parsed.success) {
      throw new Error("VALIDATION_ERROR");
    }

    const delivery = await db.delivery.findFirst({
      where: { id: parsed.data.deliveryId, tenantId: session.user.tenantId },
      include: {
        pickList: { include: { items: true } },
      },
    });

    if (!delivery || delivery.status !== "IN_TRANSIT") {
      throw new Error("INVALID_STATUS");
    }

    if (!delivery.carrierName || !delivery.carrierDni) {
      throw new Error("CARRIER_SIGNATURE_REQUIRED");
    }

    const minEvidence = Number(process.env.DELIVERY_MIN_EVIDENCE ?? "1");
    const evidenceCount = await db.deliveryEvidence.count({
      where: { deliveryId: parsed.data.deliveryId },
    });

    if (evidenceCount < minEvidence) {
      throw new Error("EVIDENCE_REQUIRED");
    }

    if (!delivery.pickList) {
      throw new Error("PICKLIST_NOT_FOUND");
    }

    if (!delivery.pickList.stockCommittedAt) {
      for (const item of delivery.pickList.items) {
        if (!item.warehouseId) {
          throw new Error("WAREHOUSE_REQUIRED");
        }
        if (item.pickedQty <= 0) {
          continue;
        }

        const movement = await db.stockMovement.create({
          data: {
            tenantId: session.user.tenantId,
            warehouseId: item.warehouseId,
            productId: item.productId,
            type: "OUT",
            quantity: item.pickedQty,
            referenceType: "DELIVERY",
            referenceId: delivery.id,
            createdById: session.user.id,
          },
        });

        await logAudit(db, {
          tenantId: session.user.tenantId,
          actorId: session.user.id,
          action: "stock.movement.delivery",
          entityType: "StockMovement",
          entityId: movement.id,
          meta: { quantity: movement.quantity, productId: item.productId },
        });
      }

      await db.pickList.update({
        where: { id: delivery.pickListId },
        data: { stockCommittedAt: new Date() },
      });
    }

    const updated = await db.delivery.update({
      where: { id: parsed.data.deliveryId, tenantId: session.user.tenantId },
      data: {
        status: "DELIVERED",
        deliveredAt: new Date(),
        receiverName: parsed.data.receiverName,
        receiverDni: parsed.data.receiverDni,
        receiverRelation: parsed.data.receiverRelation,
        receiverSignedAt: new Date(),
      },
    });

    await logAudit(db, {
      tenantId: session.user.tenantId,
      actorId: session.user.id,
      action: "delivery.delivered",
      entityType: "Delivery",
      entityId: updated.id,
    });
  });

  revalidatePath("/logistics/deliveries");
}

async function closeDelivery(formData: FormData) {
  "use server";
  const session = await getServerSession(authOptions);
  if (!session?.user?.tenantId) {
    throw new Error("UNAUTHORIZED");
  }
  await withTenant(session.user.tenantId, async (db) => {
    await assertTenantModuleAccess(db, session.user.tenantId, "LOGISTICS");
    assertRole(session.user.role, [Role.ADMIN_TENANT, Role.LOGISTICA]);

    const deliveryId = String(formData.get("deliveryId") ?? "");
    if (!deliveryId) throw new Error("VALIDATION_ERROR");

    const delivery = await db.delivery.findFirst({
      where: { id: deliveryId, tenantId: session.user.tenantId },
    });

    if (!delivery || delivery.status !== "DELIVERED") {
      throw new Error("INVALID_STATUS");
    }

    const updated = await db.delivery.update({
      where: { id: deliveryId },
      data: { status: "CLOSED", closedAt: new Date() },
    });

    await logAudit(db, {
      tenantId: session.user.tenantId,
      actorId: session.user.id,
      action: "delivery.closed",
      entityType: "Delivery",
      entityId: updated.id,
    });
  });

  revalidatePath("/logistics/deliveries");
}

export default async function DeliveriesPage() {
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

    const deliveries = await db.delivery.findMany({
      where: { tenantId },
      include: {
        approvedOrder: { include: { patient: true } },
        evidence: true,
        pickList: true,
      },
      orderBy: { createdAt: "desc" },
    });

    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">Entregas</h1>
          <p className="text-sm text-muted-foreground">
            Doble firma + evidencia obligatoria + stock automatico.
          </p>
        </div>

        <div className="space-y-4">
          {deliveries.map((delivery) => (
            <div key={delivery.id} className="rounded-lg border p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-medium">
                    {delivery.deliveryNumber}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Paciente: {delivery.approvedOrder.patient.lastName},{" "}
                    {delivery.approvedOrder.patient.firstName}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Estado: {delivery.status}
                  </div>
                </div>
                <Button asChild size="sm" variant="outline">
                  <Link href={`/api/deliveries/${delivery.id}/pdf`}>
                    PDF remito
                  </Link>
                </Button>
              </div>

              <div className="mt-3 grid gap-3 md:grid-cols-3">
                <form
                  action={uploadEvidence}
                  encType="multipart/form-data"
                  className="rounded-md border p-3"
                >
                  <input type="hidden" name="deliveryId" value={delivery.id} />
                  <input name="file" type="file" required />
                  <Button size="sm" type="submit" className="mt-2">
                    Subir evidencia
                  </Button>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Evidencia: {delivery.evidence.length}
                  </p>
                  {delivery.evidence.length > 0 ? (
                    <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                      {delivery.evidence.map((evidence) => (
                        <li key={evidence.id}>{evidence.fileName}</li>
                      ))}
                    </ul>
                  ) : null}
                </form>

                {delivery.status === "PACKED" ? (
                  <form action={markInTransit} className="rounded-md border p-3">
                    <input type="hidden" name="deliveryId" value={delivery.id} />
                    <Input name="carrierName" placeholder="Retirante" required />
                    <Input
                      name="carrierDni"
                      placeholder="DNI retirante"
                      required
                      className="mt-2"
                    />
                    <Button size="sm" type="submit" className="mt-2">
                      Marcar en transito
                    </Button>
                  </form>
                ) : null}

                {delivery.status === "IN_TRANSIT" ? (
                  <form action={markDelivered} className="rounded-md border p-3">
                    <input type="hidden" name="deliveryId" value={delivery.id} />
                    <Input name="receiverName" placeholder="Receptor" required />
                    <Input
                      name="receiverDni"
                      placeholder="DNI receptor"
                      required
                      className="mt-2"
                    />
                    <Input
                      name="receiverRelation"
                      placeholder="Vinculo"
                      required
                      className="mt-2"
                    />
                    <Button size="sm" type="submit" className="mt-2">
                      Marcar entregado
                    </Button>
                  </form>
                ) : null}

                {delivery.status === "DELIVERED" ? (
                  <form action={closeDelivery} className="rounded-md border p-3">
                    <input type="hidden" name="deliveryId" value={delivery.id} />
                    <Button size="sm" type="submit">
                      Cerrar entrega
                    </Button>
                  </form>
                ) : null}
              </div>
            </div>
          ))}
          {deliveries.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin entregas aun.</p>
          ) : null}
        </div>
      </div>
    );
  });
}
